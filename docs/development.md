# ローカル開発環境

## 前提

- Node.js 22.12以降（CIは24系。Astroの最低要件に合わせる）
- Cloudflareアカウント(D1・R2・Access・Turnstileを利用する場合。ローカルのD1/R2はwranglerのローカル永続化機能で完結するため、実際にAPIを叩く動作確認だけならCloudflareアカウント無しでも一部可能だが、`npm run preview`/`npm run deploy`やCloudflare Access連携の確認にはアカウントが必要)

## セットアップ手順

```bash
npm install
```

### 環境変数

| ファイル | 用途 | 主な変数 |
| --- | --- | --- |
| `.env.local`(gitignore対象) | Next.jsのビルド/実行時の環境変数 | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`・`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`・`LOCAL_ADMIN_BYPASS` |
| `.dev.vars`(gitignore対象) | ローカルのWorkers実行時シークレット(wranglerが読む) | `TURNSTILE_SECRET_KEY` |

いずれもリポジトリには含まれないため、各自発行して設定する。`NEXT_PUBLIC_TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY`は[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)から発行する(開発用にはテスト用の常時成功/失敗キーも利用可能)。`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`はStripeダッシュボード(テストモード)の「開発者」→「APIキー」から取得できる公開可能キー(`pk_test_...`)を使う。

ローカルで管理画面を確認する場合だけ、`.env.local`に`LOCAL_ADMIN_BYPASS=true`を設定できる。これは`NODE_ENV=development`かつ`localhost`/`127.0.0.1`/`::1`からのリクエストでのみCloudflare Access検証を迂回してローカル管理者として扱う。開発サーバー自体もループバックアドレスにだけ待ち受けるため、LANなど外部からは到達できない。本番・Preview・外部Hostでは有効にならない。確認後は設定を外す。

ブログのページネーションをmicroCMSへ書き込まずに確認する場合は、`.env.local`に`BLOG_USE_SEED_DATA=true`を設定する。ローカル開発時だけ15件の確認用記事へ切り替わり、`/blog`の2ページ目、記事詳細、関連記事、カテゴリ・タグ・著者ページを確認できる。本番・Previewでは同じ値が設定されても有効にならない。例外として、SEO/Lighthouse 監査用に `WEB_AUDIT=true` と併用した場合だけ production 起動でも seed が有効になる(手順は [`docs/web-audit.md`](./web-audit.md))。確認後はこの設定を外して開発サーバーを再起動する。

`wrangler.jsonc` の `vars`(`CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD`)はCloudflare Accessのチーム/アプリ設定に依存する値のため、自分の検証用Accessアプリを使う場合はここも書き換える。

### 機能ごとのWorkers Secret

`wrangler.jsonc` では `secrets.required` を定義しない。この指定はデプロイ時の必須チェックだけでなく、ローカルの `.dev.vars` / `.env` を一覧のキーだけに制限するため、任意機能のSecretが読み込まれなくなる。ローカルではリポジトリ直下のgitignore対象 `.dev.vars` に、検証する機能のSecretだけを設定し、開発サーバーを再起動する。別の開発用Workerや本番Secretの変更は不要。

| 機能 | `.dev.vars` に設定する名前 |
| --- | --- |
| アカウント・OTP | `TURNSTILE_SECRET_KEY`、`SESSION_SECRET`、`ACCOUNT_AUTH_ENCRYPTION_KEY` |
| R2直アップロード | `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`CLOUDFLARE_ACCOUNT_ID`（3つすべて） |
| microCMSの記事取得・Webhook | `MICROCMS_API_KEY`、`MICROCMS_WEBHOOK_SECRET` |
| Stripe / OpenNode / 分析 | `STRIPE_SECRET_KEY`・`STRIPE_WEBHOOK_SECRET` / `OPENNODE_API_KEY` / `ANALYTICS_SECRET` |

R2直アップロードのSecretが揃わない場合はproxyへフォールバックする。microCMSを使わない場合はそのSecretを省略できる。Webhookを検証する場合は `MICROCMS_WEBHOOK_SECRET` も設定する。実際の鍵はテスト用リソースのものを使い、ソースコード・ログ・コミットに含めない。OTP専用鍵の形式と本番への導入順は [deployment.md](./deployment.md) を参照。

### D1・R2のローカル永続化

`next.config.ts` で `initOpenNextCloudflareForDev()` にローカルD1/R2の永続化先をOSの一時ディレクトリ(`os.tmpdir()/anzdrop-wrangler-state`)に指定している(理由は後述の「既知の問題」参照)。この永続化先に対して初回のみマイグレーションを適用する必要がある。

