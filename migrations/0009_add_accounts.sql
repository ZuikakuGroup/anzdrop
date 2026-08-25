-- アカウント制の有料プラン(Stripeサブスクリプション・Bitcoin決済)導入。
-- メールアドレスは収集しない。パスワード・リカバリーコードはハッシュのみ保存する。

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  recovery_code_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  plan_expires_at TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_accounts_stripe_customer_id ON accounts (stripe_customer_id);
CREATE INDEX idx_accounts_stripe_subscription_id ON accounts (stripe_subscription_id);

-- Bitcoin(OpenNode)は自動更新できないため、支払いのたびに有効期限を延長する
-- 「期間チャージ」方式。1レコードが1回分の支払いに対応する。
CREATE TABLE btc_payments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  opennode_charge_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  extends_plan_until TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_btc_payments_account_id ON btc_payments (account_id);
CREATE INDEX idx_btc_payments_opennode_charge_id ON btc_payments (opennode_charge_id);

-- Stripe Webhookはリトライで同一イベントが複数回届きうるため、処理済みイベントIDを
-- 記録して二重処理(プラン延長の重複適用など)を防ぐ。
CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL
);
