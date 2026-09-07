-- 保持期限切れイベントのoccurred_atによる削除を効率化する。
CREATE INDEX idx_analytics_events_occurred_at ON analytics_events(occurred_at);
