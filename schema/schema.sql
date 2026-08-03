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
