# アカウント・有料プラン

Anzdropは元々、認証もアカウントも一切ない匿名の公開サービスとして運用されている。収益化のため有料プラン(容量上限緩和・保存期間延長)を導入するにあたり、**メールアドレスは一切収集しない**という前提でアカウント機能を追加した。

## アカウントの考え方

- アカウントは**本人が設定するアカウントID + パスワード**のみで構成される。メールアドレスやその他の個人情報は保存しない。
- アカウントIDはサインアップ時に本人が自由に決める(`lib/account/id.ts`の`isValidAccountId()`、3〜32文字・半角英数字とハイフン・アンダースコアのみ)。一意性はDB(`accounts.id` PRIMARY KEY)への`INSERT ... ON CONFLICT (id) DO NOTHING`の結果(`changes`)で判定し、既に使われていれば409を返す。後から変更する手段はない。
- パスワードを忘れた場合の再設定は、サインアップ時に1回だけ表示される**リカバリーコード**でのみ行える。メールでの再設定手段は存在しないため、リカバリーコードを紛失すると運営側でも復旧できない(共有の復号鍵と同じ扱い)。
- ログインセッションはHttpOnly・Secure・SameSite=StrictなCookie(`anzdrop_session`)に、`jose`で署名したJWTを保存する形で管理する(`lib/account/session.ts`)。
- 未ログイン時は常に無料プラン(free)として扱われ、既存の匿名アップロードの挙動は一切変わらない。
- JWTには`accounts.session_version`の値を埋め込み、検証のたびにDBの現在値と比較する。パスワード再設定(`/api/account/recover`)は`session_version`をインクリメントするため、それより前に発行済みのセッションCookie(盗まれている可能性がある)は再設定と同時に全て失効する。ログイン自体はこの値を変えない(他デバイスの既存セッションを意図せず切断しないため)。

### ログイン状態に応じた画面遷移・ヘッダー表示

- アカウント関連の画面(ログイン・サインアップ・パスワード再設定・プラン確認)は、いずれも`/mypage`配下(`/mypage/login`・`/mypage/signup`・`/mypage/recover`・`/mypage/billing`)にまとめて配置している(`app/mypage/`)。
- `/mypage/billing`は未ログインだと専用の案内は出さず、`GET /api/account/me`が`{ success: false }`(未ログイン時の401だけでなく、`withApiHandler`による予期しないエラー時の500応答も含む)を返した時点でクライアント側から`/mypage/login`へリダイレクトする(`components/billing/BillingPage.tsx`)。
- 逆に`/mypage/login`・`/mypage/signup`はログイン済み(`GET /api/account/me`が成功)なら`/mypage/billing`へリダイレクトする(`lib/account/useRedirectIfLoggedIn.ts`)。行き先は暫定で、将来変更の可能性がある。
- いずれもサーバー側でのリダイレクト(Server Component等)ではなく、マウント後に`GET /api/account/me`を呼んでクライアント側で判定する方式。判定が終わるまでは対象画面の代わりにスピナーを表示する。
- 共通ヘッダー(`components/brand/SiteHeader.tsx`)もマウント時に`GET /api/account/me`を呼び、ログイン中はアカウントID(`/mypage/billing`へのリンク)とログアウトボタンを、未ログイン時は「ログイン」「アカウント作成」のリンクを表示する。判定が終わるまではどちらも表示しない(ログイン中の一瞬だけ未ログイン用ボタンが見えてしまうのを防ぐため)。

### ログインのロックアウト(総当たり対策)

アカウントIDはランダム発行ではなく本人が自由に選べるため、IDの予測不可能性には頼れない(以前はアカウントIDの長い・ランダムな文字列自体が、パスワードと並ぶ総当たり対策の一部だった)。代わりに、`POST /api/account/login`(`app/api/account/login/route.ts`)はアカウントごとにログイン失敗回数を記録し、**5回連続で失敗すると5分間そのアカウントIDでのログインを拒否する**(パスワードが正しくても拒否する)。成功時・またはリカバリーによるパスワード再設定時に失敗回数とロックはリセットされる。この情報(`accounts.failed_login_attempts`・`accounts.locked_until`、migration 0012)はログインのたびに参照・更新される、アカウントごとのカウンタのみで、個人を特定する情報ではない。

## プランの差(`lib/plan.ts`)

| | 無料プラン | 有料プラン |
| --- | --- | --- |
| 1ファイルの上限サイズ | `lib/limits.ts`の`MAX_FILE_SIZE_BYTES`(既定5GB) | `lib/plan.ts`の`PLAN_LIMITS.paid.maxFileSizeBytes`(暫定50GB) |
| 選べる保存期間 | 1回・1日・3日・7日 | 左記に加えて30日 |
| ブラウザ内プレビュー | 不可 | 可(MP4/MP3/JPEG/PNGのみ。保存期間「1回」のファイルは対象外) |

