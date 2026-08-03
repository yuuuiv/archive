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
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import requests

# Windows 后台任务重定向输出到文件时，默认走系统 ANSI 代码页（如 GBK），遇到 emoji 或
# wrangler 彩色 CLI 输出里的特殊字符会直接 UnicodeEncodeError 崩溃整个进程。强制 UTF-8。
sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]

REPO_ROOT = Path(__file__).resolve().parent.parent
TELEGRAM_BOT_DOWNLOAD_LIMIT = 20 * 1024 * 1024
D1_BATCH_SIZE = 20
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


def flush_segments_to_d1(slug: str, pending: list, manifest: dict, save):
    """写入 D1 成功后，把这批 seg_name 记进 manifest['d1_synced'] 并落盘——
    跟 Telegram 上传断点用同一套本地文件 checkpoint 机制，重启只补真正缺的那一小撮，
    不用反过来查 D1（那条路径在这台机器上试过，wrangler CLI 的 --json 输出偶尔不稳定）。"""
    if not pending:
        return
    values = ", ".join(
        f"('{sql_escape(slug)}', '{sql_escape(seg_name)}', '{sql_escape(file_id)}', {duration})"
        for seg_name, file_id, duration in pending
    )
    sql = (
        "INSERT INTO segments (slug, seg_name, file_id, duration_seconds) "
        f"VALUES {values} "
        "ON CONFLICT(slug, seg_name) DO UPDATE SET "
        "file_id = excluded.file_id, duration_seconds = excluded.duration_seconds;"
    )
    with_retry(lambda: d1_execute(sql))
    synced = set(manifest.get("d1_synced", []))
    synced.update(seg_name for seg_name, _, _ in pending)
    manifest["d1_synced"] = sorted(synced)
    save()
    pending.clear()


class RateLimiter:
    """Telegram 频道发消息限速 ~20/min，默认每次间隔 3.5s 留余量。"""

    def __init__(self, min_interval: float):
        self.min_interval = min_interval
        self._last = 0.0

    def wait(self):
        elapsed = time.monotonic() - self._last
        if elapsed < self.min_interval:
            time.sleep(self.min_interval - elapsed)
        self._last = time.monotonic()


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
    parser.add_argument("--rate-interval", type=float, default=3.5, help="两次上传间隔秒数")
    parser.add_argument("--d1-batch-size", type=int, default=D1_BATCH_SIZE)
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

    def save():
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

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
        save()
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
            flush_segments_to_d1(args.slug, pending_d1, manifest, save)
    flush_segments_to_d1(args.slug, pending_d1, manifest, save)
    if synced:
        print(f"  {len(synced)} segments already synced to D1, backfilled {len(manifest['segments']) - len(synced)} more")

    for seg_path in segments:
        idx = seg_path.stem.split("_")[1]  # "00007" 形式，保留前导零匹配文件名
        if manifest["segments"].get(idx):
            continue
        file_id = with_retry(lambda: send_document(session, token, chat_id, seg_path, limiter))
        manifest["segments"][idx] = file_id
        save()
        pending_d1.append((idx, file_id, durations.get(seg_path.name, 4.0)))
        print(f"  [{len(manifest['segments'])}/{len(segments)}] {seg_path.name} uploaded")
        if len(pending_d1) >= args.d1_batch_size:
            flush_segments_to_d1(args.slug, pending_d1, manifest, save)

    flush_segments_to_d1(args.slug, pending_d1, manifest, save)

    print(f"Done: {manifest_path}")


if __name__ == "__main__":
    main()
