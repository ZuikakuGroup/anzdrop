-- 有料プランのブラウザ内プレビュー機能(MP4/MP3/JPEG/PNG)。
-- account_idはsharesに保存しないため、アップロード時点のアップローダーの
-- 実効プランから可否を1度だけ確定して保存する(expires_atと同じ方式)。
ALTER TABLE shares ADD COLUMN preview_allowed INTEGER NOT NULL DEFAULT 0;
