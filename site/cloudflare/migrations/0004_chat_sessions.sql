-- Additive: legacy sessions, messages and account identifiers remain valid.
ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN delivered_at INTEGER;
CREATE INDEX IF NOT EXISTS messages_delivery ON messages(recipient,delivered_at,at,id);
CREATE TABLE IF NOT EXISTS auth_devices (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 refresh_hash TEXT UNIQUE NOT NULL, previous_hash TEXT, refresh_expires_at INTEGER NOT NULL,
 rotated_at INTEGER NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
 revoked_at INTEGER, token_cipher TEXT NOT NULL, bootstrap_hash TEXT
);
CREATE INDEX IF NOT EXISTS auth_devices_previous ON auth_devices(previous_hash);
CREATE TABLE IF NOT EXISTS session_devices (
 session_hash TEXT PRIMARY KEY REFERENCES sessions(hash) ON DELETE CASCADE,
 device_id TEXT NOT NULL REFERENCES auth_devices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_devices_device ON session_devices(device_id);
