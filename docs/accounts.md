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
- 共通ヘッダー(`components/brand/SiteHeader.tsx`)もマウント時に`GET /api/account/me`を呼び、ログイン中はアカウントIDのプルダウン(クリックで「プラン・お支払い」〈`/mypage/billing`〉と「ログアウト」を表示)を、未ログイン時は「ログイン」「アカウント作成」のリンクを表示する。判定が終わるまではどちらも表示しない(ログイン中の一瞬だけ未ログイン用ボタンが見えてしまうのを防ぐため)。

### ログインのロックアウト(総当たり対策)

アカウントIDはランダム発行ではなく本人が自由に選べるため、IDの予測不可能性には頼れない(以前はアカウントIDの長い・ランダムな文字列自体が、パスワードと並ぶ総当たり対策の一部だった)。代わりに、`POST /api/account/login`(`app/api/account/login/route.ts`)はアカウントごとにログイン失敗回数を記録し、**5回連続で失敗すると5分間そのアカウントIDでのログインを拒否する**(パスワードが正しくても拒否する)。成功時・またはリカバリーによるパスワード再設定時に失敗回数とロックはリセットされる。この情報(`accounts.failed_login_attempts`・`accounts.locked_until`、migration 0012)はログインのたびに参照・更新される、アカウントごとのカウンタのみで、個人を特定する情報ではない。

## プランの差(`lib/plan.ts`)

| | 無料プラン | Standardプラン | Premiumプラン |
| --- | --- | --- | --- |
| 価格 | ¥0 | ¥250 / 月 | ¥450 / 月(Bitcoinは参考価格) |
| 1ファイルの上限サイズ | `lib/limits.ts`の`MAX_FILE_SIZE_BYTES`(既定5GB) | 20GB | 50GB |
| 選べる保存期間 | 1回・1日・3日・7日 | 左記に加えて15日 | 左記に加えて15日・30日 |
| ブラウザ内プレビュー | 不可 | 不可 | 可(MP4/MP3/JPEG/PNGのみ。保存期間「1回」のファイルは対象外) |
| Turnstile認証(`POST /api/upload/start`) | あり | スキップ | スキップ |
| アップロードの並列数(`lib/upload/chunkUploader.ts`) | 8 | 8 | 12 |

すべて`lib/plan.ts`の`PLAN_LIMITS`に集約されており、ここを変更するだけでアップロードフロー全体・料金表示に反映される。具体的な容量・金額は暫定値。変更する場合は`lib/plan.ts`とStripeのPrice設定・`wrangler.jsonc`の`STRIPE_PRICE_ID_*`/`OPENNODE_BTC_CHARGE_AMOUNT_USD_*`を合わせて更新する([`deployment.md`](./deployment.md)参照)。

ブラウザ内プレビューの可否(`shares.preview_allowed`)も、保存期間の上限と同じく共有作成時のアップローダーの実効プランから一度だけ判定して共有に焼き込む(`lib/preview.ts`)。以後アカウントの状態が変わっても、既に作成済みの共有の値は変わらない。ダウンロード側は完全に匿名なので、この判定は「プレビューする人」ではなく「共有を作ったアップローダー」のプランに基づく。保存期間「1回」のファイルは、プレビューが`GET /api/file/[fileId]`の1回限りのダウンロード枠を消費し即削除を誘発してしまうため、共有がプレビュー可であっても無条件でプレビューを非表示にする。

`accounts.plan`と`accounts.plan_expires_at`から実効プランを判定するのが`getAccountPlanInfo()`/`effectivePlan()`で、`plan_expires_at`が過去なら自動的にfree扱いになる。これはBitcoin決済が自動更新されないための「失効」判定を兼ねている。なお`accounts.plan`は元々`"free" | "paid"`の2値だったが、Standardプラン新設に伴い`"free" | "standard" | "premium"`の3値に拡張した(migration 0013で既存の`'paid'`は`'premium'`へ正規化済み。加えて`lib/plan.ts`内の`normalizeStoredPlan()`が、万一DB上に旧値`'paid'`が残っていても`premium`として扱う防御的なエイリアスを持つ)。

## 決済手段

### Stripe(カード、自動更新サブスクリプション)

