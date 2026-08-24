-- Migration number: 0001 	 2026-08-19T23:45:57.534Z

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_shares_expires_at ON shares (expires_at);

CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL REFERENCES shares (id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  encrypted_file_name TEXT NOT NULL,
  file_size INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_uploads_share_id ON uploads (share_id);

CREATE TABLE upload_parts (
  upload_session_id TEXT NOT NULL REFERENCES uploads (id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL,
  etag TEXT NOT NULL,
  PRIMARY KEY (upload_session_id, part_number)
);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL REFERENCES shares (id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  encrypted_file_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_files_share_id ON files (share_id);
