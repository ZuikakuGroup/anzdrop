-- アカウントIDを本人が自由に設定できるようにしたことで、IDの予測不可能性に
-- 頼った総当たり対策が効かなくなるため、失敗回数によるログインロックアウトを
-- 追加する(app/api/account/login/route.ts)。
ALTER TABLE accounts ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN locked_until TEXT;
