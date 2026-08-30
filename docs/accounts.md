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

- アカウント関連の画面は、いずれも`/mypage`配下(`/mypage`〈マイページ〉・`/mypage/login`・`/mypage/signup`・`/mypage/recover`・`/mypage/billing`)にまとめて配置している(`app/mypage/`)。`app/mypage/layout.tsx`で配下すべてを`robots: noindex`にしている。画面名は「マイページ」で統一する(h1・ヘッダーメニュー・`/mypage/billing`の戻りリンク)。
- **`/mypage`(マイページ)は状態確認専用**。表示するのはアカウントID・現在のプランと契約状態(「カードで自動更新中」「解約予約中」「有効期限あり（自動更新なし）」「無料プラン」＋次回更新日/有効期限)・現プランの主な内容(最大ファイルサイズ・最大保存期間・ブラウザ内プレビュー可否)・パスワード再設定の注意書き(リカバリーコードのみ・紛失時は復旧不可。コード自体は出さない)と、`/mypage/billing`へのリンク。プラン選択・決済・解約などの操作は一切持たず、`/mypage/billing`へ誘導する。誘導ボタンは契約状態に合わせて変える(`describeBillingCta()`。カードで自動更新中は「解約する」、解約予約中は「解約を取り消す」、それ以外は「プラン・お支払いへ」)が、遷移先は常に`/mypage/billing`で、実際の解約・再開は遷移先の`SubscriptionManager`で行う。トーンは、自動更新中(`active`)のみこのボタンが「解約」の入り口になるため前進系CTAのブランドカラー塗りではなく控えめなアウトライン(`tone: "neutral"`)にし`/mypage/billing`側の解約ボタンと揃える。解約予約中(`canceling`)は「解約を取り消す=契約を続ける」復帰系の操作で、期限を過ぎると無料に戻るため見つけやすい`primary`にする。
- 読み込み(`loadPlanStatus()` = `POST /api/billing/stripe/sync`)に失敗した場合、`/mypage`・`/mypage/billing`とも「一時的に読み込めませんでした。」の文言と**再読み込みボタン**を出す(`sync`は毎回Stripeを叩くため一時的な失敗がありうる。手動リロードしか手段がないと詰むため)。
- `/mypage`と`/mypage/billing`はどちらも初回表示時に`POST /api/billing/stripe/sync`を呼ぶ。契約状態(「自動更新中」か「解約予約中」か)と次回更新日は`GET /api/account/me`(純粋DB、`subscription`要約を返さない)では出せないため。**401**なら`/mypage/login`へリダイレクト、それ以外の失敗(500等)は「読み込みに失敗しました。」表示に留める(`sync`は毎回Stripeを叩くため500がありうる。500でリダイレクトすると`/mypage/login`側がログイン済みを見て戻しループになる)。この「sync取得＋401/500ハンドリング＋契約状態ラベル判定」は`lib/account/planStatus.ts`(`loadPlanStatus()` / `describeContract()`)に集約し、`/mypage`と`/mypage/billing`(初回＋決済後ポーリング)で共有する。
- カード契約の**解約・再開の操作(SubscriptionManager)は`/mypage/billing`にのみ置く**。`/mypage`は契約状態を表示し、`/mypage/billing`への誘導ボタンをその状態に合わせるだけ(操作自体は持たない)。`/mypage/billing`の戻りリンクは「← マイページ」。
- 逆に`/mypage/login`・`/mypage/signup`はログイン済み(`GET /api/account/me`が成功)なら`/mypage`へリダイレクトする(`lib/account/useRedirectIfLoggedIn.ts`)。ログイン成功後の遷移先も`/mypage`。行き先は暫定で、将来変更の可能性がある。
- いずれもサーバー側でのリダイレクト(Server Component等)ではなく、マウント後にAPIを呼んでクライアント側で判定する方式。判定が終わるまでは対象画面の代わりにスピナーを表示する。
- 共通ヘッダー(`components/brand/SiteHeader.tsx`)もマウント時に`GET /api/account/me`を呼び、ログイン中はアカウントIDのプルダウン(クリックで「マイページ」〈`/mypage`〉「プラン・お支払い」〈`/mypage/billing`〉「ログアウト」を表示。モバイルはアカウントID行が`/mypage`リンク)を、未ログイン時は「ログイン」「アカウント作成」のリンクを表示する。判定が終わるまではどちらも表示しない(ログイン中の一瞬だけ未ログイン用ボタンが見えてしまうのを防ぐため)。

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

