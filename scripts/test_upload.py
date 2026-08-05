"""最小自检：纯函数逻辑，不联网。 python scripts/test_upload.py"""
import random
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor

from upload import RateLimiter, parse_segment_durations, rewrite_m3u8, sql_escape

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

# 并发下限速器仍要卡住"发起"的间隔，否则 4 个线程会一起冲出去触发 Telegram 429
INTERVAL, N, WORKERS = 0.05, 12, 4
limiter = RateLimiter(INTERVAL)

t0 = time.monotonic()
with ThreadPoolExecutor(max_workers=WORKERS) as ex:
    list(ex.map(lambda _: limiter.wait(), range(N)))
elapsed = time.monotonic() - t0
# 总耗时就是消息速率：N 次发起至少要铺开 (N-1) 个间隔。限速真被并发绕过的话
# 这里会掉到 N/WORKERS*INTERVAL，差一个数量级。0.95 是给 Windows 计时器粒度留的余量。
floor = (N - 1) * INTERVAL * 0.95
assert elapsed >= floor, f"限速被并发绕过了: {elapsed:.3f}s < {floor:.3f}s"

# 提交顺序 = 落库顺序：先完成的段不能插队，否则边传边看的播放列表会出现空洞
pending = deque()
done = []
with ThreadPoolExecutor(max_workers=WORKERS) as ex:
    for i in range(20):
        # 故意让后面的任务先做完
        pending.append(ex.submit(lambda n=i: (time.sleep(random.uniform(0, 0.02)), n)[1]))
        if len(pending) >= WORKERS:
            done.append(pending.popleft().result())
    while pending:
        done.append(pending.popleft().result())
assert done == list(range(20)), f"落库乱序: {done}"

print("OK")