```bash
npx wrangler d1 migrations apply DB --local --persist-to "$(node -e 'console.log(require(\"os\").tmpdir())')/anzdrop-wrangler-state"
```

新しいマイグレーションを追加した際も、上記コマンドで同じ永続化先に再適用すること。

> **注意:** `wrangler` CLIの `--persist-to` が書き込む実際のディレクトリ構成(`<path>/v3/d1/...`)と、`next dev` 経由(`@opennextjs/cloudflare`の `getPlatformProxy`)がバインディングとして実際に開く実行時のディレクトリ構成(`<path>/d1/...`、`v3`なし)がズレることがある。この場合CLIでの `migrations apply` が成功と表示されても、実際に動いている開発サーバーには反映されない(`D1_ERROR: no such table`等になる)。ズレを疑ったら、`lsof -p <workerdのpid>` で実際に開かれているsqliteファイルを特定し、そのファイルへ直接 `sqlite3 <file> < migrations/000N_*.sql` を実行する、または一度開発サーバーを再起動してから再度CLIでマイグレーションを適用する。

### 開発サーバー

```bash
npm run dev
```

内部的には `next dev --webpack --hostname 127.0.0.1` を実行しており、ループバックアドレスだけで待ち受ける。`LOCAL_ADMIN_BYPASS=true`を使う際は、`--hostname`を上書きしてlocalhost以外へ待ち受けさせないこと。

> **既知の問題(Turbopack)**: `next dev`(Turbopackモード、デフォルト)では、ローカルD1/R2の永続化ディレクトリへの定期的な書き込みをTurbopackのファイル監視が変更として検知し続け、既知のTurbopack内部パニック(`Next.js package not found`)を踏んで、ブラウザへ無限にフルリロードを送り続ける不具合が確認されている。これを回避するため、`dev` スクリプトはwebpackモードを使っている。本番ビルド(`npm run build`/`npm run deploy`)はTurbopackのまま影響を受けない。

> **既知の問題(.wasm静的import)**: [`lib/account/wasm-argon2/`](../lib/account/wasm-argon2/)の`.wasm`ファイルは、`next dev`(webpack)と`next build`(Turbopack)とで別々の設定(`next.config.ts`の`webpack()`・`turbopack.rules`)を必要とし、かつ実行時に渡ってくる値の形も異なる(`lib/account/wasm-argon2/wasm-interface.ts`のコメント参照)。この設定を変えると、ローカルでは問題なく動くのに本番のCloudflare Workersでだけ`CompileError: WebAssembly.compile(): Wasm code generation disallowed by embedder`で全滅する、という壊れ方をしうる(実際に一度これで本番のアカウント登録が完全に止まった)。`.wasm`のimport方法を変更した場合は、`npx opennextjs-cloudflare build`でビルドした後、`npx wrangler dev --local`(実際のビルド成果物を本物のworkerdで動かす、`next dev`とは別のローカル実行環境)でアカウント登録・ログイン・パスワード再設定を一通り確認すること。`next dev`だけの確認では不十分。