**Standardプランは現在提供準備中**(Issue #5)。`/pricing`では「準備中」表示のみ、`/mypage/billing`の購入導線(`components/billing/BillingPage.tsx`の`PURCHASABLE_PLANS`)にも出していない。スキーマ・APIルート・環境変数はStandardも受け付けられる状態のまま残してあり、提供開始時は`PURCHASABLE_PLANS`に`"standard"`を戻すだけでよい。上の表のStandard列は提供開始後の想定値。

ブラウザ内プレビューの可否(`shares.preview_allowed`)も、保存期間の上限と同じく共有作成時のアップローダーの実効プランから一度だけ判定して共有に焼き込む(`lib/preview.ts`)。以後アカウントの状態が変わっても、既に作成済みの共有の値は変わらない。ダウンロード側は完全に匿名なので、この判定は「プレビューする人」ではなく「共有を作ったアップローダー」のプランに基づく。保存期間「1回」のファイルは、プレビューが`GET /api/file/[fileId]`の1回限りのダウンロード枠を消費し即削除を誘発してしまうため、共有がプレビュー可であっても無条件でプレビューを非表示にする。

`accounts.plan`と`accounts.plan_expires_at`から実効プランを判定するのが`getAccountPlanInfo()`/`effectivePlan()`で、`plan_expires_at`が過去なら自動的にfree扱いになる。これはBitcoin決済が自動更新されないための「失効」判定を兼ねている。なお`accounts.plan`は元々`"free" | "paid"`の2値だったが、Standardプラン新設に伴い`"free" | "standard" | "premium"`の3値に拡張した(migration 0013で既存の`'paid'`は`'premium'`へ正規化済み。加えて`lib/plan.ts`内の`normalizeStoredPlan()`が、万一DB上に旧値`'paid'`が残っていても`premium`として扱う防御的なエイリアスを持つ)。

## 決済手段

### Stripe(カード、自動更新サブスクリプション)

- 決済フォームはStripeのホスト型Checkoutへリダイレクトせず、自サイト内に埋め込んだStripe Elements(Payment Element、`components/billing/StripePaymentForm.tsx`)で完結する。カード番号などの機微情報はブラウザ上のStripe.js経由で直接Stripeへ送られ、自前サーバーを経由・保存することはない(PCI DSSのSAQ Aスコープを維持する設計)。
- `POST /api/billing/stripe/subscription`はリクエストボディの`plan`(`"standard"`または`"premium"`)を見て、対応するPrice(`STRIPE_PRICE_ID_STANDARD`/`STRIPE_PRICE_ID_PREMIUM`)でSubscriptionを`payment_behavior: "default_incomplete"`かつ`payment_method_types: ["card"]`で作成し、支払い確定用の`client_secret`(`latest_invoice.confirmation_secret.client_secret`。Stripeの新しいAPIバージョンではInvoiceが複数の支払い試行を持てるため、`payment_intent`ではなくこちらを使う)を返す(Checkout Sessionは使わない)。メールアドレスを収集しない方針のため、初回はメール等の個人情報を含まない空のCustomerを作成する。作成した`stripe_customer_id`/`stripe_subscription_id`は、支払い確定前のこの時点で`accounts`テーブルへ書き込んでおく(Webhookが`customer.subscription.updated`で初回有効化を検知できるようにするため)。
- クライアント側は`StripePaymentForm`が返ってきた`client_secret`で`<Elements>`/`<PaymentElement>`をマウントし、送信時に`stripe.confirmPayment({ redirect: "if_required" })`で決済を確定する。カード決済の3Dセキュア等の追加認証は通常ページ内モーダルで完結し、フルページ遷移は発生しない。
- カード決済は自動更新のサブスクリプション(改正特商法上の「定期購入契約」)にあたるため、`/mypage/billing`の「カードで契約する」ボタンの直上に、選択中プランの定期購入条件の要約(プラン名・月額(税込)・契約期間の定めなし/自動更新・解約方法・日割り返金なし)を表示している。詳細は[`legal.md`](./legal.md)。
- `POST /api/billing/stripe/webhook`が`customer.subscription.updated`(初回有効化・更新時の有効期限同期の両方を兼ねる)・`customer.subscription.deleted`(即時ダウングレード)を処理する。どのプランを付与するかは、Webhookのmetadataではなく**Subscriptionの実際のPrice ID**(`subscription.items.data[0].price.id`)を見て判定する(`planFromSubscription()`)。これはStripeカスタマーポータル等で後からプランが変更された場合にも自動追従できるようにするための設計で、未知のPrice IDの場合は何も更新しない(意図しないプラン活性化を防ぐ防御的な扱い)。支払いが確定しないまま放置された`incomplete`のSubscriptionは、Stripe側が自動的に期限切れにする(サーバー側でのクリーンアップは不要)。プラン反映は`accounts.stripe_subscription_id`とイベントのSubscription IDが一致する行を対象とするが、同じアカウントが日をまたがず複数回`POST /api/billing/stripe/subscription`を呼ぶと(例: 複数タブでそれぞれ契約を開始する)、この列は最後の呼び出しのSubscription IDで上書きされる。その状態で先に作成した方のSubscriptionで支払いが確定した場合に備え、`stripe_subscription_id`が一致する行が無ければSubscriptionの`metadata.accountId`を手がかりに該当アカウントへ反映し直すフォールバックを持つ(顧客が実際に課金されたのにプランが反映されない事態を避けるため)。このフォールバックは、現在アクティブな別Subscriptionの追跡を潰さないよう二段で保護する: (1) 現在`accounts.stripe_subscription_id`が指すSubscriptionがStripe上でまだ`active`/`trialing`なら適用しない、(2) 適用する場合もUPDATE自体のWHERE句で`stripe_subscription_id`が確認時の値のまま(NULL安全比較)かつ`plan_expires_at`が後退しないことを条件にし、1行も更新できなければ競合とみなして何もしない。
  - `customer.subscription.updated`(`active`/`trialing`)は`plan`(Price ID由来)を常に実態へ合わせるが、`plan_expires_at`は**後退させない**(`SET plan_expires_at = max(coalesce(plan_expires_at, ?), ?)`)。イベントが順不同で届いて古い請求期間末を持つものを後から処理した場合や、Bitcoinの「期間チャージ」でカードの請求期間より先まで有効期限が積まれている場合に、より手前の日付で上書きして課金済みの期間を失わせないため(`sync`側の同じガードと揃えている)。
  - `customer.subscription.deleted`(および`sync`が読み取る`canceled`/`unpaid`/`incomplete_expired`)の「即時ダウングレード」は`downgradeExpiredCardPlan()`(`lib/plan.ts`)に集約している。`stripe_subscription_id`を外し、カードが無くなった後に実際に有効な状態へ`plan`/`plan_expires_at`を合わせ直す。カード終端後に有効期間を支えるのはBitcoinの「期間チャージ」だけなので、**まだ期限が未来にある`status = 'paid'`の`btc_payments`**を見て、`plan_expires_at`は最も遠い`extends_plan_until`(無ければ現在時刻＝即時失効)、`plan`はその中で最上位の`btc_payments.plan`(無ければ`free`)にする。これにより「カードでpremium契約中にカードがdunning →その間にstandardをBitcoinで前払い →カード終端」でstandard分しか払っていないのにpremiumが残るのを防ぐ。「カード期間末解約 →その後Bitcoinで前払い →カード期間末に`deleted`が届く」という切り替え順序でも、Bitcoin前払い分は消さない。`btc_payments`の既存行を読むだけで、サーバーへ新しい情報は保存しない。
    - 注意: `extends_plan_until`には`extendPaidPeriod()`の仕様上「カードの請求期間末 + Bitcoinの日数」が入る。カードのチャージバック・返金で**即時失効**させたい不正対応では、この「カード期間分」まで残ってしまう。その場合はサポートが`accounts.plan_expires_at`を手で戻す。
- Webhookが一時的に届かない・失敗し続けると、「課金されたのにプランが反映されない」「解約済みなのに`stripe_subscription_id`の追跡が残る」状態になりうる。その保険として`POST /api/billing/stripe/sync`を用意している。`/mypage`と`/mypage/billing`の初回表示時、およびカード決済確定直後のポーリングでクライアントから呼ばれ、アカウントの`stripe_subscription_id`のSubscriptionをStripeから取り直して`accounts.plan` / `plan_expires_at`を合わせ直す。判定ロジック(Price IDからのプラン判定・請求期間末の取り出し・有効/終端ステータスの判定)はWebhookと共通で、[`lib/stripe-subscription.ts`](../lib/stripe-subscription.ts)に集約している。
  - `active`/`trialing`: `plan`は実態のPrice IDへ常に合わせ、`plan_expires_at`は後退させない範囲で期間末へ前進させる(Webhookの`customer.subscription.updated`・`sync`のどちらも同じ「後退させない」ガードを持つ)。
  - `canceled`/`incomplete_expired`/`unpaid`: Webhookの`customer.subscription.deleted`と同じく`downgradeExpiredCardPlan()`で`plan_expires_at`を現在時刻(Bitcoin前払い分があればその日付を下限)にして`stripe_subscription_id`を外す(即時ダウングレード)。ここでポインタだけ外すと、後から届いた`deleted` Webhookが突き合わせる行を失い、サポートからの即時解約(返金・不正対応)が反映されなくなるため。期間末解約の通常フローでは、Stripeが`canceled`にする時点で既に期間末に達しているので差は無い。
  - Stripeが該当Subscriptionを**404**(存在しない)で返した場合は、`accounts`を**一切書き換えない**(`stripe_subscription_id`・`plan`・`plan_expires_at`のいずれも触らない)。`retrieve`の404は契約削除だけでなくテスト/ライブモードの取り違え・APIキーやStripeアカウントの不一致・破損したIDでも起きるため、失効させると一時的なモード不一致等で課金中の顧客がfreeに落ちてしまう。さらに`stripe_subscription_id`まで外すと、本物の削除だった場合に後続の署名検証済み`customer.subscription.deleted`が契約IDでアカウントを引けず即時ダウングレードが不発になる。実際のダウングレードは`deleted` Webhookと`effectivePlan()`(期限到来時の自動free落ち)に委ねる(多発検知用のログは残す)。要約は下記の到達失敗時と同じ暫定フォールバックを返す。
  - `incomplete`/`past_due`等の中間状態: `accounts`は触らない(Webhook / 次回の同期を待つ)。ただし`past_due`は要約(`{ state: "past_due" }`)を返し、UI上は契約フローではなく管理ブロック(お支払い方法の確認 / 自動更新の停止)を出す。
  - Stripe到達に失敗した場合(前項の404、およびレート制限・タイムアウト・Stripe障害等)は、このエンドポイントを失敗させず`accounts`も書き換えず、DB由来の現在のプラン情報で`success`を返す(ここで500を返すと、請求ページを開いた課金顧客がページを使えなくなる。クライアントは401のみをログイン切れとして扱う)。この場合、`stripe_subscription_id`を持ち`plan_expires_at`が未来であれば、Stripe上の実際の状態(解約予約中かどうか)は分からないため要約は暫定的に`{ state: "active", currentPeriodEnd: plan_expires_at }`を返す。期限切れなら`null`。
  - 新しい種類の情報をサーバーへ保存するものではない。あわせて画面表示用の現在のサブスクリプション要約も返す。`active`/`trialing`のSubscriptionは`cancel_at_period_end`に応じて`{ state: "active" | "canceling", currentPeriodEnd }`、`past_due`(更新dunning中)は`cancel_at_period_end`が未設定なら`{ state: "past_due", currentPeriodEnd: null }`(設定済みなら`canceling`)、それ以外(Subscription無し・`incomplete`・`canceled`等)は`null`(＝契約フローを表示)。`past_due`で`currentPeriodEnd`を`null`にするのは、更新インボイス生成時にStripeが請求期間を未払いの次期へ前進させることがあり、`current_period_end`が支払い済みの期限より先を指しうるため(払い込み済みの期限は`accounts.plan_expires_at`側。`past_due`ではWebhook・syncとも更新しない)。ただし前項のStripe到達失敗時の暫定フォールバックは例外。
- **解約**は`POST /api/billing/stripe/cancellation`(`{ cancelAtPeriodEnd: boolean }`)で行う。`true`で「期間末での解約」(`cancel_at_period_end: true`。自動更新を停止するだけで、期間中はプランを維持)、`false`でその取り消し(自動更新を再開)。即時解約・日割り返金は行わない。実際のプラン失効は、期間末にStripeが発火する`customer.subscription.deleted`(既存のWebhook処理で`downgradeExpiredCardPlan()`により`plan_expires_at`を現在時刻へ更新し`stripe_subscription_id`を外す)に委ねる。`past_due`のSubscriptionも対象にする(自動更新を止める操作は課金を増やさないため安全。止められないと、あとでStripeのリトライが成功したときに解約意思に反して次期分が請求されてしまう)。`/mypage/billing`でのみ操作でき、`sync`が返す要約が`active`なら「解約する」ボタン(押すと2段階確認。確認画面では安全側の「解約しない」を主ボタン、「解約する」をアウトラインにする)、`past_due`なら支払い確認中の案内と同じ「解約する」ボタン、`canceling`なら「解約を取り消す」ボタンと終了予定日を表示し、いずれの状態でも新規契約フロー(プラン選択)は出さない。終了予定日は通常の`canceling`では要約の`currentPeriodEnd`の日付を表示するが、`past_due`から`cancel_at_period_end`が付いて`canceling`になった要約は`currentPeriodEnd`が`null`(前項の理由による)のため具体的な日付を出せず、「現在の請求期間の終了時」という表現に留める。このエンドポイントもサーバーへ新しい情報を保存しない。
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

メールを収集しない方針のため、有料プランの期限が近い/切れたことをメールで事前通知する手段はない。`/mypage`(マイページ)で現在のプラン・契約状態・次回更新日/有効期限を表示するだけに留めている。

## 新規APIエンドポイント

詳細は[`api.md`](./api.md)を参照。

- `POST /api/account/signup` / `login` / `logout` / `recover` / `GET /api/account/me`
- `POST /api/billing/stripe/subscription` / `POST /api/billing/stripe/webhook` / `POST /api/billing/stripe/sync` / `POST /api/billing/stripe/cancellation`
- `POST /api/billing/btc/charge` / `POST /api/billing/btc/webhook`

## 新規テーブル

`accounts` / `btc_payments` / `stripe_events`(migration 0009)。詳細は[`database.md`](./database.md)を参照。

Standardプラン新設(migration 0013・0014)で、`accounts.plan`の値域が3値に拡張され、`btc_payments`に`plan`列が追加された。新規テーブルの追加は伴わない。
