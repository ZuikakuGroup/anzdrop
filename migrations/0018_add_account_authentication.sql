-- 任意のパスキー・認証アプリOTP。ファイルの復号鍵は扱わない。
CREATE TABLE account_passkeys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  webauthn_user_id TEXT NOT NULL,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_account_passkeys_account ON account_passkeys(account_id);

CREATE TABLE account_totp (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  encrypted_secret TEXT,
  last_used_step INTEGER NOT NULL DEFAULT -1,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL DEFAULT 0
);

-- id はブラウザのHttpOnly Cookieに渡すランダムトークンのSHA-256。
-- 一回の認証・操作にだけ使い、期限を過ぎた行は定期掃除でも削除する。
CREATE TABLE account_auth_challenges (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  session_version INTEGER,
  purpose TEXT NOT NULL,
  action TEXT,
  target_id TEXT,
  challenge TEXT,
  payload TEXT,
  expires_at INTEGER NOT NULL,
  claim TEXT
);
CREATE INDEX idx_account_auth_challenges_expiry ON account_auth_challenges(expires_at);
CREATE INDEX idx_account_auth_challenges_account ON account_auth_challenges(account_id);