具体的な容量・金額は暫定値。正式なプラン内容が決まったら`lib/plan.ts`とStripeのPrice設定・`wrangler.jsonc`の`OPENNODE_BTC_*`を合わせて更新する([`deployment.md`](./deployment.md)参照)。

ブラウザ内プレビューの可否(`shares.preview_allowed`)も、保存期間の上限と同じく共有作成時のアップローダーの実効プランから一度だけ判定して共有に焼き込む(`lib/preview.ts`)。以後アカウントの状態が変わっても、既に作成済みの共有の値は変わらない。ダウンロード側は完全に匿名なので、この判定は「プレビューする人」ではなく「共有を作ったアップローダー」のプランに基づく。保存期間「1回」のファイルは、プレビューが`GET /api/file/[fileId]`の1回限りのダウンロード枠を消費し即削除を誘発してしまうため、共有がプレビュー可であっても無条件でプレビューを非表示にする。

`accounts.plan`と`accounts.plan_expires_at`から実効プランを判定するのが`getAccountPlanInfo()`/`effectivePlan()`で、`plan_expires_at`が過去なら(DB上`plan='paid'`のままでも)自動的にfree扱いになる。これはBitcoin決済が自動更新されないための「失効」判定を兼ねている。

## 決済手段

### Stripe(カード、自動更新サブスクリプション)

- `POST /api/billing/stripe/checkout`でCheckout Session(`mode: "subscription"`)を作成し、返ってきたURLへリダイレクトするだけ(Stripe.jsは使わない)。
- `POST /api/billing/stripe/webhook`が`checkout.session.completed`(初回有効化)・`customer.subscription.updated`(更新のたびに有効期限を同期)・`customer.subscription.deleted`(即時ダウングレード)を処理する。
- Cloudflare WorkersにはNodeの`crypto`モジュールが無いため、SDKの`Stripe.createFetchHttpClient()`(HTTPクライアント)と`Stripe.createSubtleCryptoProvider()`(Webhook署名検証)を明示的に指定している。
- Stripeの新しいAPIバージョンでは請求期間(`current_period_end`)がSubscription直下ではなく各SubscriptionItemに付く。このアプリは1サブスクリプションにつき1アイテムのみ使うため、先頭アイテムの値を使う(`getSubscriptionPeriodEnd()`)。
- 同一Webhookイベントの再送による二重処理を防ぐため、`stripe_events`テーブルに処理済みイベントIDを記録する。

### Bitcoin(OpenNode、「期間チャージ」方式)

Bitcoinはカードのような自動引き落としができないため、「N日分の利用権を都度購入する」方式にしている。

- `POST /api/billing/btc/charge`でOpenNodeのcharge(請求)を作成し、ホスト型チェックアウトURLへリダイレクトする。
- OpenNodeのWebhook(`POST /api/billing/btc/webhook`)は`application/x-www-form-urlencoded`で届く(JSONではない)。署名検証は別のWebhookシークレットではなく、**charge作成に使ったAPIキー自体をHMAC鍵として使う**(`hashed_order = HMAC-SHA256(apiKey, chargeId)`、[`lib/opennode.ts`](../lib/opennode.ts))。
- 支払いが確定(`status = "paid"`)すると、`extendPaidPeriod()`(`lib/plan.ts`)で有効期限を延長する。**既に有効期限が未来にある場合はそこに積み増し**、失効済み(または初回)なら「今から」を起点にする。
- `btc_payments`テーブルの`status`列を`pending → paid`に更新する際に`WHERE status = 'pending'`を条件にすることで、OpenNodeからのWebhook再送による有効期限の二重加算を防いでいる。
- Coinbase Commerceは2026年3月に対象地域外向けサービスを終了しており、BTCPay Serverは自前サーバー運用が必要なため、いずれも不採用とした。OpenNodeはホスト型REST API+Webhookのみで完結し、現状のCloudflare Workersサーバーレス構成に合う。

### 期限切れの通知について

メールを収集しない方針のため、有料プランの期限が近い/切れたことをメールで事前通知する手段はない。ログイン時に`GET /api/account/me`で現在のプラン・有効期限を取得し、画面上に表示するだけに留めている。

## 新規APIエンドポイント

詳細は[`api.md`](./api.md)を参照。

- `POST /api/account/signup` / `login` / `logout` / `recover` / `GET /api/account/me`
- `POST /api/billing/stripe/checkout` / `POST /api/billing/stripe/webhook`
- `POST /api/billing/btc/charge` / `POST /api/billing/btc/webhook`

## 新規テーブル

`accounts` / `btc_payments` / `stripe_events`(migration 0009)。詳細は[`database.md`](./database.md)を参照。
