CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_reports_share_id ON reports (share_id);
