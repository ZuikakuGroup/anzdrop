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

`npm run deploy` は Wrangler の `--var` を通じて `DEPLOYMENT_ENV=production` を本番 Worker にだけ注入する。共有の `wrangler.jsonc` には定義しないため、ローカルプレビューや未指定の環境には引き継がれない。

## Cloudflareリソース

[`wrangler.jsonc`](../wrangler.jsonc) で以下を宣言している。

- **Workers**: `name: "anzdrop"`、エントリーポイントは `custom-worker.ts`。
- **D1**: `binding: "DB"`, `database_name: "anzdrop-db"`(`database_id` は固定値でリポジトリに含まれる。新しい環境向けに作り直す場合は `wrangler d1 create anzdrop-db` 後にIDを書き換える)。
- **R2**: `binding: "FILES_BUCKET"`, `bucket_name: "anzdrop"`。
- **Cron Trigger**: `"0 */6 * * *"`(6時間ごと、期限切れ共有・放置アップロードの掃除。[`architecture.md`](./architecture.md#掃除cleanup)参照)。
- **vars**: `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD`(Cloudflare Accessの設定)、`STRIPE_PRICE_ID_STANDARD` / `STRIPE_PRICE_ID_PREMIUM` / `OPENNODE_BTC_CHARGE_AMOUNT_USD_STANDARD` / `OPENNODE_BTC_CHARGE_AMOUNT_USD_PREMIUM` / `OPENNODE_BTC_DAYS_PER_CHARGE`(有料プランの設定、上記の表を参照)。
- **secrets**(`wrangler secret put` で設定、リポジトリには含まれない): 上記の表を参照。

## セキュリティレスポンスヘッダ(`proxy.ts`)

全レスポンスに CSP などのセキュリティヘッダを付与する [`proxy.ts`](../proxy.ts)(Next.js 16 の Proxy。詳細は [`architecture.md`](./architecture.md#セキュリティレスポンスヘッダ))について、デプロイ運用上の注意:

- **OpenNext 上では「Node.js middleware」として扱われ、OpenNext 側のサポートは実験的・非公式**(`opennextjs-cloudflare build` 時に `Node.js middleware support is experimental` の警告が出る)。本番相当のプレビュー(`npm run preview`)で「レスポンスの CSP 内の nonce と HTML 内の全 `<script nonce>` が一致し、リクエストごとに変わる」ことをスモーク確認し、**OpenNext / Next を更新したときは同じ確認を行う**こと。
- HSTS (`Strict-Transport-Security`) は `npm run deploy` が本番 Worker に注入する `DEPLOYMENT_ENV=production` の場合のみ付与する。未設定・staging・preview・test では付与しない。
- CSP は既定で enforce(ブロックする)。新しい外部フローを入れた直後など、まず観測だけしたい場合は Worker の環境変数 `CSP_REPORT_ONLY=1` を設定すると `Content-Security-Policy-Report-Only` になり、違反はブラウザ devtools に出るだけでブロックされない。問題ないことを確認したらこの変数を外す。
- enforce 切り替え・大きめの変更の前に実ブラウザで最低限確認する導線: Turnstile のインタラクティブチャレンジ表示、Stripe Payment Element(3D セキュア含む)、複数ファイルの一括 ZIP ダウンロード、画像/動画/音声プレビュー、BTC hosted checkout への遷移。

## Workerのスクリプトサイズ上限

Cloudflare Workersにはスクリプトサイズの上限があり、**無料プランでは gzip 後 3 MiB**(有料プランは 10 MiB)。超えるとデプロイが `code: 10027` で失敗する。Next.jsアプリ全体が1つのWorkerに入るため、この上限には現実的に近づきうる。

現在のサイズは `npx opennextjs-cloudflare build && node scripts/strip-vercel-og.mts && npx wrangler deploy --dry-run` の出力(`Total Upload: ... / gzip: ...`)で確認できる。

このリポジトリでは、使っていない `@vercel/og`(OG画像の動的生成ライブラリ。`resvg.wasm` だけで gzip 約 517 KiB)をバンドルから外すことでサイズを抑えている。混入経路が2つあるため、対策も2つある。

- **サーバー関数側**: Next.jsのファイルトレース(`.next/server/**/*.nft.json`)に `@vercel/og` 一式が入ってしまう(観測時点では `.wasm` を静的importしているルート、すなわち `lib/account/wasm-argon2` 経由の `/api/account/{login,signup,recover}` のトレースにのみ現れていた)。[`next.config.ts`](../next.config.ts) の `outputFileTracingExcludes` で、全ルートを対象にトレースから除外する。`@opennextjs/cloudflare` は「トレースに現れなければ未使用」と判断して、throwするシムに差し替えてくれる。
- **middleware(`proxy.ts`)側**: `@opennextjs/cloudflare` のNode.js middleware用バンドラには上記のシム差し替えが無く、Turbopackランタイムのパッチが常に `@vercel/og` のimportを注入する(このリポジトリが使う1.20.5と、公開されている最新の1.20.6のどちらでも同じ)。設定では回避できないため、ビルド後に [`scripts/strip-vercel-og.mts`](../scripts/strip-vercel-og.mts) が `.open-next/middleware/handler.mjs` から取り除く。`npm run preview` / `npm run deploy` がビルドとデプロイの間で自動実行する。

このスクリプトはバンドルの構造が想定と違えば例外を投げてビルドを失敗させる。`@opennextjs/cloudflare` や Next.js の更新後に失敗した場合は、上流が同等の最適化を入れた(=スクリプトが不要になった)か、出力構造が変わったかのどちらか。前者ならスクリプトと `package.json` からの呼び出しを削除する。**OG画像の動的生成(`ImageResponse` / `next/og` / `opengraph-image`)を導入する場合は、上記2つの対策をどちらも取り除く必要がある。**

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
