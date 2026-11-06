-- Auditable, account-specific administrative recovery. No account or session is deleted.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS email_recovery_audit (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN('admin_bind_verified')),
  email_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS email_recovery_audit_user ON email_recovery_audit(user_id,created_at);
