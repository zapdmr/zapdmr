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
  verified_at INTEGER
);
CREATE INDEX IF NOT EXISTS registrations_retention ON registrations(created_at);
CREATE INDEX IF NOT EXISTS registrations_identity ON registrations(callsign,phone_hash);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  callsign TEXT UNIQUE NOT NULL,
  dmr_id TEXT UNIQUE NOT NULL,
  phone_cipher TEXT NOT NULL,
  phone_hash TEXT NOT NULL,
  share_phone INTEGER NOT NULL CHECK (share_phone IN (0,1)),
  created_at INTEGER NOT NULL,
  verified_at INTEGER NOT NULL,
  whatsapp_verified INTEGER NOT NULL DEFAULT 1,
  verification_method TEXT NOT NULL DEFAULT 'direct'
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
