PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS profile_photos (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 mime TEXT NOT NULL CHECK(mime IN('image/jpeg','image/png','image/webp')),
 size INTEGER NOT NULL CHECK(size>0 AND size<=2097152),
 version INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profile_photo_chunks (
 user_id TEXT NOT NULL REFERENCES profile_photos(user_id) ON DELETE CASCADE,
 part INTEGER NOT NULL,
 iv BLOB NOT NULL,
 cipher BLOB NOT NULL,
 PRIMARY KEY(user_id,part)
);
