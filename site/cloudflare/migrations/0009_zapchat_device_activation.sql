-- Additive ZapChat-only activation. Existing trusted devices are grandfathered once.
ALTER TABLE whatsapp_outbox ADD COLUMN purpose TEXT NOT NULL DEFAULT 'account' CHECK(purpose IN('account','zapchat'));
CREATE INDEX IF NOT EXISTS whatsapp_outbox_purpose ON whatsapp_outbox(purpose,status,expires_at,lease_until);
CREATE TABLE IF NOT EXISTS zapchat_device_authorizations (
 device_id TEXT PRIMARY KEY REFERENCES auth_devices(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 platform TEXT NOT NULL CHECK(platform IN('android','windows','legacy')),
 authorized_at INTEGER NOT NULL,
 inherited INTEGER NOT NULL DEFAULT 0 CHECK(inherited IN(0,1)),
 last_seen_at INTEGER NOT NULL,
 revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS zapchat_authorizations_user ON zapchat_device_authorizations(user_id,revoked_at);
CREATE TABLE IF NOT EXISTS zapchat_activation_codes (
 device_id TEXT PRIMARY KEY REFERENCES auth_devices(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 registration_id TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
 platform TEXT NOT NULL CHECK(platform IN('android','windows')),
 hash TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 requested_at INTEGER NOT NULL,
 mode TEXT NOT NULL,
 challenge_hash TEXT UNIQUE NOT NULL,
 challenge_cipher TEXT NOT NULL,
 reverse_confirmed_at INTEGER
);
CREATE INDEX IF NOT EXISTS zapchat_codes_expiry ON zapchat_activation_codes(expires_at);
INSERT OR IGNORE INTO zapchat_device_authorizations(device_id,user_id,platform,authorized_at,inherited,last_seen_at)
 SELECT id,user_id,'legacy',created_at,1,last_seen_at FROM auth_devices WHERE revoked_at IS NULL AND refresh_expires_at>CAST(strftime('%s','now') AS INTEGER)*1000;
