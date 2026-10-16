# ローカル開発環境

Node.js 22.12以降とnpmで、Astroの画面とHono APIをローカル起動します。CIはNode.js 24系です。初めて起動するときは、次の「初回セットアップ」の手順を順に実行してください。テストや機能別の確認は、後半の節から必要な手順を選べます。

D1・R2はWranglerのローカル環境で動きます。Cloudflareアカウントや外部サービスの認証情報は、本番反映やそのサービスとの連携確認に必要です。

## 初回セットアップ

### 依存関係を入れる

```sh
npm ci
```

### 確認する機能の環境変数を設定する

ローカル設定は次のファイルに分けます。いずれもGitの管理対象外です。

| ファイル | 用途 | 主な設定 |
| --- | --- | --- |
| ルートの`.env.local` | ブラウザ向けの公開値・開発設定 | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`、`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`、`LOCAL_ADMIN_BYPASS` |
| ルートの`.dev.vars` | API Workerが使うSecret | 以下の機能別の表を参照 |
| `apps/public/.dev.vars` | Astro Workerが使うCMS読取キー | `MICROCMS_API_KEY` |

Astroのブラウザ向けビルドに埋め込むのは、TurnstileのサイトキーとStripeの公開可能キーだけです。APIのSecretを`.env.local`へ移したり、Astroへコピーしたりしないでください。

| 確認する機能 | `.dev.vars`の設定 |
| --- | --- |
| 匿名アップロード・アカウント登録 | `TURNSTILE_SECRET_KEY` |
| アカウント・OTP | `TURNSTILE_SECRET_KEY`、`SESSION_SECRET`、`ACCOUNT_AUTH_ENCRYPTION_KEY` |
| R2への直接アップロード | `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`CLOUDFLARE_ACCOUNT_ID`の3つすべて |
| microCMSのWebhook受信 | `MICROCMS_WEBHOOK_SECRET`。記事取得の`MICROCMS_API_KEY`は`apps/public/.dev.vars`へ設定 |
| Stripe決済 | `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET` |
| Bitcoin決済 | `OPENNODE_API_KEY` |
| 分析用の相関ID | `ANALYTICS_SECRET` |

