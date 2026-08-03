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
