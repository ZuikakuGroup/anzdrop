-- パスワード再設定(リカバリー)時に、盗まれた可能性のある既存セッションを
-- 無効化できるようにする。JWTにこの値を埋め込み、検証のたびにDBの値と
-- 比較する。値が変わったら、それより前に発行されたセッションは全て失効する。
ALTER TABLE accounts ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
