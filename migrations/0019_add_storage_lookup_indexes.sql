-- Index existing metadata only; no new user information or retention policy.
CREATE INDEX idx_uploads_created_at ON uploads (created_at, id);
CREATE INDEX idx_uploads_storage_key ON uploads (storage_key);
CREATE INDEX idx_files_storage_key ON files (storage_key);
