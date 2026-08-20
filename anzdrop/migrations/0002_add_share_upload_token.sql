-- Migration number: 0002 	 2026-08-20T00:34:46.238Z

-- 共有への複数ファイル追加(相乗り)を認可するための、サーバー生成の秘密トークン。
-- shareIdはURLパスに含まれ第三者に露出しうるため、所有権の証明には使えない。
ALTER TABLE shares ADD COLUMN upload_token TEXT;
