CREATE TABLE IF NOT EXISTS push_devices (
 device_id TEXT PRIMARY KEY REFERENCES auth_devices(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT UNIQUE NOT NULL, token_cipher TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS push_outbox (
 message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 device_id TEXT NOT NULL REFERENCES push_devices(device_id) ON DELETE CASCADE,
 attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 PRIMARY KEY(message_id,device_id)
);
CREATE INDEX IF NOT EXISTS push_due ON push_outbox(next_at,expires_at);
