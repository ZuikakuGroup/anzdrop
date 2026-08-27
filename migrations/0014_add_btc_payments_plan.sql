-- Bitcoin(OpenNode)決済で「どのプラン(standard/premium)への支払いか」をWebhook確定時に
-- 判定できるようにする。charge作成時にリクエストのplanをここへ記録し、Webhook確定時に
-- 読み戻してaccounts.planへ反映する(SetupはPOST /api/billing/btc/charge側)。
ALTER TABLE btc_payments ADD COLUMN plan TEXT NOT NULL DEFAULT 'premium';