- 決済フォームはStripeのホスト型Checkoutへリダイレクトせず、自サイト内に埋め込んだStripe Elements(Payment Element、`components/billing/StripePaymentForm.tsx`)で完結する。カード番号などの機微情報はブラウザ上のStripe.js経由で直接Stripeへ送られ、自前サーバーを経由・保存することはない(PCI DSSのSAQ Aスコープを維持する設計)。
- `POST /api/billing/stripe/subscription`はリクエストボディの`plan`(`"standard"`または`"premium"`)を見て、対応するPrice(`STRIPE_PRICE_ID_STANDARD`/`STRIPE_PRICE_ID_PREMIUM`)でSubscriptionを`payment_behavior: "default_incomplete"`かつ`payment_method_types: ["card"]`で作成し、支払い確定用の`client_secret`(`latest_invoice.confirmation_secret.client_secret`。Stripeの新しいAPIバージョンではInvoiceが複数の支払い試行を持てるため、`payment_intent`ではなくこちらを使う)を返す(Checkout Sessionは使わない)。メールアドレスを収集しない方針のため、初回はメール等の個人情報を含まない空のCustomerを作成する。作成した`stripe_customer_id`/`stripe_subscription_id`は、支払い確定前のこの時点で`accounts`テーブルへ書き込んでおく(Webhookが`customer.subscription.updated`で初回有効化を検知できるようにするため)。
- クライアント側は`StripePaymentForm`が返ってきた`client_secret`で`<Elements>`/`<PaymentElement>`をマウントし、送信時に`stripe.confirmPayment({ redirect: "if_required" })`で決済を確定する。カード決済の3Dセキュア等の追加認証は通常ページ内モーダルで完結し、フルページ遷移は発生しない。
- `POST /api/billing/stripe/webhook`が`customer.subscription.updated`(初回有効化・更新時の有効期限同期の両方を兼ねる)・`customer.subscription.deleted`(即時ダウングレード)を処理する。どのプランを付与するかは、Webhookのmetadataではなく**Subscriptionの実際のPrice ID**(`subscription.items.data[0].price.id`)を見て判定する(`planFromSubscription()`)。これはStripeカスタマーポータル等で後からプランが変更された場合にも自動追従できるようにするための設計で、未知のPrice IDの場合は何も更新しない(意図しないプラン活性化を防ぐ防御的な扱い)。支払いが確定しないまま放置された`incomplete`のSubscriptionは、Stripe側が自動的に期限切れにする(サーバー側でのクリーンアップは不要)。プラン反映は`accounts.stripe_subscription_id`とイベントのSubscription IDが一致する行を対象とするが、同じアカウントが日をまたがず複数回`POST /api/billing/stripe/subscription`を呼ぶと(例: 複数タブでそれぞれ契約を開始する)、この列は最後の呼び出しのSubscription IDで上書きされる。その状態で先に作成した方のSubscriptionで支払いが確定した場合に備え、`stripe_subscription_id`が一致する行が無ければSubscriptionの`metadata.accountId`を手がかりに該当アカウントへ反映し直すフォールバックを持つ(顧客が実際に課金されたのにプランが反映されない事態を避けるため)。
- Cloudflare WorkersにはNodeの`crypto`モジュールが無いため、SDKの`Stripe.createFetchHttpClient()`(HTTPクライアント)と`Stripe.createSubtleCryptoProvider()`(Webhook署名検証)を明示的に指定している。
- Stripeの新しいAPIバージョンでは請求期間(`current_period_end`)がSubscription直下ではなく各SubscriptionItemに付く。このアプリは1サブスクリプションにつき1アイテムのみ使うため、先頭アイテムの値を使う(`getSubscriptionPeriodEnd()`)。
- 同一Webhookイベントの再送による二重処理を防ぐため、`stripe_events`テーブルに処理済みイベントIDを記録する。

### Bitcoin(OpenNode、「期間チャージ」方式)

Bitcoinはカードのような自動引き落としができないため、「N日分の利用権を都度購入する」方式にしている。

> **現在、OpenNode側の審査待ちのため、`/mypage/billing`の「ビットコインで支払う」ボタンは一時的にグレーアウトしている**(`components/billing/BillingPage.tsx`)。バックエンド(`POST /api/billing/btc/charge`・Webhook)自体は実装済みで、審査完了後にボタンの`disabled`を外すだけで有効化できる。

- `POST /api/billing/btc/charge`はリクエストボディの`plan`(`"standard"`または`"premium"`)に応じた金額(`OPENNODE_BTC_CHARGE_AMOUNT_USD_STANDARD`/`_PREMIUM`)でOpenNodeのcharge(請求)を作成し、ホスト型チェックアウトURLへリダイレクトする。どのプラン向けの支払いかは`btc_payments.plan`列に記録しておき、Webhook確定時に読み戻して`accounts.plan`へ反映する(OpenNodeのWebhook本文にはプラン種別の情報が含まれないため)。
- OpenNodeのWebhook(`POST /api/billing/btc/webhook`)は`application/x-www-form-urlencoded`で届く(JSONではない)。署名検証は別のWebhookシークレットではなく、**charge作成に使ったAPIキー自体をHMAC鍵として使う**(`hashed_order = HMAC-SHA256(apiKey, chargeId)`、[`lib/opennode.ts`](../lib/opennode.ts))。
- 支払いが確定(`status = "paid"`)すると、`extendPaidPeriod()`(`lib/plan.ts`)で有効期限を延長する。**既に有効期限が未来にある場合はそこに積み増し**、失効済み(または初回)なら「今から」を起点にする。
- `btc_payments`テーブルの`status`列を`pending → paid`に更新する際に`WHERE status = 'pending'`を条件にすることで、OpenNodeからのWebhook再送による有効期限の二重加算を防いでいる。
- Coinbase Commerceは2026年3月に対象地域外向けサービスを終了しており、BTCPay Serverは自前サーバー運用が必要なため、いずれも不採用とした。OpenNodeはホスト型REST API+Webhookのみで完結し、現状のCloudflare Workersサーバーレス構成に合う。

### 期限切れの通知について

メールを収集しない方針のため、有料プランの期限が近い/切れたことをメールで事前通知する手段はない。ログイン時に`GET /api/account/me`で現在のプラン・有効期限を取得し、画面上に表示するだけに留めている。

## 新規APIエンドポイント

詳細は[`api.md`](./api.md)を参照。

- `POST /api/account/signup` / `login` / `logout` / `recover` / `GET /api/account/me`
- `POST /api/billing/stripe/subscription` / `POST /api/billing/stripe/webhook`
- `POST /api/billing/btc/charge` / `POST /api/billing/btc/webhook`

## 新規テーブル

`accounts` / `btc_payments` / `stripe_events`(migration 0009)。詳細は[`database.md`](./database.md)を参照。

Standardプラン新設(migration 0013・0014)で、`accounts.plan`の値域が3値に拡張され、`btc_payments`に`plan`列が追加された。新規テーブルの追加は伴わない。
