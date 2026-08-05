#!/usr/bin/env python3
"""
把一张自定义封面图设为某个 live 在目录网格里的预览图，跟任何一个视频的
自动截图无关；不设置时前端退回用该 live 第一个文件的 poster。

用法:
  python scripts/set-live-poster.py --franchise-slug hasunosora --live-slug 1st --image "1st Live Tour.htm"

图片按实际文件内容识别，扩展名无所谓（比如浏览器保存图片时错存成 .htm 也行）。
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import requests
from PIL import Image

# 目录网格卡片是 16:9，长边为准整张塞进去，缩完剩下的边补白，
# 避免 object-fit: cover 在非 16:9 原图上裁掉画面。
COVER_W, COVER_H = 1280, 720


def letterbox(src: Path, align: str = "center") -> Path:
    img = Image.open(src)
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        # 直接 .convert("RGB") 会把透明区域原样丢 alpha，留下底下未预乘的垃圾颜色；
        # 先合成到白底上再转 RGB，透明部分才会是真正的白色。
        img = img.convert("RGBA")
        flat = Image.new("RGBA", img.size, (255, 255, 255, 255))
        img = Image.alpha_composite(flat, img).convert("RGB")
    else:
        img = img.convert("RGB")

    scale = min(COVER_W / img.width, COVER_H / img.height)
    new_w, new_h = round(img.width * scale), round(img.height * scale)
    resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (COVER_W, COVER_H), "white")
    x = (COVER_W - new_w) // 2
    y = (COVER_H - new_h) if align == "bottom" else (COVER_H - new_h) // 2
    canvas.paste(resized, (x, y))
    out = Path(tempfile.gettempdir()) / f"{src.stem}.cover.jpg"
    canvas.save(out, "JPEG", quality=92)
    return out

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]

REPO_ROOT = Path(__file__).resolve().parent.parent
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


def sql_escape(value: str) -> str:
    return value.replace("'", "''")


def d1_count_videos(franchise_slug: str, live_slug: str) -> int:
    sql = (
        "SELECT COUNT(*) AS cnt FROM videos WHERE franchise_slug='"
        f"{sql_escape(franchise_slug)}' AND live_slug='{sql_escape(live_slug)}';"
    )
    result = subprocess.run(
        f'npx wrangler d1 execute {D1_DATABASE} --remote --json --command "{sql}"',
        shell=True,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        timeout=60,
    )
    if result.returncode != 0:
        return -1  # 查不到就别拦着设封面，只是少一句提示
    try:
        return json.loads(result.stdout)[0]["results"][0]["cnt"]
    except (json.JSONDecodeError, KeyError, IndexError):
        return -1


def d1_execute(sql: str):
    with tempfile.NamedTemporaryFile(mode="w", suffix=".sql", delete=False, encoding="utf-8") as f:
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--franchise-slug", required=True)
    parser.add_argument("--live-slug", required=True)
    parser.add_argument("--image", required=True, type=Path)
    parser.add_argument(
        "--align", choices=["center", "bottom"], default="center",
        help="缩放后贴到画布的位置，人物类立绘通常用 bottom 避免脚被留白顶起来",
    )
    args = parser.parse_args()

    if not args.image.exists():
        raise SystemExit(f"image not found: {args.image}")

    env = load_env(REPO_ROOT / ".env")
    token, chat_id = env["token"], env["chat_id"]

    cover_path = letterbox(args.image, args.align)
    try:
        with open(cover_path, "rb") as f:
            resp = requests.post(
                f"https://api.telegram.org/bot{token}/sendDocument",
                data={"chat_id": chat_id},
                files={"document": (cover_path.name, f)},
                timeout=120,
            )
        resp.raise_for_status()
        data = resp.json()
        if not data.get("ok"):
            raise RuntimeError(f"Telegram API error: {data}")
        file_id = data["result"]["document"]["file_id"]
    finally:
        cover_path.unlink(missing_ok=True)

    sql = f"""
INSERT INTO live_posters (franchise_slug, live_slug, poster_file_id)
VALUES ('{sql_escape(args.franchise_slug)}', '{sql_escape(args.live_slug)}', '{sql_escape(file_id)}')
ON CONFLICT(franchise_slug, live_slug) DO UPDATE SET poster_file_id = excluded.poster_file_id;
"""
    d1_execute(sql)
    print(f"live poster set: {args.franchise_slug}/{args.live_slug} -> {file_id}")

    # 目录树是从 videos 表建的，一个视频都没有的场次根本不会出现在网站上。
    # 封面照样存下来了，等视频传上去就生效——但不说一声的话，很容易以为是设失败了。
    n = d1_count_videos(args.franchise_slug, args.live_slug)
    if n == 0:
        print(
            f"  注意: {args.franchise_slug}/{args.live_slug} 目前没有任何视频，"
            "这个场次不会显示在网站上。封面已存好，视频传上去后自动生效。"
        )


if __name__ == "__main__":
    main()