Turnstileには[公式テストキー](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)も使えます。Stripeの公開可能キーにはテスト用の`pk_test_...`を使ってください。OTP専用鍵の形式は[デプロイガイド](./deployment.md#otp暗号化鍵を設定してから導入する)を参照してください。本番のSecretはローカル確認に流用しません。

R2の3つの設定が揃わない場合、アップロードはWorker経由の`proxy`へ切り替わります。microCMSを使わない場合は、そのSecretを省略できます。環境変数を変更したら、開発サーバーを再起動してください。

`wrangler.jsonc`には`secrets.required`を設定していません。この指定は、ローカルで読み込むSecretも一覧内のキーに制限するため、任意機能のSecretが読み込まれなくなることがあります。

### ローカルD1へマイグレーションを適用する

```sh
npx wrangler d1 migrations apply DB --local --config wrangler.api.jsonc
```

初回とマイグレーション追加時に実行します。通常開発のD1・R2は`.wrangler/state`に保存します。旧開発環境の一時DBは自動移行しません。

### 開発サーバーを起動する

```sh
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開いてください。画面はAstro、APIはHonoで動きます。

| 処理 | 待ち受け先 |
| --- | --- |
| 画面・ブラウザからの接続 | `localhost:3000` |
| Hono API | `127.0.0.1:8788` |

Astroが`/api`をHonoへ転送し、Host・Origin・Cookieを維持します。管理画面の認証はAPP Service Binding経由でHonoへ確認します。APIはループバックアドレスだけで待ち受けます。

`npm run dev:api`と`npm run dev:app`で別々に起動することもできます。`wrangler.api.jsonc`はローカル開発・ビルド検証用です。本番への反映には使いません。

パスキーの確認には`http://localhost:3000`を使ってください。`127.0.0.1`やリクエストのHostから認証先を自動判定する設計にはしていません。

## 機能別の確認

### 管理画面をローカルで開く

`.env.local`に`LOCAL_ADMIN_BYPASS=true`を設定して`npm run dev`を起動します。開発用のHono設定（`LOCAL_DEVELOPMENT=true`）または`NODE_ENV=development`であり、接続先が`localhost`・`127.0.0.1`・`::1`の場合だけ、Cloudflare Access検証を迂回します。`DEPLOYMENT_ENV=production`では無効です。確認後は設定を外してください。

実際のCloudflare Access連携をローカルで確認する場合は、`wrangler.api.jsonc`の`CF_ACCESS_TEAM_DOMAIN`と`CF_ACCESS_AUD`を検証用アプリに合わせます。検証用Workerへデプロイする場合は、配信に使う`wrangler.jsonc`側の設定を確認してください。JWT検証だけなら、`tests/lib/access.test.ts`のようにモックしたテストでも確認できます。

### ブログを確認用データで開く

`.env.local`に`BLOG_USE_SEED_DATA=true`を設定すると、開発時は15件の確認用記事を使います。microCMSへ書き込まずに、記事一覧の2ページ目、詳細、関連記事、カテゴリ・タグ・著者ページを確認できます。

本番・通常のプレビューでは有効になりません。Web監査では`WEB_AUDIT=true`との併用時に限り、production起動でも確認用データを使えます。ただし`DEPLOYMENT_ENV=production`では無効です。詳細は[Web監査](./web-audit.md)を参照してください。

### 公開ページだけを開発する

```sh
npm run dev:public
```

`http://localhost:4321/about`を開きます。APIも必要な場合は、別のターミナルで`npm run dev:api`を起動してください。Astroは`/api`を8788番ポートへ転送します。

実際のCMSから取得する場合は、通常の`npm run dev`でも`apps/public/.dev.vars`に`MICROCMS_API_KEY`を設定します。生成物は`apps/public/dist`、`.astro`、`.wrangler`に出力し、Gitには含めません。

### ビルド済みの構成を確認する

```sh
npm run build
npm run preview
```

ビルドはCloudflareへアップロードせず、3つのWorkerをローカルで検証します。プレビューは本番と同じルーター経由でAstro・Honoを起動します。`npm run start -- --hostname 127.0.0.1 --port 3000`も同じプレビューです。設定とSecretは通常開発用を使うため、隔離テストが必要な場合は次のE2Eコマンドを使ってください。

## 変更を検証する

```sh
npm run check          # Lint、TypeScript、ルーター、Astro、Vitestの順
npm run check -- types # TypeScriptだけ
npm run check -- test  # Vitestだけ
npm run test:watch     # Vitestのウォッチモード
npm run test:coverage  # カバレッジ付きVitest
```

検証コマンドは`scripts/check.mjs`にまとめています。`lint`・`types`・`router`・`public`・`test`を個別に指定でき、失敗した時点で終了します。CIと本番デプロイも同じコマンドを使います。既存の`npm run lint`や`npx tsc --noEmit`も利用できます。

### テストの配置と共通ヘルパー

テストは`tests/`に置きます。ライブラリのテストは実装と同じディレクトリ構成にし、APIテストは`tests/app/api/`でHonoのWorkerランタイムを使って実行します。環境作成は`test/env.ts`、ランタイムは`test/runtime.ts`、Reactの描画・破棄は`test/react.ts`に共通ヘルパーがあります。

`mountHook`からはフックの最新の戻り値を取得できます。操作と非同期応答はReactの`act`内で完了させ、テスト終了時にはアンマウントしてください。

大容量の`Uint8Array`は、元の配列の範囲を共有するBufferビューで、長さと全バイトを比較します。`toEqual`で要素を列挙すると時間とメモリを多く使います。暗号化チャンクやマルチパートの境界を検証するときは、比較方法だけを軽くし、実データのサイズは維持してください。

```ts
expect(actual.byteLength).toBe(expected.byteLength);
expect(
  Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength).equals(
    Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength),
  ),
).toBe(true);
```

### 隔離環境で画面・認証・共有を通して確認する

```sh
npx playwright install chromium
npm run test:astro-hono
```

このコマンドは、ビルド、既存マイグレーションのローカル適用、テストサーバーの起動、Chromiumでの検証、終了処理をまとめて実行します。パスキー・OTP・復旧、CSP、React画面、ファイルの暗号化・復号を確認します。

| 用途 | 保存先・接続先 |
| --- | --- |
| テスト用D1・R2 | `tmp/astro-hono-state` |
| テスト専用API設定 | `tmp/astro-hono/wrangler.json` |
| ブラウザからの接続 | `http://localhost:3310` |
| API・画面の内部ポート | 8791・4324 |

APIの設定はルートの`.dev.vars`を読み込まない場所に生成し、公式Turnstileテストキーとローカル専用の認証鍵を使います。本番へのデプロイや新しいマイグレーションの作成は行いません。

認証済み管理画面は次のコマンドで確認します。

```sh
E2E_LOCAL_ADMIN_BYPASS=true E2E_TEST_FILES=tests/e2e/support-admin-astro.spec.ts npm run test:astro-hono
```

`.wasm`は、Workersが静的importするコンパイル済みモジュールとして扱います。変更時はこのE2Eで、実際のworkerd上の登録・ログイン・復旧を確認してください。ブラウザ向けバンドルには含めません。

### 3ブラウザでファイル共有を確認する

```sh
npx playwright install chromium firefox webkit
E2E_PROJECT=firefox E2E_WORKERS=1 E2E_TEST_FILES=tests/e2e/file-sharing.spec.ts npm run test:astro-hono -- --grep @sharing-core
E2E_PROJECT=webkit E2E_WORKERS=1 E2E_EXTENDED=1 E2E_TEST_FILES=tests/e2e/file-sharing.spec.ts npm run test:astro-hono
```

`E2E_PROJECT`は`chromium`・`firefox`・`webkit`から選びます。省略時はChromiumです。`--`以降にPlaywrightの引数を渡せます。CDPを使うパスキー検証はChromiumに限定し、Firefox・WebKitは共有スイートを実行します。本番URLでは共有スイートをスキップします。

| ケース | 確認内容 |
| --- | --- |
| 基本 | 64KiB、誤ったパスワードからの再試行、日本語名を含む3ファイルのZIP |
| 拡張（`E2E_EXTENDED=1`） | 16MiB＋1B、200MiB＋1B、Blob保存、暗号文破損、通信失敗、保存キャンセル後の再試行 |

大容量の結果は、固定サイズずつ読み取って長さと全バイトを比較します。通常保存は転送可能ストリームとService Workerの制御を確認し、保存URLが`/_anzdrop_download/`または`blob:`であることを検証します。ブラウザの能力と保存経路はレポートに添付します。

Blob保存の強制には`serviceWorkers: 'block'`を使います。受信側では保存ピッカーを無効にするため、OSの保存ダイアログはこのE2Eの対象外です。File System Access APIの分岐はVitestで確認します。

障害注入はBlob保存時の対象`/api/file/*`に限ります。キャンセルのテストでは、Service Workerへ渡すストリームを最初のチャンク後で待機させ、未完了の`Download.cancel()`が`canceled`になることを確認します。その後、待機を解除して保存を再試行します。アプリがブラウザのキャンセルを検知する前提は置いていません。

共有URLのコピーは`navigator.clipboard.writeText`の呼び出しを捕捉します。OSのクリップボードは実機で確認してください。送信リクエストのURL・ヘッダー・本文に、テスト用に生成した平文、ファイル名、保護パスワード、実際にエクスポートした復号鍵が含まれないことも検証します。通信監視の結果をレポートへ添付するときは、検査対象の値を含めません。トレースには合成データや鍵が含まれるため、実ユーザーのデータは使わないでください。

手動確認では、保存期間「1回」のダウンロード完了後に再取得できないことと、既存共有への追加アップロードも確認してください。

Safari製品の確認は[実機確認表](./safari-file-sharing-checklist.md)に記録します。Playwright WebKitの成功だけで実機確認を完了扱いにはしません。

### 公開ページだけをWorker上で検証する

```sh
npm run test:public
```

Astroのビルド、Workerの起動・終了、Chromiumでの公開ページ検証をまとめて実行します。対象はSSR、CSP、FAQ、画像拡大、404、SEOです。

### パスキー・OTPを別ポートで確認する

`ACCOUNT_AUTH_LOCAL_ORIGIN=http://localhost:ポート`をAPI側に明示します。本番の`DEPLOYMENT_ENV=production`では、本番Originを使います。127.0.0.1や任意のHostは認証先に使いません。

手動起動したローカル環境では、テスト用Turnstileキーをブラウザ・APIの両方に設定し、次のように接続先を指定します。通常は、設定と起動をまとめた`npm run test:astro-hono`を使ってください。

```sh
E2E_ACCOUNT_AUTH_LOCAL=1 E2E_BASE_URL=http://localhost:8787 npx playwright test tests/e2e/account-security.spec.ts --workers=1
```

## 計測・Web監査

トップページのTTFB、LCP、CLS、初期転送量は、Chromeを使える環境で次のように測定します。結果は標準出力に表示し、利用者の計測データやレポートファイルは保存しません。

```sh
SITE_URL=https://anzdrop.com npm run measure:home
```

ローカル環境では、開発サーバーを起動して`SITE_URL`をそのURLに変えてください。SEO・Lighthouseの手順、対象ページ、閾値は[Web監査](./web-audit.md)を参照してください。

## ローカル起動の共通処理

`scripts/run-command.mjs`は子プロセスの終了コードとシグナル転送を共通化します。子プロセス終了時には転送ハンドラを解除し、呼び出し元のハンドラは残します。`scripts/local-worker-config.mjs`は、プレビューと隔離E2Eの使い捨て設定についてパス解決とCron除去を行います。

通常のAPIプレビューはルートの設定から`.dev.vars`を読み、隔離E2Eは`tmp/astro-hono`内の設定を使います。

Dockerを使う場合は、[Dockerfile](../Dockerfile)と[compose.yaml](../compose.yaml)を利用できます。日本語ロケールを含む開発コンテナで、`docker compose up`後に同じセットアップ手順を実行します。

手順と実際の動きが食い違う場合は、使ったコマンドと機能を添えてリポジトリのIssueで報告してください。秘密情報や実ユーザーのデータは含めないでください。
