-- パスワード保護: サーバーはパスワードを知らないので、パスワード由来の鍵でラップした
-- 暗号化キーだけを保存する(未設定時はどちらもNULL)。
ALTER TABLE shares ADD COLUMN wrapped_key TEXT;
ALTER TABLE shares ADD COLUMN key_salt TEXT;

-- 保存期間「1回」用。ファイル単位でダウンロード回数の上限を持たせる。
ALTER TABLE uploads ADD COLUMN max_downloads INTEGER;

ALTER TABLE files ADD COLUMN max_downloads INTEGER;
ALTER TABLE files ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0;
