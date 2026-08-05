#!/usr/bin/env python3
"""
上传一个视频的 HLS 分段到 Telegram 私有频道，记录 file_id 清单。
限速 + 断点续传：重跑会跳过 manifest 里已有 file_id 的分段。
边传边把已完成的分段批量写入 D1，media Worker 据此动态拼装"正在增长"的
播放列表 —— 不用等全部传完，观众可以在上传过程中就开始观看已就绪的部分。

用法:
  python scripts/upload.py --slug 250530-hasunosora-4th-hyogo-day0
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

# Windows 后台任务重定向输出到文件时，默认走系统 ANSI 代码页（如 GBK），遇到 emoji 或
# wrangler 彩色 CLI 输出里的特殊字符会直接 UnicodeEncodeError 崩溃整个进程。强制 UTF-8。
# line_buffering：输出重定向到文件时默认是 8KB 块缓冲，一跑就是几小时的任务，
# 日志攒够 8KB 才落盘等于全程看不到进度（进度行才 ~40 字节，要两百行才刷一次）。
sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)  # type: ignore[attr-defined]
sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)  # type: ignore[attr-defined]

REPO_ROOT = Path(__file__).resolve().parent.parent
TELEGRAM_BOT_DOWNLOAD_LIMIT = 20 * 1024 * 1024
# 100 而不是更小：每次 flush 都是一次 `npx wrangler d1 execute` 进程冷启动 + API 往返，
# 批越大次数越少，这块开销摊得越薄（实测这曾占整趟上传总时长的三成左右）。
D1_BATCH_SIZE = 100
D1_DATABASE = "cerise-archive"


def load_env(path: Path) -> dict:
    if not path.exists():
        raise SystemExit(f".env not found: {path}")
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def parse_segment_durations(m3u8_text: str) -> dict:
    """返回 {seg_filename: duration}，从原始（未改写路径的）m3u8 解析。"""
    durations = {}
    pending = None
    for line in m3u8_text.splitlines():
        if line.startswith("#EXTINF:"):
            pending = float(line[len("#EXTINF:"):].split(",")[0])
        elif line and not line.startswith("#") and pending is not None:
            durations[line] = pending
            pending = None
    return durations


def rewrite_m3u8(text: str, slug: str, media_base: str) -> str:
    lines = []
    for line in text.splitlines():
        if line and not line.startswith("#"):
            lines.append(f"{media_base}/{slug}/{line}")
        else:
            lines.append(line)
    return "\n".join(lines) + "\n"


def sql_escape(value) -> str:
    if value is None:
        return ""
    return str(value).replace("'", "''")


def d1_execute(sql: str):
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".sql", delete=False, encoding="utf-8"
    ) as f:
        f.write(sql)
        tmp_path = f.name
    try:
        result = subprocess.run(
            f'npx wrangler d1 execute {D1_DATABASE} --remote --file="{tmp_path}"',
            shell=True,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
        )
        if result.returncode != 0:
            raise RuntimeError(f"wrangler d1 execute failed: {result.stderr}")
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def query_d1_segment_count(slug: str) -> int:
    result = subprocess.run(
        f'npx wrangler d1 execute {D1_DATABASE} --remote --json '
        f'--command "SELECT COUNT(*) as cnt FROM segments WHERE slug=\'{sql_escape(slug)}\';"',
        shell=True,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"wrangler d1 execute (count query) failed: {result.stderr}")
    payload = json.loads(result.stdout)
    return payload[0]["results"][0]["cnt"]


def cleanup_local_if_synced(slug: str, hls_dir: Path, expected_count: int):
    """上传+D1 写入都做完之后，再主动查一次 D1 里这个 slug 的分段数，
    跟本地切片数量对上了才删本地 HLS 目录，腾地方给下一条视频切片——
    不信任"脚本正常退出"这个信号本身，避免 D1 那次写实际没落地却把本地素材删了。"""
    print("Verifying D1 segment count before deleting local HLS files...")
    try:
        synced_count = with_retry(lambda: query_d1_segment_count(slug))
    except Exception as e:
        print(f"  D1 verification failed, keeping local files: {e}")
        return
    if synced_count != expected_count:
        print(
            f"  D1 has {synced_count}/{expected_count} segments for {slug}, "
            "NOT deleting local files (re-run to retry)."
        )
        return
    shutil.rmtree(hls_dir)
    print(f"  D1 confirmed {synced_count}/{expected_count} segments synced, deleted {hls_dir}")


def upsert_video_row(manifest: dict):
    # m3u8 列不再写入完整播放列表文本：media Worker 已改成从 segments 表动态拼装，
    # 存整份文本只会占地方，2000+ 段的视频还会撑爆单条 D1 语句体积 (SQLITE_TOOBIG)。
    sql = f"""
