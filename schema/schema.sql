CREATE TABLE IF NOT EXISTS videos (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date TEXT,
    duration_seconds REAL,
    segment_count INTEGER,
    poster_file_id TEXT,
    m3u8 TEXT NOT NULL,
    franchise_slug TEXT,
    franchise_name TEXT,
    live_slug TEXT,
    live_name TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS segments (
    slug TEXT NOT NULL REFERENCES videos(slug),
    seg_name TEXT NOT NULL,
    file_id TEXT NOT NULL,
    duration_seconds REAL,
    PRIMARY KEY (slug, seg_name)
);

-- 目录网格里某个 live（如 "1st Live Tour"）的封面，跟任何单个视频的自动截图无关，
-- 未设置时前端退回用该 live 第一个文件的 poster。
CREATE TABLE IF NOT EXISTS live_posters (
    franchise_slug TEXT NOT NULL,
    live_slug TEXT NOT NULL,
    poster_file_id TEXT NOT NULL,
    PRIMARY KEY (franchise_slug, live_slug)
);

-- 一行 = 一次播放会话（打开播放页到离开）。播放器每 30 秒 upsert 同一行，
-- 而不是每次心跳插新行——一部 6 小时的视频按心跳插行会写爆 D1，改成原地更新后
-- 行数只跟"看了多少次"成正比。
--   watched_seconds  实际处于播放状态的墙钟秒数（暂停不计，拖动不会灌水）
--   max_position     本次会话到达过的最远播放位置，用来算完播率
--   viewer_hash      观众邮箱的 SHA-256 前 16 位，用于数独立观看人数。
--                    注意：用户基数小的时候，拿已知邮箱逐个哈希就能反查出是谁，
--                    这不是匿名化，只是不在这张表里直接存邮箱明文。
CREATE TABLE IF NOT EXISTS playback_sessions (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL,
    viewer_hash TEXT,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    watched_seconds REAL NOT NULL DEFAULT 0,
    max_position REAL NOT NULL DEFAULT 0,
    duration_seconds REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_playback_slug ON playback_sessions(slug);
CREATE INDEX IF NOT EXISTS idx_playback_updated_at ON playback_sessions(updated_at);
