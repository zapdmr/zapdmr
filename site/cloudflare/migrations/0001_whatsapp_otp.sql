-- Additive migration for the existing 1.3.0 production database.
ALTER TABLE registrations ADD COLUMN whatsapp_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN verified_at INTEGER;
ALTER TABLE users ADD COLUMN whatsapp_verified INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN verification_method TEXT NOT NULL DEFAULT 'direct';
ALTER TABLE codes ADD COLUMN requested_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE codes ADD COLUMN mode TEXT NOT NULL DEFAULT 'direct';
ALTER TABLE codes ADD COLUMN challenge_hash TEXT;
ALTER TABLE codes ADD COLUMN challenge_cipher TEXT;
ALTER TABLE codes ADD COLUMN reverse_confirmed_at INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS codes_challenge ON codes(challenge_hash) WHERE challenge_hash IS NOT NULL;
CREATE TABLE IF NOT EXISTS whatsapp_outbox (
 id TEXT PRIMARY KEY, registration_id TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
 code_hash TEXT NOT NULL, payload_cipher TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0, lease_id TEXT, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS whatsapp_outbox_pending ON whatsapp_outbox(status,expires_at,lease_until);
CREATE TABLE IF NOT EXISTS whatsapp_bridge_state(id INTEGER PRIMARY KEY CHECK(id=1),last_seen_at INTEGER NOT NULL,connected INTEGER NOT NULL DEFAULT 0);