[http://localhost:3000](http://localhost:3000) で確認できる。

### Docker(任意)

[`Dockerfile`](../Dockerfile) / [`compose.yaml`](../compose.yaml) に日本語ロケール入りの最小限の開発コンテナ定義がある。`docker compose up` でコンテナに入り、コンテナ内で上記と同じ手順(`npm install` → `npm run dev`)を実行する用途。

## テスト

```bash
npm test              # Vitestでユニットテストを1回実行
npm run test:watch    # ウォッチモード
npm run test:coverage # カバレッジ付き
```

テストは `tests/` 以下に、`lib/`・`app/` のソースと同じディレクトリ構成でまとめて置かれている(例: `lib/account/password.ts` のテストは `tests/lib/account/password.test.ts`)。暗号化(`tests/lib/crypto/*.test.ts`)・アクセス制御(`tests/lib/access.test.ts`)・掃除処理(`tests/lib/cleanup.test.ts`)・保存期間計算(`tests/lib/retention.test.ts`)・各APIルート(`tests/app/api/**/route.test.ts`)などをカバーしている。共有のテストヘルパー(`createTestEnv`など)は `test/env.ts`(単数形、`tests/`とは別)にある。

## Lint・型チェック

```bash
npm run lint
npx tsc --noEmit
```

GitHub Actions(`.github/workflows/deploy.yml`)でも `main` へのpush時に同じチェックを実行しており、失敗するとデプロイは行われない。

## トップページの合成計測

トップページのTTFB、LCP、CLS、初期転送量を確認するには、Chromeを使える環境で次を実行する。結果は標準出力にだけ表示され、利用者の計測データやレポートファイルは保存しない。

```bash
SITE_URL=https://anzdrop.com npm run measure:home
```

ローカルを計測する場合は、別のターミナルで `npm run dev` を起動してから `npm run measure:home` を実行する。

## SEO / Lighthouse 監査

PR 時の自動検査とローカル実行手順は [`docs/web-audit.md`](./web-audit.md) を参照する。要約:

```bash
WEB_AUDIT=true BLOG_USE_SEED_DATA=true SITE_URL=http://127.0.0.1:3000 npm run build
WEB_AUDIT=true BLOG_USE_SEED_DATA=true SITE_URL=http://127.0.0.1:3000 npm run start -- --hostname 127.0.0.1 --port 3000
# 別ターミナル
SITE_URL=http://127.0.0.1:3000 npm run audit:web
```

## 動作確認のコツ

- ブラウザで実際にアップロード→共有URL発行→別タブでダウンロード、まで一通り試すのが最も確実。パスワード保護・保存期間「1回」・複数ファイル(相乗り)のケースも忘れずに。
- `/admin` はCloudflare Access配下のため、通常は `lib/access.ts` の `verifyAccessJwt()` に有効なAccess設定が必要となる。ただし上記の開発専用バイパスの条件をすべて満たす場合は、ローカル管理者として確認できる。条件を満たさない場合は `tests/lib/access.test.ts` のようにモックしたテストで検証するか、実際にCloudflare Access配下にデプロイして確認する。

## パスキー・OTPのローカル確認

WebAuthnはlocalhostの明示設定のみを許可する。ブラウザでは `http://localhost:3000` を開く（既存devサーバーのバインド先は127.0.0.1でもよい）。別ポートでは `ACCOUNT_AUTH_LOCAL_ORIGIN=http://localhost:ポート` をサーバー環境に設定する。127.0.0.1やリクエストHostから認証先を自動判定しない。本番の `DEPLOYMENT_ENV=production` ではこのローカル設定があっても本番Originを使用する。

ローカルD1にmigration 0018を適用し、gitignore対象の `.dev.vars` に32バイトの専用暗号化鍵を設定する。鍵形式・生成方法は [deployment.md](./deployment.md) を参照。ダミー鍵を本番に使わない。

`tests/app/api/account/security.test.ts` はMiniflareの実D1と実際のWebAuthn署名で、4つの設定状態、OTP制限・再利用、チャレンジと復旧の競合を検証する。UIテストはOTP設定の中止・完了、非対応ブラウザ・キャンセルを検証する。

ローカルのビルド成果物をworkerdで起動した後、次のコマンドでChromium仮想認証器による登録・ログイン・OTP設定・削除・復旧を確認する。テスト用Turnstileキーは [Cloudflare公式のダミーキー](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) をビルド時・サーバー側の両方に設定する。SecretとローカルD1は本番から分離する。このテストはlocalhostと明示フラグが揃わない場合はスキップする。

```sh
E2E_ACCOUNT_AUTH_LOCAL=1 E2E_BASE_URL=http://localhost:8787 npx playwright test tests/e2e/account-security.spec.ts --workers=1
```

## Astro公開ページの開発

`npm run dev:public` で `http://localhost:4321/about` を開く。共有APIやアップロード・アカウント画面は従来の `npm run dev`（3000番）を使う。Astro単体では `/api` を提供しないため、ヘッダーの認証状態確認には本番のルーター、またはAPIを同一Originへ転送する環境が必要。

```bash
npm run check:public
npm run build:public
npx wrangler dev --config apps/public/dist/server/wrangler.json --port 4321 --var BLOG_USE_SEED_DATA:true --var WEB_AUDIT:true
# 別ターミナル。実WorkersでSSR/CSP・FAQ・画像拡大・404・SEOを確認する
PUBLIC_ASTRO_TEST=true E2E_BASE_URL=http://localhost:4321 npx playwright test tests/e2e/public-astro.spec.ts
```

実CMSを使う場合は `apps/public/.dev.vars` に `MICROCMS_API_KEY` を設定する（コミット禁止）。seedは開発・明示した監査環境だけで使用し、`DEPLOYMENT_ENV=production` では無効。生成物は `apps/public/dist`、`.astro`、`.wrangler` に出力し、Gitには含めない。

`npm run test:public` はビルド・プレビューの起動と終了・上記ブラウザ検証をまとめて実行する。初回は `npx playwright install chromium` を実行する。CIでもこの手順で実Workersを検証する。
