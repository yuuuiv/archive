"""最小自检：纯函数逻辑，不联网。 python scripts/test_upload.py"""
from upload import parse_segment_durations, rewrite_m3u8, sql_escape

M3U8 = """#EXTM3U
#EXT-X-VERSION:3
#EXTINF:4.000000,
seg_00000.ts
#EXTINF:4.000000,
seg_00001.ts
#EXTINF:2.500000,
seg_00002.ts
#EXT-X-ENDLIST
"""

durations = parse_segment_durations(M3U8)
assert durations == {
    "seg_00000.ts": 4.0,
    "seg_00001.ts": 4.0,
    "seg_00002.ts": 2.5,
}, durations

rewritten = rewrite_m3u8(M3U8, "test-slug", "https://media.example.com")
assert "https://media.example.com/test-slug/seg_00000.ts" in rewritten
assert "https://media.example.com/test-slug/seg_00002.ts" in rewritten
assert "#EXTINF:4.000000," in rewritten  # 注释行原样保留
assert "seg_00000.ts" not in rewritten.splitlines()  # 原始相对路径已被替换，不应再单独成行

assert sql_escape("O'Brien") == "O''Brien"
assert sql_escape(None) == ""

print("OK")
