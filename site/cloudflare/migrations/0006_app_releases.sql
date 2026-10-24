CREATE TABLE IF NOT EXISTS app_releases (
 version_code INTEGER PRIMARY KEY, version TEXT NOT NULL,
 changelog TEXT NOT NULL, apk_url TEXT NOT NULL, sha256 TEXT NOT NULL,
 bytes INTEGER NOT NULL, min_supported_code INTEGER NOT NULL DEFAULT 0,
 required_reason TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, published_at INTEGER
);
CREATE INDEX IF NOT EXISTS app_release_latest ON app_releases(published,version_code DESC);
