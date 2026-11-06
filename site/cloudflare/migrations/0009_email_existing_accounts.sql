-- Additive recovery proof for existing accounts. No user, session or message is changed.
ALTER TABLE email_registrations ADD COLUMN authorized_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS email_registrations_authorized_user ON email_registrations(authorized_user_id);