INSERT INTO videos (slug, title, date, duration_seconds, segment_count, poster_file_id, m3u8,
                     franchise_slug, franchise_name, live_slug, live_name)
VALUES ('{sql_escape(manifest['slug'])}', '{sql_escape(manifest['title'])}', '{sql_escape(manifest['date'])}',
        {manifest['duration_seconds']}, {manifest['segment_count']}, '{sql_escape(manifest.get('poster_file_id'))}',
        '', '{sql_escape(manifest.get('franchise_slug'))}', '{sql_escape(manifest.get('franchise_name'))}',
        '{sql_escape(manifest.get('live_slug'))}', '{sql_escape(manifest.get('live_name'))}')
ON CONFLICT(slug) DO UPDATE SET
  title = excluded.title,
  date = excluded.date,
  duration_seconds = excluded.duration_seconds,
  segment_count = excluded.segment_count,
  poster_file_id = excluded.poster_file_id,
  franchise_slug = excluded.franchise_slug,
  franchise_name = excluded.franchise_name,
  live_slug = excluded.live_slug,
  live_name = excluded.live_name;
"""
    with_retry(lambda: d1_execute(sql))


def _flush_segments_to_d1(slug: str, batch: list, manifest: dict, save_locked):
    values = ", ".join(
        f"('{sql_escape(slug)}', '{sql_escape(seg_name)}', '{sql_escape(file_id)}', {duration})"
        for seg_name, file_id, duration in batch
    )
    sql = (
        "INSERT INTO segments (slug, seg_name, file_id, duration_seconds) "
        f"VALUES {values} "
        "ON CONFLICT(slug, seg_name) DO UPDATE SET "
        "file_id = excluded.file_id, duration_seconds = excluded.duration_seconds;"
    )
    with_retry(lambda: d1_execute(sql))
    synced = set(manifest.get("d1_synced", []))
    synced.update(seg_name for seg_name, _, _ in batch)
    manifest["d1_synced"] = sorted(synced)
    save_locked()


class AsyncD1Flusher:
    """把 D1 批量写放到后台线程做，不卡住限速主循环。

    `npx wrangler d1 execute` 每次调用都是一次进程冷启动 + API 往返，实测这部分
    （尤其是撞上这台机器网络代理偶发抽风触发重试时）能占掉整趟上传三成左右的时间——
    但主循环反正要为限速等 3.5 秒，这段等待时间足够背景线程把上一批 D1 写完，相当于
    把这块开销"藏"在本来就要等的时间里，不需要额外等待。

    同一时刻只允许一个 flush 在飞（开新的之前先 join 上一个），避免 manifest['d1_synced']
    和落盘并发写出竞态；所有 save() 调用（含主循环里逐段那次）都要过同一把锁，
    否则两个线程同时写同一个文件可能在磁盘层面写花。
    """

    def __init__(self, save, save_lock: threading.Lock):
        self._save = save
        self._lock = save_lock
        self._thread: threading.Thread | None = None

    def _save_locked(self):
        with self._lock:
            self._save()

    def flush_async(self, slug: str, pending: list, manifest: dict):
        if not pending:
            return
        self.join()
        batch = list(pending)
        pending.clear()
        self._thread = threading.Thread(
            target=_flush_segments_to_d1,
            args=(slug, batch, manifest, self._save_locked),
            daemon=True,
        )
        self._thread.start()

    def join(self):
        if self._thread is not None:
            self._thread.join()
            self._thread = None


class RateLimiter:
    """Telegram 频道发消息限速 ~20/min，默认每次间隔 3.5s 留余量。

    卡的是"发起"的间隔，不是"完成"的间隔——多个上传线程共用同一个实例，
    排队拿号，所以并发多少个在飞都不会把消息速率抬上去。
    持锁 sleep 是故意的：锁本身就是这个队列。
    """

    def __init__(self, min_interval: float):
        self.min_interval = min_interval
        self._last = 0.0
        self._lock = threading.Lock()

    def wait(self):
        with self._lock:
            now = time.monotonic()
            wait_for = self._last + self.min_interval - now
            if wait_for > 0:
                time.sleep(wait_for)
                now = self._last + self.min_interval  # 按名义节拍推进，不累积漂移
            self._last = now


def with_retry(fn, retries=5, base_delay=5):
    for attempt in range(1, retries + 1):
        try:
            return fn()
        except Exception as e:
            if attempt == retries:
                raise
            delay = base_delay * (2 ** (attempt - 1))
            print(f"    retry {attempt}/{retries} after error: {e} (sleep {delay}s)")
            time.sleep(delay)


def send_document(session, token, chat_id, file_path: Path, limiter: RateLimiter) -> str:
    if file_path.stat().st_size > TELEGRAM_BOT_DOWNLOAD_LIMIT:
        raise ValueError(f"{file_path.name} exceeds 20MB bot download limit")
    limiter.wait()
    with open(file_path, "rb") as f:
        resp = session.post(
            f"https://api.telegram.org/bot{token}/sendDocument",
            data={"chat_id": chat_id},
            files={"document": (file_path.name, f)},
            timeout=120,
        )
    resp.raise_for_status()
    data = resp.json()
    if not data.get("ok"):
        raise RuntimeError(f"Telegram API error: {data}")
    return data["result"]["document"]["file_id"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--hls-dir", default=None, help="默认 E:/hls/<slug>")
    parser.add_argument("--title", default=None)
    parser.add_argument("--date", default=None)
    parser.add_argument("--franchise-slug", default=None, help="企划 URL id，如 hasunosora")
    parser.add_argument("--franchise-name", default=None, help="企划显示名，如 蓮ノ空")
    parser.add_argument("--live-slug", default=None, help="场次(live) URL id，如 4th 或 opening-live")
    parser.add_argument("--live-name", default=None, help="场次显示名，如 4th Live 或 OPENING LIVE")
    parser.add_argument(
        "--meta-file",
        default=None,
        help=(
            "UTF-8 JSON 文件，可含 title/date/franchise_slug/franchise_name/live_slug/live_name。"
            "中文等非 ASCII 文本经命令行参数在 Windows 上传给子进程时可能被编码损坏，"
            "用文件读取绕开这个问题；提供的字段会覆盖 manifest 里已有的值（含已存在的 manifest）。"
        ),
    )
    parser.add_argument("--media-base", default="https://media.cerise-bouquet.xyz")
    parser.add_argument("--rate-interval", type=float, default=3.5, help="两次上传发起的间隔秒数")
    parser.add_argument(
        "--concurrency", type=int, default=4,
        help="同时在飞的上传数。只重叠传输时间，发起间隔仍由 --rate-interval 卡死，"
             "所以不会提高频道消息速率；分段越大收益越明显",
    )
    parser.add_argument("--d1-batch-size", type=int, default=D1_BATCH_SIZE)
    parser.add_argument(
        "--keep-local",
        action="store_true",
        help="上传完成后不删本地 HLS 目录（默认在确认 D1 分段数对齐后自动删除，腾盘给下一条切片用）",
    )
    args = parser.parse_args()

    hls_dir = Path(args.hls_dir) if args.hls_dir else Path("E:/hls") / args.slug
    m3u8_path = hls_dir / "master.m3u8"
    poster_path = hls_dir / "poster.jpg"
    segments = sorted(hls_dir.glob("seg_*.ts"))
    if not segments:
        raise SystemExit(f"No segments found in {hls_dir}")
    if not m3u8_path.exists():
        raise SystemExit(f"master.m3u8 not found in {hls_dir}")

    manifest_dir = REPO_ROOT / "manifests"
    manifest_dir.mkdir(exist_ok=True)
    manifest_path = manifest_dir / f"{args.slug}.json"

    m3u8_text = m3u8_path.read_text(encoding="utf-8")
    durations = parse_segment_durations(m3u8_text)

    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    else:
        manifest = {
            "slug": args.slug,
            "title": args.title or args.slug,
            "date": args.date,
            "segment_count": len(segments),
            "duration_seconds": round(sum(durations.values()), 2),
            "segments": {},
            "poster_file_id": None,
            "m3u8": rewrite_m3u8(m3u8_text, args.slug, args.media_base),
            "franchise_slug": args.franchise_slug,
            "franchise_name": args.franchise_name,
            "live_slug": args.live_slug,
            "live_name": args.live_name,
        }

    save_lock = threading.Lock()

    def save():
        # 先写临时文件再原子替换：manifest 是断点续传的唯一凭据，直接 write_text
        # 会先把原文件截断，这中间被 Ctrl-C / 断电打断就只剩半个 JSON，
        # 重跑时解析失败 = 几千段白传。这个截断窗口每段都出现一次，跑几天必然撞上。
        tmp = manifest_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        # Windows 上只要有别的进程正开着目标文件（杀毒扫描、编辑器、备份、看进度的脚本），
        # os.replace 就会 PermissionError。这种占用都是几十毫秒级的，退避重试即可；
        # 真的一直替换不上就让它抛出来——manifest 写不进去等于断点丢了，不能装作没事继续传。
        with_retry(lambda: tmp.replace(manifest_path), retries=5, base_delay=0.2)

    def save_locked():
        with save_lock:
            save()

    flusher = AsyncD1Flusher(save, save_lock)

    # --meta-file 走文件读取而不是命令行参数，不会有中文经 argv 传递被损坏的问题；
    # 每次运行只要给了这个参数就覆盖，方便修正已有 manifest 里之前传坏的字段。
    if args.meta_file:
        meta = json.loads(Path(args.meta_file).read_text(encoding="utf-8"))
        for key in ("title", "date", "franchise_slug", "franchise_name", "live_slug", "live_name"):
            if key in meta:
                manifest[key] = meta[key]
        save()

    env = load_env(REPO_ROOT / ".env")
    token, chat_id = env["token"], env["chat_id"]
    session = requests.Session()
    limiter = RateLimiter(args.rate_interval)

    # poster 提前传，视频一出现在列表里就有封面
    if not manifest.get("poster_file_id") and poster_path.exists():
        manifest["poster_file_id"] = with_retry(
            lambda: send_document(session, token, chat_id, poster_path, limiter)
        )
        save_locked()
        print("  poster uploaded")

    # 视频行立刻 upsert 到 D1，观众马上能在列表里看到（分段还在陆续上传）
    print("Upserting video row to D1...")
    upsert_video_row(manifest)

    already = sum(1 for v in manifest["segments"].values() if v)
    print(f"{args.slug}: {len(segments)} segments, {already} already uploaded, manifest={manifest_path}")

    # 只补 manifest 里有、但还没记为已同步 D1 的分段（比如上次中途崩了重启），
    # 而不是无条件把全部已知分段再推一遍——避免每次重启都重复几十次 D1 往返，
    # 也避免一次性拼一条巨大 SQL 撞上 SQLITE_TOOBIG。
    synced = set(manifest.get("d1_synced", []))
    pending_d1 = []
    for seg_name, file_id in manifest["segments"].items():
        if seg_name in synced:
            continue
        filename = f"seg_{seg_name}.ts"
        pending_d1.append((seg_name, file_id, durations.get(filename, 4.0)))
        if len(pending_d1) >= args.d1_batch_size:
            flusher.flush_async(args.slug, pending_d1, manifest)
    flusher.flush_async(args.slug, pending_d1, manifest)
    flusher.join()
    if synced:
        print(f"  {len(synced)} segments already synced to D1, backfilled {len(manifest['segments']) - len(synced)} more")

    # 一次只传一段时，节拍 = max(限速间隔, 这一段传完要多久)。分段大了之后
    # 后者才是主导（实测 2.3MB 的段单次要 6s 上下，限速的 3.5s 根本没在起作用），
    # 上行等于一直有一大半时间闲着。并发几个在飞，把"发起间隔"和"单次耗时"解耦：
    # 发起仍由 limiter 全局卡 3.5s（消息速率不变，不会触发 429），节拍则回到限速上限。
    #
    # 结果严格按提交顺序取回，manifest 和 D1 只会连续向前推进——边传边看的 EVENT
    # 播放列表不允许事后往中间插段，乱序落库会让已经在播的人拿到带洞的列表。
    todo = [p for p in segments if not manifest["segments"].get(p.stem.split("_")[1])]

    def upload_one(seg_path: Path):
        return seg_path, with_retry(lambda: send_document(session, token, chat_id, seg_path, limiter))

    def commit_one():
        seg_path, file_id = inflight.popleft().result()
        idx = seg_path.stem.split("_")[1]  # "00007" 形式，保留前导零匹配文件名
        manifest["segments"][idx] = file_id
        save_locked()
        pending_d1.append((idx, file_id, durations.get(seg_path.name, 4.0)))
        print(f"  [{len(manifest['segments'])}/{len(segments)}] {seg_path.name} uploaded")
        if len(pending_d1) >= args.d1_batch_size:
            flusher.flush_async(args.slug, pending_d1, manifest)

    inflight: deque = deque()
    pool = ThreadPoolExecutor(max_workers=args.concurrency)
    try:
        for seg_path in todo:
            inflight.append(pool.submit(upload_one, seg_path))
            if len(inflight) >= args.concurrency:
                commit_one()
        while inflight:
            commit_one()
    finally:
        # 中途抛错就别再往上传了，直接连排队的一起取消；已经传上去但没来得及
        # 记进 manifest 的最多 concurrency-1 段，重跑会重传，不影响正确性。
        pool.shutdown(wait=False, cancel_futures=True)

    flusher.flush_async(args.slug, pending_d1, manifest)
    flusher.join()

    print(f"Done: {manifest_path}")

    if not args.keep_local:
        cleanup_local_if_synced(args.slug, hls_dir, len(segments))


if __name__ == "__main__":
    main()
