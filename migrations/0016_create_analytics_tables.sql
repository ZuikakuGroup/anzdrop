-- 計測・分析基盤(要件定義書v1.0)。生イベントはappend-onlyで90日保持、
-- 日次集計は24ヶ月以上保持する(要件書20〜22章)。ファイル本体・復号鍵・
-- 暗号鍵・ファイル名・URL Fragment/Query全体・メールアドレス・真のIPは
-- このテーブルへ一切保存しない(アプリ層のZodスキーマとPrivacy Guardで強制)。

CREATE TABLE analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_name TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  anonymous_client_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  analytics_transfer_id TEXT,
  attempt_id TEXT,
  source TEXT,
  medium TEXT,
  campaign TEXT,
  content TEXT,
  term TEXT,
  landing_path TEXT,
  referrer_domain TEXT,
  device_class TEXT,
  browser_family TEXT,
  locale TEXT,
  properties TEXT
);

CREATE INDEX idx_analytics_events_name_time ON analytics_events(event_name, occurred_at);
CREATE INDEX idx_analytics_events_client ON analytics_events(anonymous_client_id, occurred_at);
CREATE INDEX idx_analytics_events_transfer ON analytics_events(analytics_transfer_id);

CREATE TABLE analytics_daily_metrics (
  date TEXT PRIMARY KEY,
  unique_senders INTEGER NOT NULL DEFAULT 0,
  new_senders INTEGER NOT NULL DEFAULT 0,
  upload_starts INTEGER NOT NULL DEFAULT 0,
  upload_successes INTEGER NOT NULL DEFAULT 0,
  download_starts INTEGER NOT NULL DEFAULT 0,
  download_successes INTEGER NOT NULL DEFAULT 0,
  successful_transfers INTEGER NOT NULL DEFAULT 0,
  recipient_to_sender_conversions INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  landing_sessions INTEGER NOT NULL DEFAULT 0,
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
