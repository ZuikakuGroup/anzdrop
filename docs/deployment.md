# デプロイ・CI/CD

## 自動デプロイ(GitHub Actions)

`main` ブランチへのpushをトリガーに [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) が実行され、以下を順に行う。

1. 依存関係インストール(`npm ci`)
2. `npm run lint`
3. `npx tsc --noEmit`
4. **D1マイグレーションの本番適用**: `npx wrangler d1 migrations apply DB --remote`
5. **デプロイ**: `npm run deploy`(内部で `opennextjs-cloudflare build && opennextjs-cloudflare deploy`)

いずれかのステップが失敗すると後続は実行されない(特にlint/型チェックの失敗時はマイグレーション適用・デプロイまで到達しない)。マイグレーションはデプロイより先に適用されるため、新しいカラム/テーブルを前提とするコードをデプロイする場合は、対応するマイグレーションファイルを同じPR/コミットに含めておけば自動的に順序よく反映される。

### 必要なGitHub Secrets

| Secret名 | 用途 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | `wrangler`のD1マイグレーション適用・デプロイ両方に使用。対象アカウントの Workers / D1 / R2 への書き込み権限が必要 |
| `TURNSTILE_SITE_KEY` | ビルド時に `NEXT_PUBLIC_TURNSTILE_SITE_KEY` としてクライアントバンドルへ埋め込まれる、Turnstileのサイトキー(公開情報) |
| `STRIPE_PUBLISHABLE_KEY` | ビルド時に `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` としてクライアントバンドルへ埋め込まれる、Stripeの公開可能キー(公開情報。Stripe.js/Payment Elementの初期化に使う) |

### Cloudflare Workersのシークレット(`wrangler secret put`、リポジトリには含まれない)

| Secret名 | 用途 |
| --- | --- |
| `TURNSTILE_SECRET_KEY` | Turnstile検証用のシークレットキー |
| `SESSION_SECRET` | アカウントのログインセッションJWTの署名鍵(HS256)。詳細は[`accounts.md`](./accounts.md) |
| `STRIPE_SECRET_KEY` | Stripe APIキー(Customer/Subscriptionの作成・取得・更新などのAPI呼び出しに使用) |
| `STRIPE_WEBHOOK_SECRET` | `/api/billing/stripe/webhook` の署名検証用シークレット(Stripeダッシュボードで作成したWebhookエンドポイントごとに発行される) |
| `OPENNODE_API_KEY` | OpenNode APIキー。charge作成とWebhook署名検証(HMAC鍵)の両方に使う |

### `wrangler.jsonc` の `vars`(非シークレット、リポジトリにコミット)

| 変数名 | 用途 |
| --- | --- |
| `STRIPE_PRICE_ID_STANDARD` / `STRIPE_PRICE_ID_PREMIUM` | Stripeダッシュボードで作成した、Standard/Premiumそれぞれの月額サブスクリプション用Priceのid |
| `OPENNODE_BTC_CHARGE_AMOUNT_USD_STANDARD` / `OPENNODE_BTC_CHARGE_AMOUNT_USD_PREMIUM` | Bitcoin「期間チャージ」1回分の金額(USD)。Standard/Premiumで別々に設定する |
| `OPENNODE_BTC_DAYS_PER_CHARGE` | 上記の支払いが確定した際に有効期限を延長する日数(両プラン共通) |

これらの金額・日数は暫定値([`lib/plan.ts`](../lib/plan.ts)参照)。実際のプラン内容が決まったら、この`vars`とStripeのPrice設定を合わせて更新する。

## Cloudflareリソース

[`wrangler.jsonc`](../wrangler.jsonc) で以下を宣言している。

