# デプロイ・CI/CD

## 自動デプロイ(GitHub Actions)

`main` ブランチへのpushをトリガーに [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) が実行され、以下を順に行う。

デプロイ成功後は [`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml) が本番 URL(`https://anzdrop.com`)へ Playwright を実行する。リンク切れチェック・週次レポートなど他の自動化は [`ci-automations.md`](./ci-automations.md) を参照。

1. 依存関係インストール(`npm ci`)
2. `npm run lint`
3. `npx tsc --noEmit`
4. OpenNextで既存アプリとトップページをそれぞれ1回ビルドし、`strip-vercel-og.mts`を適用する。Astro公開ページをビルドし、Wranglerの`--dry-run --outdir`でアプリ・トップページ・Astro公開ページ・ルーターのアップロード用バンドルを生成する
5. 4つのWorkerのモジュール、Next/Astroの静的アセット、4つのWrangler設定を決定論的なtarにまとめ、tarファイルのSHA-256を計算する
6. 公開リポジトリのGitHub Artifact Attestationをtarに対して作成し、tarとSHA-256ファイルをActions Artifactへ保存する
7. **D1マイグレーションの本番適用**: `npx wrangler d1 migrations apply DB --remote`
8. tarのSHA-256を再確認して展開し、`wrangler deploy --no-bundle`でアプリ、トップページ、Astro公開ページ、ルーターの順に、そのtar内のバンドルとアセットをデプロイする。各コマンドが出力したWorker Version IDと、Cloudflare APIでそのVersion IDを100%配信するDeployment IDを取得する
9. 4つのデプロイとID照合がすべて成功した後にJSON manifestを生成し、Actions Artifactへ保存する

いずれかのステップが失敗すると後続は実行されない。Workersのデプロイは原子的な4件セットではない。たとえばアプリWorkerのデプロイ後にトップページWorkerが失敗すると、既存ルーターは新しいアプリWorkerへ非トップページ経路を引き続き転送する。途中で失敗した場合、部分適用が残る可能性があるため、「すべて成功した」というmanifestは作成しない。マイグレーションはデプロイより先に適用されるため、新しいカラム/テーブルを前提とするコードをデプロイする場合は、対応するマイグレーションファイルを同じPR/コミットに含めておけば自動的に順序よく反映される。

### 監査用artifactとmanifest

- ハッシュ・[GitHub Artifact Attestation](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)の対象は`anzdrop-deploy.tar`**そのもの**。tarには4つのWorkerのモジュール、3つの静的アセットディレクトリ、各Wrangler設定が入る。アプリ・トップページ・公開ページの`DEPLOYMENT_ENV=production`、4つのWorkerのアカウントIDもtar内の設定に固定する。tarのファイル順とメタデータを正規化する。デプロイ前に同じtarのSHA-256を再計算し、展開したファイルを`--no-bundle`でアップロードする。Cloudflare側で別のNext.jsビルドやWranglerバンドルは行わない。
- `deployment-build-<runId>-<attempt>` Actions Artifactにtarと`.sha256`、`deployment-manifest-<runId>-<attempt>` Actions Artifactに成功後の`deployment-manifest.json`を保存する。manifestはリポジトリ、コミット、ref、workflow、run ID・attempt、tarのSHA-256、4つのWorker名・Version ID・Deployment ID・作成時刻、本番URLを記録する。トークン等の秘密情報は含まない。
- Deployment IDは「最新のDeployment」から採らない。各`wrangler deploy`が出力した固有のVersion IDと、デプロイ開始後の[Cloudflare Workers Deployment API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/)の記録を照合する。同一Version IDのDeploymentが複数ある、100%配信ではない、作成時刻が合わない等の場合は失敗する。WorkersのVersion IDはコード・設定・静的アセットのバージョン、Deployment IDはそれを配信する記録を表す。
- GitHub Actions Artifactの保存期間は90日（組織・リポジトリの設定で短縮される場合がある）。それを超える長期保存が必要なら別途アーカイブを設計する。releaseやmainへの自動書き戻しは行わず、`contents: read`を維持する。
- GitHub ActionsのAction参照は既存workflowと同じメジャーバージョンタグを使用する。タグの更新を信頼する運用であり、Action本体まで固定したい場合は全ActionをコミットSHAへpinする追加変更が必要。

検証例（`RUN_ID`と`ATTEMPT`は対象のActions runに置き換える）:

```bash
gh run download "$RUN_ID" -R ZuikakuGroup/anzdrop -n "deployment-build-$RUN_ID-$ATTEMPT" -D build
gh run download "$RUN_ID" -R ZuikakuGroup/anzdrop -n "deployment-manifest-$RUN_ID-$ATTEMPT" -D manifest
(cd build && sha256sum -c anzdrop-deploy.tar.sha256)
gh attestation verify build/anzdrop-deploy.tar --repo ZuikakuGroup/anzdrop \
  --signer-workflow ZuikakuGroup/anzdrop/.github/workflows/deploy.yml \
  --source-digest "$(jq -r .gitCommit manifest/deployment-manifest.json)" \
  --source-ref refs/heads/main
jq -r '.artifact.sha256' manifest/deployment-manifest.json
jq -r '.cloudflare.deployments[] | [.worker, .versionId, .deploymentId] | @tsv' manifest/deployment-manifest.json
```

tarの`sha256:`値とmanifestの`artifact.sha256`を突き合わせ、Attestationの署名・リポジトリ・workflow・コミット・refを検証する。Cloudflare側の対応を確かめるには、対象アカウントのWorkers Deployment閲覧権限で、manifest内の4つのDeployment IDが各Version IDを100%配信していた記録と一致することを確認する。Cloudflareの記録は公開APIではないため、アカウント権限のない第三者がCloudflare内部の状態まで独立に確認できるわけではない。

この仕組みはGitHubのソース、Actions workflow、配布したtar、CloudflareのDeployment記録を追跡するためのもの。Cloudflareの実サーバーが現在そのartifactだけを実行していることを暗号学的に証明するRemote Attestationではない。CloudflareとGitHub Actionsの実行基盤は信頼境界に残る。

### 必要なGitHub Secrets

| Secret名 | 用途 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | `wrangler`のD1マイグレーション適用・デプロイ両方に使用。対象アカウントの Workers / D1 / R2 への書き込み権限が必要 |
| `TURNSTILE_SITE_KEY` | ビルド時に `NEXT_PUBLIC_TURNSTILE_SITE_KEY` としてクライアントバンドルへ埋め込まれる、Turnstileのサイトキー(公開情報) |
| `STRIPE_PUBLISHABLE_KEY` | ビルド時に `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` としてクライアントバンドルへ埋め込まれる、Stripeの公開可能キー(公開情報。Stripe.js/Payment Elementの初期化に使う) |

### Cloudflare Workersのシークレット(`wrangler secret put`、リポジトリには含まれない)

`secrets.required` による全機能一律の必須チェックは設定しない。アカウント認証には `TURNSTILE_SECRET_KEY`・`SESSION_SECRET`・`ACCOUNT_AUTH_ENCRYPTION_KEY` を導入前に設定する。決済のキーは対象の決済機能を利用する場合に、`ANALYTICS_SECRET` は相関分析を利用する場合に設定する。R2直アップロードの3つのSecretは任意で、未設定ならproxyを利用する。

オウンドメディアを有効化する場合は、`MICROCMS_API_KEY`（GET専用の Content API key）と `MICROCMS_WEBHOOK_SECRET` を設定する。`MICROCMS_SERVICE_DOMAIN` と `SITE_URL` は `wrangler.jsonc` の非秘密変数として本番値に更新する。詳しくは [`media.md`](./media.md) を参照。

| Secret名 | 用途 |
| --- | --- |
| `TURNSTILE_SECRET_KEY` | Turnstile検証用のシークレットキー |
| `ACCOUNT_AUTH_ENCRYPTION_KEY` | OTP秘密のAES-256-GCM暗号化専用鍵。32バイトをpaddingなしbase64urlで表す43文字 |
| `SESSION_SECRET` | アカウントのログインセッションJWTの署名鍵(HS256)。詳細は[`accounts.md`](./accounts.md) |
| `STRIPE_SECRET_KEY` | Stripe APIキー(Customer/Subscriptionの作成・取得・更新などのAPI呼び出しに使用) |
| `STRIPE_WEBHOOK_SECRET` | `/api/billing/stripe/webhook` の署名検証用シークレット(Stripeダッシュボードで作成したWebhookエンドポイントごとに発行される) |
| `OPENNODE_API_KEY` | OpenNode APIキー。charge作成とWebhook署名検証(HMAC鍵)の両方に使う |
| `ANALYTICS_SECRET` | `shareId`から分析用の相関IDを生成するHMAC鍵 |
| `R2_ACCESS_KEY_ID` | R2 S3互換API用アクセスキー。ブラウザ直アップロード(presigned UploadPart)の署名に使う |
| `R2_SECRET_ACCESS_KEY` | 上記トークンのシークレットキー |
| `CLOUDFLARE_ACCOUNT_ID` | S3エンドポイント(`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`)用のアカウントID |

これら3つが揃っているときだけ `POST /api/upload/start` が `uploadMode: "direct"` を返す。未設定(ローカル Miniflare 等)では `"proxy"` にフォールバックし、従来の `/api/upload/chunk` 経路を使う。

#### R2 直アップロード用トークンと CORS

1. Cloudflareダッシュボードで R2 API トークンを作成する。権限は **Object Read & Write**、対象バケットは `anzdrop` にスコープする。
2. 発行された Access Key ID / Secret Access Key とアカウントIDを、それぞれ `wrangler secret put R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `CLOUDFLARE_ACCOUNT_ID` で本番Workerへ入れる。
3. バケット `anzdrop` の CORS を設定する(ブラウザから署名付きURLへ直接PUTするため必須)。
   - Allowed Origins: `https://anzdrop.com`(必要なら preview オリジンも)
   - Allowed Methods: `PUT`, `GET`, `HEAD`
   - Allowed Headers: `Content-Type`(署名対象の `Content-Length` はブラウザがボディから自動設定する forbidden header のため、ここに含めなくてよい)
   - Exposed Headers: `ETag`(クライアントがPUT応答のETagを読んで `part-ack` に送るため)

### 分析のセットアップ

分析はFreeプランでも利用できる。`ANALYTICS_SECRET`を`openssl rand -base64 32`等で生成し、`wrangler secret put ANALYTICS_SECRET`で設定する。この鍵は`analyticsTransferId`によるアップロード・ダウンロード間の相関に使う。未設定または相関IDの生成に失敗した場合でも、アップロード・ダウンロードの成功レスポンスは有効であり、`analyticsTransferId`は省略される。

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
- **Cron Trigger**: `"0 */6 * * *"`(6時間ごと、期限切れ共有・放置アップロードの掃除。[`architecture.md`](./architecture.md#掃除cleanup)参照)と`"10 0 * * *"`(毎日UTC 00:10、分析日次集計)。
- **Rate Limiting バインディング**: `ratelimits` に6つ(`FILE_RATE_LIMITER` / `SHARE_RATE_LIMITER` / `UPLOAD_RATE_LIMITER` / `ACCOUNT_RATE_LIMITER` / `ANALYTICS_RATE_LIMITER` / `FORM_RATE_LIMITER`)。事前のリソース作成は不要だが、**`namespace_id` はCloudflareアカウント内で一意**でなければならない(同じ値を使うと、別のWorkerのバインディングとカウンタを共有してしまい、原因の分からない429の元になる)。公式ドキュメントのサンプル値(`1001` など)との衝突を避けるため、このリポジトリでは `81001`〜`81006`(issue番号#81由来)を使っている。適用先と閾値の考え方は[`architecture.md`](./architecture.md#レート制限)を参照。
- **vars**: `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD`(Cloudflare Accessの設定)、`STRIPE_PRICE_ID_STANDARD` / `STRIPE_PRICE_ID_PREMIUM` / `OPENNODE_BTC_CHARGE_AMOUNT_USD_STANDARD` / `OPENNODE_BTC_CHARGE_AMOUNT_USD_PREMIUM` / `OPENNODE_BTC_DAYS_PER_CHARGE`(有料プランの設定、上記の表を参照)。
- **secrets**(`wrangler secret put` で設定、リポジトリには含まれない): 上記の表を参照。

### トップページ専用Worker

トップページは [`apps/home`](../apps/home) を独立したNext.jsアプリとしてビルドし、`anzdrop-home` Workerへデプロイする。ここにはトップページのSSR、CSP Proxy、アップロードのクライアントUIだけを含める。D1、R2、決済、認証API、管理画面のサーバーコードは既存の`anzdrop` Workerに残す。

外部からのリクエストは [`wrangler.router.jsonc`](../wrangler.router.jsonc) の`anzdrop-router`が受ける。`/`と`/_home-next/*`だけを`anzdrop-home`へ、その他すべてを`anzdrop`へService Bindingでそのまま転送する。Service Bindingは公開HTTPへ出ず、リクエスト本文とレスポンスストリームをバッファリングしない。Cookie・同一オリジンの`/api/*`・nonce CSPも維持される。

`anzdrop.com/*` のWorkers RouteはルーターWorkerだけが持つ。現在のカスタムドメインの前段にRouteを置くため、ロールバック時はルーターWorkerを直前のバージョンへ戻すか、Routeを外して既存のカスタムドメインへ戻す。RouteにはCloudflareでプロキシされたDNSレコードが必要である。

`anzdrop-home` は `ASSETS` Bindingを通して静的アセットを取得する。`/_home-next/_next/static/*` をWorkerで `/_next/static/*` に正規化してBindingから取得するため、静的アセットだけを先にWorkerへ渡す設定にしている。

## WAF のレート制限ルール

本番用の設定は [`config/waf-rate-limit.json`](../config/waf-rate-limit.json) に記録する。2026-10-08にCloudflare APIで適用し、entrypointの読み戻しで有効化を確認済み（ruleset ID: `91708d5468b942b4ba7c132923cb66cd`）。`anzdrop.com` のゾーンは有効で独自ドメイン取得は完了済み。`/api` と `/api/` 以下を、同一IP・データセンターごとに3000回/10秒で数え、超過時は10秒間Blockして429のJSON応答を返す。FreeプランではHostを条件にできないため、同ゾーンの他のサブドメインのAPIも対象となる。

3000回/10秒は並列転送と共有IPの余裕を確保するための緩い初期値。8MiBの転送だけを想定すると単独利用で約20Gbps相当だが、パートURL発行・ACKや同じIPの他の利用者の呼び出しも合算するため、厳密な帯域上限ではない。Cloudflareのカウンタもベストエフォートであり、費用の厳密な上限は保証しない。IPはCloudflareだけが制限判定に使い、アプリのDBやログに追加保存しない。

適用時は `http_ratelimit` のentrypointを読み、既存ルールがある場合は上書きせず差分を確認する。設定後はentrypointの読み戻しで有効化を確認する。ロールバックは `ref: anzdrop_api_ip_rate_limit` のルールだけを無効にし、他のルールを残す。

[`architecture.md`](./architecture.md#レート制限) の外側の層。Workers 側のバインディングが「共有・セッション単位」で数えるのに対し、こちらは**送信元 IP 単位**で数える。Anzdrop のコードは IP を一切扱わないため、IP を見た判定はすべてここに寄せている。

Rate Limiting Rules は**ゾーン単位の機能**なので、Worker を `*.workers.dev` だけで公開している状態では設定できない(ダッシュボードに項目自体が出ない)。設定するには先に独自ドメインを Cloudflare ゾーンとして追加し、Worker のカスタムドメインに割り当てておく必要がある。

1. Cloudflare ダッシュボードで対象ドメインをゾーンとして追加し、レジストラ側のネームサーバーを Cloudflare のものへ変更する。
2. Workers & Pages → `anzdrop` → **Settings** → **Domains & Routes** → **Add** → **Custom domain** で、そのドメイン(およびルート指定したいホスト名)を割り当てる。
3. そのゾーンの **Security** → **Security rules** → **Create rule** → **Rate limiting rules** で以下のようなルールを作る。

   - 式: `starts_with(http.request.uri.path, "/api/") or http.request.uri.path eq "/api"`
   - 特性(With the same characteristics): **IP**
   - 閾値・期間・アクション・継続時間: プランごとに選べる値が違う(**Free プランはルール1本・カウント期間10秒・Block・継続10秒のみ**)。

閾値を決めるときの注意として、**1回のダウンロード/アップロードが多数のリクエストに分かれる**ことを必ず考慮する。ダウンロードは8MiBウィンドウ×並列6本、アップロードは8MiBパート×最大12並列なので、高速回線の正当な利用者でも数秒間に数十リクエストを出す。ここを見誤ると正当な大容量転送を壊すため、ルール投入後は **Security Events** でしばらく実トラフィックを観察し、正当な利用がマッチしていないことを確認してから閾値を締めること。

アクションについては、`fetch`/`XHR` で呼ばれる API に **Managed Challenge を当てても正しく解決できず UX を壊す**ため、Block を選ぶ(Free プランでは Block のみ)。

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
npm run deploy        # 既存アプリWorkerをデプロイ
npm run deploy:home   # トップページWorkerをデプロイ
npm run build:public  # 公開Workerのコードと静的アセットを生成
npx wrangler deploy --config apps/public/dist/server/wrangler.json --var DEPLOYMENT_ENV:production
# 初回は公開WorkerにmicroCMSの読み取り用キーを登録する（値をコマンド引数やログに残さない）
npx wrangler secret put MICROCMS_API_KEY --config apps/public/dist/server/wrangler.json
# キーの値ではなく登録名だけを確認する。既に設定済みなら再登録は不要
npx wrangler secret list --config apps/public/dist/server/wrangler.json --format json
npm run deploy:router # 公開WorkerとCMSキーが揃ってからRouter Workerを最後にデプロイ
```

上記の順番で実行し、公開Workerのデプロイが成功したことと、Secret一覧に `MICROCMS_API_KEY` があることを確認してからRouter Workerを更新する。既存APPのSecretは新しいWorkerへ自動共有されない。キーは `MICROCMS_SERVICE_DOMAIN` のサービスで公開コンテンツを取得できる読み取り用キーを用意する。

Router Workerを最後に更新することで、初回導入時にHOME・PUBLICのデプロイやCMSキーの準備が失敗しても、既存ルーターの振り分けを維持できる。失敗した場合はそこで中断し、Router Workerをデプロイしない。

手動デプロイ時は `CLOUDFLARE_API_TOKEN` 等の認証情報をローカルの `wrangler` にも設定しておく必要がある(`wrangler login` またはトークンを環境変数で渡す)。CIと同様、事前にD1マイグレーションの適用(`npx wrangler d1 migrations apply DB --remote`)を忘れないこと(`npm run deploy` はマイグレーションを自動実行しない)。この手動コマンドは監査用tar・Attestation・manifestを生成しない。

## OTP暗号化鍵を設定してから導入する

導入順は **専用Secret設定 → migration 0018適用 → 対応コードのデプロイ**。自動デプロイ前にSecretを準備する。鍵はセッション署名鍵と分離する。秘密管理ツールで32バイトの乱数を生成し、paddingなしbase64urlの43文字として保存する。登録時のみ、リポジトリ外の権限600の一時ファイルへ改行なしでエクスポートして、次のようにstdinから渡す。生成値をソース・vars・ログ・コミットへ含めない。

```sh
npx wrangler secret put ACCOUNT_AUTH_ENCRYPTION_KEY < /安全な一時ディレクトリ/account-auth-key
rm /安全な一時ディレクトリ/account-auth-key
```

設定した鍵はアクセスを制限した秘密管理ツールに保管し、DBのバックアップと組にして復旧できるようにする。紛失すると保存済みOTP秘密を復号できず、OTPの利用者はパスキーまたはリカバリーコードによる復旧が必要になる。

現行の暗号文形式は1鍵に対応する。鍵を上書きするだけでは既存のOTPが検証できなくなるため、通常のローテーションは行わない。更新が必要な場合はOTP関連操作・ログインを保守停止し、旧鍵で全有効秘密と設定途中秘密を復号、新鍵で同じアカウント・用途の追加認証データを使って再暗号化する移行を別途実装・検証する。DBの暗号文とSecretを一緒に切り替え、旧鍵は移行前バックアップの保持期間が終わるまで保管する。部分更新のまま再開しない。

OTP有効化後は、OTPを要求しない旧コードへロールバックしない。修正はOTP検証を維持する対応コードで行う。`ACCOUNT_AUTH_LOCAL_ORIGIN` はローカル検証専用で、本番には配置しない。

### Astro公開ページWorkerの導入

`anzdrop-public` を追加する。`apps/public/astro.config.mjs` はCloudflare adapterでSSRし、`session: false` と画像パススルーを明示するため、追加ストレージやImages bindingは不要。ブログ用の `MICROCMS_API_KEY` を新Workerへ設定する必要がある。既存アプリの認証・決済・E2EE用Secretをコピーしない。

初回は公開Workerを作成してmicroCMS Secretを設定・確認した後、PUBLIC service bindingを持つルーターを切り替える。未設定のままルーターを切り替えるとブログ取得は失敗する。ローカル実装は本番設定を変更しない。

監査成果物にはAstroのWrangler dry-runで検証した `entry.mjs` と全チャンク、および `dist/client` を含める。4WorkerをAPP、HOME、PUBLIC、ルーターの順に同じ検証済みアーカイブからデプロイする。Astroも `DEPLOYMENT_ENV=production` を成果物内で固定する。公開Workerの設定にはD1/KV/R2/認証Secretを追加しない。公開ページだけのロールバックはPUBLICを直前版に戻すか、ルーターの公開ページ振り分けを戻してNextの互換経路へ送る。

### 操作画面とAPIのAstro/React・Hono移行

既存`anzdrop` Workerの`custom-worker.ts`が`/api`をHonoに渡し、それ以外の互換画面をOpenNextへ渡します。D1/R2・全認証/決済Secret・Cronは同じWorkerに残り、再登録・コピーは不要です。`anzdrop-public`は公開ページに加えアップロード・ダウンロード・マイページをSSRし、React islandsを配信します。認証SecretやD1/R2は持ちません。追加Workerや追加マイグレーションはありません。

既存の4Worker監査アーカイブとデプロイ手順を維持します。APPのHonoとPUBLICの新画面を先に反映し、最後にルーターを更新して`/`・`/d/*`・`/mypage/*`をPUBLICへ切り替えます。HOMEは旧アセット互換のため残します。`wrangler.api.jsonc`はローカル専用で、本番へデプロイしないでください。CIが渡す既存`NEXT_PUBLIC_TURNSTILE_SITE_KEY`・`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`はAstroのビルドにも引き継がれます。

切り替え前に`npm run test:astro-hono`で、実workerdの認証・ファイル共有・CSPを確認します。旧画面に戻す場合はルーターの操作画面をAPP/HOMEへ戻せますが、OTP有効ユーザーがいるため認証APIをOTP未対応の旧版へ戻してはいけません。
