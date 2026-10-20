-- Separate, explicit consent. Existing registrations/users remain opted out.
-- NULL on registrations means an older app did not ask this optional question.
ALTER TABLE registrations ADD COLUMN update_notifications INTEGER CHECK(update_notifications IN (0,1));
ALTER TABLE registrations ADD COLUMN update_consent_at INTEGER;
ALTER TABLE registrations ADD COLUMN downloaded_at INTEGER;
ALTER TABLE registrations ADD COLUMN downloaded_version TEXT;
ALTER TABLE users ADD COLUMN update_notifications INTEGER NOT NULL DEFAULT 0 CHECK(update_notifications IN (0,1));
ALTER TABLE users ADD COLUMN update_consent_at INTEGER;
ALTER TABLE users ADD COLUMN update_consent_version TEXT;
ALTER TABLE users ADD COLUMN downloaded_at INTEGER;
ALTER TABLE users ADD COLUMN downloaded_version TEXT;
CREATE INDEX IF NOT EXISTS users_release_audience ON users(update_notifications,update_consent_at,downloaded_at);
CREATE TABLE IF NOT EXISTS release_announcements (
 version TEXT PRIMARY KEY,
 release_url TEXT NOT NULL,
 published_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS release_notification_outbox (
 id TEXT PRIMARY KEY,
 release_version TEXT NOT NULL REFERENCES release_announcements(version) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 payload_cipher TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued','leased','sending','sent','delivered','failed','canceled','expired','unknown')),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 lease_id TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,
 started_at INTEGER,
 submitted_at INTEGER,
 delivered_at INTEGER,
 UNIQUE(release_version,user_id)
);
CREATE INDEX IF NOT EXISTS release_notification_pending ON release_notification_outbox(status,expires_at,created_at);
CREATE INDEX IF NOT EXISTS release_notification_user ON release_notification_outbox(user_id,status);
CREATE TABLE IF NOT EXISTS release_notification_throttle (
 id INTEGER PRIMARY KEY CHECK(id=1),
 next_dispatch_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO release_notification_throttle(id,next_dispatch_at) VALUES(1,0);
-- A phone HMAC preserves an incoming PARAR across registrations. No raw number.
CREATE TABLE IF NOT EXISTS release_notification_suppressions (
 phone_hash TEXT PRIMARY KEY,
 stopped_at INTEGER NOT NULL
);
