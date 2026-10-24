CREATE TABLE IF NOT EXISTS app_activations (
 hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS app_activations_expiry ON app_activations(expires_at);
CREATE INDEX IF NOT EXISTS app_activations_user ON app_activations(user_id);
CREATE TABLE IF NOT EXISTS app_preferences (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>0),
 cipher TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
