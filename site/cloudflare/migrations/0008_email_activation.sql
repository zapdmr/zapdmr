ALTER TABLE users ADD COLUMN email_cipher TEXT;
ALTER TABLE users ADD COLUMN email_hash TEXT;
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0 CHECK(email_verified IN(0,1));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_hash ON users(email_hash) WHERE email_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_registrations (
  id TEXT PRIMARY KEY,
  callsign TEXT NOT NULL,
  dmr_id TEXT NOT NULL,
  email_cipher TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN('android','windows')),
  created_at INTEGER NOT NULL,
  verified_at INTEGER,
  notice_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS email_registrations_retention ON email_registrations(created_at);
CREATE INDEX IF NOT EXISTS email_registrations_identity ON email_registrations(callsign,email_hash);

CREATE TABLE IF NOT EXISTS email_codes (
  registration_id TEXT PRIMARY KEY REFERENCES email_registrations(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  requested_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS email_codes_expiration ON email_codes(expires_at);