- **Workers**: `name: "anzdrop"`、エントリーポイントは `custom-worker.ts`。
- **D1**: `binding: "DB"`, `database_name: "anzdrop-db"`(`database_id` は固定値でリポジトリに含まれる。新しい環境向けに作り直す場合は `wrangler d1 create anzdrop-db` 後にIDを書き換える)。
- **R2**: `binding: "FILES_BUCKET"`, `bucket_name: "anzdrop"`。
- **Cron Trigger**: `"0 0 * * *"`(毎日0時UTC、期限切れ共有・放置アップロードの掃除。[`architecture.md`](./architecture.md#掃除cleanup)参照)。
- **vars**: `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD`(Cloudflare Accessの設定)、`STRIPE_PRICE_ID_STANDARD` / `STRIPE_PRICE_ID_PREMIUM` / `OPENNODE_BTC_CHARGE_AMOUNT_USD_STANDARD` / `OPENNODE_BTC_CHARGE_AMOUNT_USD_PREMIUM` / `OPENNODE_BTC_DAYS_PER_CHARGE`(有料プランの設定、上記の表を参照)。
- **secrets**(`wrangler secret put` で設定、リポジトリには含まれない): 上記の表を参照。

## Cloudflare Access(管理画面の保護)

`/admin` と `/api/admin/*` はCloudflare Access配下のアプリケーションとして1つに統合されている(コミット「管理画面のCloudflare Accessアプリを/adminと/api/adminで1つに統合」)。エッジでのアクセス制御が主たる関門で、オリジン側(`lib/access.ts`の`verifyAccessJwt()`)でもJWT検証による多層防御を行っている。`/api/admin/**`(JSON API)は未検証時に`403`を返すが、`/admin`ページ自体(`app/admin/page.tsx`)は管理画面の存在を明かさないよう`404`(`notFound()`)を返す。

新しい環境でセットアップする場合の概略:

1. Cloudflare Zero Trustダッシュボードで `/admin*` と `/api/admin/*` を保護対象としたAccessアプリケーションを作成し、許可するIdP/メールアドレス等のポリシーを設定する。
2. 作成したアプリの Audience Tag を `wrangler.jsonc` の `CF_ACCESS_AUD` に、チームドメイン(`https://<team>.cloudflareaccess.com`)を `CF_ACCESS_TEAM_DOMAIN` に設定する。
3. 設定変更後は再デプロイが必要(`vars` はビルド時にWorkerへ埋め込まれる)。

## 有料プラン(Stripe / Bitcoin)のセットアップ

設計の詳細は[`accounts.md`](./accounts.md)を参照。新しい環境でセットアップする場合の概略:

1. Stripeダッシュボード(またはStripe API)でStandard用・Premium用それぞれの月額サブスクリプションProduct/Priceを作成し、そのidを`wrangler.jsonc`の`STRIPE_PRICE_ID_STANDARD`・`STRIPE_PRICE_ID_PREMIUM`に設定する。Webhook(`app/api/billing/stripe/webhook/route.ts`)はSubscriptionの実際のPrice IDを見てプランを判定するため、ここで設定したid以外のPriceで契約された場合はプランが反映されない(意図しないプラン活性化を防ぐための防御的な挙動)。
2. Stripeダッシュボードで秘密鍵・公開可能キーを取得し、秘密鍵は`wrangler secret put STRIPE_SECRET_KEY`で設定する。公開可能キーはGitHub Secretsの`STRIPE_PUBLISHABLE_KEY`に設定する(ビルド時に`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`としてクライアントへ埋め込まれる、公開情報)。
3. Stripeダッシュボードで`https://<本番ドメイン>/api/billing/stripe/webhook`宛のWebhookエンドポイントを作成し、`customer.subscription.updated`・`customer.subscription.deleted`を購読する。発行される署名シークレットを`wrangler secret put STRIPE_WEBHOOK_SECRET`で設定する。
4. OpenNodeでビジネスアカウントを作成(要KYB/KYC)し、APIキーを取得して`wrangler secret put OPENNODE_API_KEY`で設定する。OpenNode側でのWebhookエンドポイント登録は不要(charge作成時に`callback_url`として都度指定している)。
5. `wrangler.jsonc`の`OPENNODE_BTC_CHARGE_AMOUNT_USD_STANDARD`・`OPENNODE_BTC_CHARGE_AMOUNT_USD_PREMIUM`・`OPENNODE_BTC_DAYS_PER_CHARGE`を実際の価格に合わせて調整する。
6. `SESSION_SECRET`(ログインセッションJWTの署名鍵)を`openssl rand -base64 32`等で生成し、`wrangler secret put SESSION_SECRET`で設定する。

## 手動デプロイ・プレビュー

```bash
npm run preview  # ローカルでCloudflare Workers向けビルド後、wranglerのローカルプレビューを起動
npm run deploy   # ビルドしてCloudflare Workersへ直接デプロイ
```

手動デプロイ時は `CLOUDFLARE_API_TOKEN` 等の認証情報をローカルの `wrangler` にも設定しておく必要がある(`wrangler login` またはトークンを環境変数で渡す)。CIと同様、事前にD1マイグレーションの適用(`npx wrangler d1 migrations apply DB --remote`)を忘れないこと(`npm run deploy` はマイグレーションを自動実行しない)。
