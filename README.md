# archive.cerise-bouquet.xyz

个人视频档案站。零付费：Cloudflare Workers + D1 + Telegram 私有频道当对象存储，认证接 [yuuuiv/auth](https://github.com/yuuuiv/auth)。

架构设计与选型理由见 [ARCHITECTURE.md](ARCHITECTURE.md)；本文档是日常操作手册。

## 仓库结构

```
archive/
  frontend/                 React + Vite + Tailwind + hls.js + ArtPlayer
  workers/
    site/                   archive.cerise-bouquet.xyz：前端静态资产 + /api/* + 登录
    media/                  media.cerise-bouquet.xyz：鉴权 + 边缘缓存 + Telegram 回源
  scripts/
    process.ps1             ffmpeg 切片 + 封面 + 分段大小校验
    upload.py                限速上传 Telegram + 边传边写 D1，断点续传
    import-manifest.ps1     旧版一次性导入脚本（正常流程用 upload.py 就够，不用单独跑这个）
    set-live-poster.py      给某个 live 传自定义目录封面（见下方"场次封面图"）
  schema/schema.sql          D1 建表语句
  manifests/                 每个视频的清单备份（slug ↔ Telegram file_id 映射 + 元数据），务必保留
  covers/                    自定义 live 封面原图，本地暂存，已 gitignore
```

## 环境准备

- Node.js、ffmpeg、Python 3（装了 `requests` 库）
- `npx wrangler login` 登录 Cloudflare 账号
- 仓库根目录建 `.env`（抄 `.env.example`）：

  ```
  token=<Telegram bot token>
  chat_id=<私有频道 chat_id，负数>
  ```

## 上新一个视频：完整流程

以下用真实用过的一条命令举例。

### 1. 切片

```powershell
.\scripts\process.ps1 -InputFile "E:\[231021] [Rehearsal] 蓮ノ空1st 福岡Day1.ts" -Slug "231021-hasunosora-1st-fukuoka-day1"
```

- 输出到 `E:\hls\<slug>\`（可用 `-OutputRoot` 改路径）
- 视频流直接 `-c:v copy`，不重编码，速度约等于磁盘读写；音频转标准 AAC
- 每 4 秒切一段，自动校验没有分段超过 Telegram Bot 的 20MB 下载上限，超了会直接报错并列出违规分段
- 封面固定截**视频第一帧**（`-ss 0`），不是挑的时间点画面

文件名一般形如 `[日期] [Rehearsal/Final Rehearsal] <企划><场次> <场地>Day<N>.ts`，`-Slug` 按 `<日期>-<企划拼音>-<场次简写>-<场地拼音>-day<N>` 的模式手动起，保持和已有视频一致的可读性即可，没有强制规则。

### 2. 准备元数据

命令行参数传中文在 Windows 上偶尔会被子进程编码搞乱，统一用 `--meta-file` 传一个 UTF-8 JSON 文件，别用 `--title`/`--franchise-name` 这些参数直接传中文：

```json
{
  "title": "蓮ノ空1st Live Tour 福岡Day1（Rehearsal）",
  "date": "2023-10-21",
  "franchise_slug": "hasunosora",
  "franchise_name": "蓮ノ空",
  "live_slug": "1st",
  "live_name": "1st Live Tour"
}
```

存成 `manifests/<slug>.meta.json`。同一个企划/场次(live) 下的多个文件，`franchise_slug`/`franchise_name`/`live_slug`/`live_name` 四个字段填一样的值，靠这个把它们分到同一组——系统不会去解析文件名猜归属。

### 3. 上传

```bash
python scripts/upload.py --slug 231021-hasunosora-1st-fukuoka-day1 \
  --meta-file manifests/231021-hasunosora-1st-fukuoka-day1.meta.json
```

行为：

- 封面最先传，视频立刻会出现在网站列表里（标"上传中"），不用等全部分段传完
- 之后每传完一批分段（默认 20 个一批）就同步写入 D1 一次，`media.cerise-bouquet.xyz` 那边的播放列表跟着实时增长（HLS `EVENT` 类型），**可以边传边看**，播放器会自动发现新到的分段
- 分段全部传完才会在播放列表末尾补 `#EXT-X-ENDLIST`，之后播放列表按点播内容长期边缘缓存
- 限速固定 3.5 秒一条（Telegram 频道限制约 20 条/分钟），一部 2000+ 分段的视频大概两小时上下
- **中断了直接重跑同一条命令就行**：`manifests/<slug>.json` 是本地断点，已经传过的分段、已经同步 D1 的分段都会跳过，不会重复消耗速率也不会丢进度
- 网络抖动导致的 Telegram / D1 调用失败会自动重试（指数退避，5 次），不会因为一次瞬时失败就把几小时的任务打断

### 4. 完事

D1 已经是最新的，前端马上能看到。不需要额外跑导入脚本或重新部署 Worker。

## 场次(live) 封面图

目录网格里每个 live 卡片默认用该 live 第一个文件的视频截图当封面。想换成官方主视觉之类的自定义图（跟任何一个视频的截图无关，单独存）：

1. 把图片扔进 `covers/`（已 gitignore，本地暂存用）。文件名扩展名不重要——脚本按实际内容识别，浏览器把图片存成 `.htm` 也一样能传。
2. ```bash
   python scripts/set-live-poster.py --franchise-slug hasunosora --live-slug 1st --image "covers/1st Live Tour.htm"
   ```
3. 脚本会自动把图按长边等比缩放塞进 16:9 画布、多出来的边补白（网格卡片是 `object-fit: cover`，原图不是 16:9 会被裁，先补白避免裁到内容），传到 Telegram，写进 D1 的 `live_posters` 表。海报 URL 带版本号，刷新网站立刻生效，不用清缓存、不用重新部署。
4. 同一个 `franchise-slug`/`live-slug` 再跑一次就是换图（覆盖），不会重复建行。

视频自己详情页的封面（`process.ps1` 截的第一帧）跟这个是两回事，互不影响。

## 部署 Worker / 前端

```bash
cd frontend && npm run build
cd ../workers/site && npx wrangler deploy
cd ../media && npx wrangler deploy
```

改了 `schema/schema.sql` 要手动应用：

```bash
npx wrangler d1 execute cerise-archive --remote --file=schema/schema.sql
```

## 数据结构

`videos` 表一行 = 一个上传的文件（对应一个 `.ts` 源文件切出来的一场 HLS）。`franchise_slug`/`live_slug` 把多个文件分组成"企划 → 场次(live) → 文件"三层，前端首页按这个结构渲染（企划间滚动切场景，场次网格里点场次进详情页，详情页滚动切文件）。没填归属信息的视频会归到"未分类"，不会消失。

`segments` 表一行 = 一个 HLS 分段，存 Telegram `file_id` 和真实时长（不是固定 4 秒，末尾分段通常更短）。`media` Worker 请求 `master.m3u8` 时**实时**从这张表拼播放列表，不存静态文本——2000+ 分段的视频存成一整段文本会直接撑爆 D1 单条 SQL 语句体积上限。

`live_posters` 表（`franchise_slug` + `live_slug` 为主键）存目录网格卡片的自定义封面，没有对应行时前端退回用该 live 第一个文件的 poster。

## 已知限制

- 传视频的这台电脑网络断了 Telegram 上传会失败（有重试，但重试耗尽还是会退出），中断后重跑命令续传即可
- Bot 单文件下载上限 20MB，决定了分段只能切 4 秒左右，改不了除非换更贵的存储方案（见 ARCHITECTURE.md 的出口章节）
