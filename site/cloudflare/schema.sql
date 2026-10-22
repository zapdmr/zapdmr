-- Apply to the DB D1 binding before enabling the Worker API.
-- Data Encryption Key must be preserved independently of the database backup.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  callsign TEXT NOT NULL,
  dmr_id TEXT NOT NULL,
  phone_cipher TEXT NOT NULL,
  phone_hash TEXT NOT NULL,
  share_phone INTEGER NOT NULL CHECK (share_phone IN (0,1)),
  platform TEXT NOT NULL CHECK (platform IN ('android','windows')),
  created_at INTEGER NOT NULL,
  notice_version TEXT NOT NULL,
  whatsapp_verified INTEGER NOT NULL DEFAULT 0,
  verified_at INTEGER,
  update_notifications INTEGER CHECK(update_notifications IN(0,1)),
  update_consent_at INTEGER,
  downloaded_at INTEGER,
  downloaded_version TEXT
);
CREATE INDEX IF NOT EXISTS registrations_retention ON registrations(created_at);
CREATE INDEX IF NOT EXISTS registrations_identity ON registrations(callsign,phone_hash);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  callsign TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  dmr_id TEXT UNIQUE NOT NULL,
  phone_cipher TEXT NOT NULL,
  phone_hash TEXT NOT NULL,
  share_phone INTEGER NOT NULL CHECK (share_phone IN (0,1)),
  created_at INTEGER NOT NULL,
  verified_at INTEGER NOT NULL,
  whatsapp_verified INTEGER NOT NULL DEFAULT 1,
  verification_method TEXT NOT NULL DEFAULT 'direct',
  update_notifications INTEGER NOT NULL DEFAULT 0 CHECK(update_notifications IN(0,1)),
  update_consent_at INTEGER,
  update_consent_version TEXT,
  downloaded_at INTEGER,
  downloaded_version TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiration ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS codes (
  registration_id TEXT PRIMARY KEY REFERENCES registrations(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  requested_at INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'direct',
  challenge_hash TEXT,
  challenge_cipher TEXT,
  reverse_confirmed_at INTEGER
);
CREATE INDEX IF NOT EXISTS codes_expiration ON codes(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS codes_challenge ON codes(challenge_hash) WHERE challenge_hash IS NOT NULL;
CREATE TABLE IF NOT EXISTS whatsapp_outbox (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  payload_cipher TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS whatsapp_outbox_pending ON whatsapp_outbox(status,expires_at,lease_until);
CREATE TABLE IF NOT EXISTS whatsapp_bridge_state (
  id INTEGER PRIMARY KEY CHECK (id=1),
  last_seen_at INTEGER NOT NULL,
  connected INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sender TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body_cipher TEXT NOT NULL,
  delivered_at INTEGER,
  at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS messages_pair ON messages(sender,recipient,at,id);
CREATE INDEX IF NOT EXISTS messages_receipts ON messages(sender,recipient,read_at,id);
CREATE INDEX IF NOT EXISTS messages_at_cursor ON messages(at,id);
CREATE INDEX IF NOT EXISTS messages_read_cursor ON messages(read_at,id);
CREATE TABLE IF NOT EXISTS blocks (
  owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  peer TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(owner,peer)
);

-- The identity is an HMAC, never the raw IP address or phone number.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT NOT NULL,
  identity TEXT NOT NULL,
  n INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(bucket,identity)
);
CREATE INDEX IF NOT EXISTS rate_limits_expiration ON rate_limits(expires_at);
-- Additive: preserves existing users, sessions, OTPs and messages.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS attachments (
 id TEXT PRIMARY KEY,
 sender TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 recipient TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name_cipher TEXT NOT NULL,
 mime TEXT NOT NULL,
 size INTEGER NOT NULL CHECK(size>0 AND size<=15728640),
 created_at INTEGER NOT NULL,
 ready INTEGER NOT NULL DEFAULT 0 CHECK(ready IN(0,1))
);
CREATE INDEX IF NOT EXISTS attachments_sender ON attachments(sender,created_at);
CREATE TABLE IF NOT EXISTS attachment_chunks (
 attachment_id TEXT NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
 part INTEGER NOT NULL,
 iv BLOB NOT NULL,
 cipher BLOB NOT NULL,
 PRIMARY KEY(attachment_id,part)
);
CREATE TABLE IF NOT EXISTS message_attachments (
 message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
 attachment_id TEXT UNIQUE NOT NULL REFERENCES attachments(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS message_requests (
 sender TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 client_id TEXT NOT NULL,
 message_id TEXT UNIQUE NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 PRIMARY KEY(sender,client_id)
);
CREATE TRIGGER IF NOT EXISTS delete_message_attachment BEFORE DELETE ON messages BEGIN
 DELETE FROM attachments WHERE id IN (SELECT attachment_id FROM message_attachments WHERE message_id=OLD.id);
END;

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

-- Additive: legacy sessions, messages and account identifiers remain valid.


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

CREATE TABLE IF NOT EXISTS app_releases (
 version_code INTEGER PRIMARY KEY, version TEXT NOT NULL,
 changelog TEXT NOT NULL, apk_url TEXT NOT NULL, sha256 TEXT NOT NULL,
 bytes INTEGER NOT NULL, min_supported_code INTEGER NOT NULL DEFAULT 0,
 required_reason TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, published_at INTEGER
);
CREATE INDEX IF NOT EXISTS app_release_latest ON app_releases(published,version_code DESC);
