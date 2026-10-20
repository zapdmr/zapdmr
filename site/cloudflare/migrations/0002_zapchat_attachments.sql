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
