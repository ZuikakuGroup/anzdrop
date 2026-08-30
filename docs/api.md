# API リファレンス

すべてのAPIは `app/api/**/route.ts` に実装されたNext.js App RouterのRoute Handlerで、Cloudflare Workers上で動作します。特記のない限り認証不要です。

エラーレスポンスの `error` フィールドはクライアント側でそのまま表示されうるため、原則として日本語のメッセージを返す(zodスキーマの`{ error: "..." }`も含む)。

各ルートの実装は以下の共通ヘルパーを利用し、定型的なエラーハンドリング・検証・認可チェックを重複させない構成になっています。

- [`lib/api/handler.ts`](../lib/api/handler.ts) の `withApiHandler()`: try/catchと汎用500応答の共通化。
- [`lib/api/validate.ts`](../lib/api/validate.ts) の `parseJsonBody()`: [zod](https://zod.dev/) スキーマ(各ルートに置かれた `schema.ts`)によるリクエストボディの検証と400応答の共通化。リクエストボディのレスポンス型・リクエスト型も同じ `schema.ts` からエクスポートし、対応するクライアントコンポーネントと共有する。
- [`lib/api/adminAuth.ts`](../lib/api/adminAuth.ts) の `requireAdmin()`: 管理画面APIの認可チェック共通化(詳細は「管理画面API」の節を参照)。
- [`lib/turnstile.ts`](../lib/turnstile.ts) の `requireTurnstile()`: Turnstile検証+403応答の共通化。
- [`lib/share-auth.ts`](../lib/share-auth.ts) の `checkShareAccessible()`: 共有の有効期限切れ・一時停止判定の共通化(`GET /api/download/[shareId]` と `GET /api/file/[fileId]` で共用)。

## アップロード

### `POST /api/upload/start`

共有(または既存共有への相乗り)とR2マルチパートアップロードセッションを開始する。

- 新規共有作成時(`shareId`未指定時)は、アップローダーの実効プラン(未ログインは常にfree)がfreeの場合のみ `turnstileToken` によるTurnstile検証が必須。Standard/Premiumはログイン済みアカウントであることが分かっているため検証をスキップする(`isTurnstileRequiredForPlan()`、[`lib/plan.ts`](../lib/plan.ts))。既存共有への相乗り(`shareId`指定時)は `uploadToken` の一致で認可し、プランに関わらずTurnstile再検証は行わない。
- リクエスト: `{ encryptedFileName, fileSize, retention: "once"|"1d"|"3d"|"7d"|"15d"|"30d", shareId?, uploadToken?, wrappedKey?, keySalt?, turnstileToken? }`
  - `wrappedKey`/`keySalt` は新規共有かつパスワード保護を設定した場合のみ。
- レスポンス: `{ success: true, shareId, uploadToken, uploadSessionId, expiresAt }`
- ファイルサイズ上限・選べる`retention`はアップローダーの実効プランによって異なる(free: 5GB・`once`/`1d`/`3d`/`7d`、standard: 20GB・上記+`15d`、premium: 50GB・上記+`30d`)。詳細は[`accounts.md`](./accounts.md#プランの差libplants)の表を参照。超過・許可外の場合はそれぞれ400/403。

### `POST /api/upload/chunk`

暗号化済みチャンク1つをR2マルチパートアップロードの1パートとして送信する。

- ヘッダー: `Anzdrop-Upload-Session`(アップロードセッションID)、`Anzdrop-Part-Number`(1始まりの整数)
- ボディ: 暗号化済みバイナリ(`application/octet-stream`相当)
- レスポンス: `{ success: true, partNumber }`

### `POST /api/upload/complete`

全パート送信後にマルチパートアップロードを完了し、`files` テーブルへレコードを作成する。

- リクエスト: `{ uploadSessionId }`
- レスポンス: `{ success: true, fileId }`
- 完了後、対応する `uploads`/`upload_parts` の行は削除される。

## ダウンロード

### `GET /api/download/[shareId]`

共有のメタデータとファイル一覧を返す。

- 共有が存在しない/期限切れ/一時停止中の場合はそれぞれ404/410/403。
- レスポンス: `{ success: true, share: { id, expires_at, wrappedKey, keySalt, previewAllowed }, files: [{ id, name, size, isOneTime }] }`
  - `files` の `name` は暗号化済みファイル名(クライアント側で復号が必要)。
  - `previewAllowed` は共有作成時のアップローダーの実効プランから一度だけ決まる(有料プランのみ`true`)。`true`の場合、対応拡張子(MP4/MP3/JPEG/PNG)のファイルはクライアント側で`/api/file/[fileId]`を使ってブラウザ内プレビューできる([`lib/preview.ts`](../lib/preview.ts))。
  - `isOneTime`が`true`のファイル(保存期間「1回」)は、プレビューが`/api/file/[fileId]`の1回限りのダウンロード枠を消費し即削除を誘発してしまうため、`previewAllowed`が`true`でもクライアント側でプレビューを非表示にする。
  - ダウンロード回数上限(保存期間「1回」)に達したファイルは一覧から自動的に除外される。
- `Cache-Control: no-store`。

### `GET /api/file/[fileId]`

ファイル本体を暗号化済みバイナリのままストリーミング返却する。

- 共有が期限切れの場合410、一時停止中の場合403。ファイル/共有が存在しない場合404。
- ダウンロード回数の上限チェックと加算を1つの `UPDATE ... RETURNING` で原子的に行い、条件を満たさない(既に上限到達)場合は404扱い。
- このリクエストが許可された最後の1回だった場合、レスポンスをブロックせず `ctx.waitUntil()` で裏からR2オブジェクトとDBレコードを削除する。
- レスポンスヘッダーに `Content-Disposition: attachment; filename="<暗号化済みファイル名>"` を付与(実際のファイル名表示はクライアント側で復号後に行う)。

## 通報

### `POST /api/report`

共有の通報を受け付ける。認証不要(誰でも通報可能)だが、ボットによる大量送信を防ぐため `turnstileToken` によるTurnstile検証が必須(`/api/upload/start`の新規共有作成時と同様)。

- リクエスト(共通): `{ shareId, reason, reportType?: "general"|"rights_holder", turnstileToken }`(`reportType`省略時は`"general"`)
- `reportType: "general"` の場合は `category` が必須(`"csam"|"malware"|"privacy"|"spam"|"other"`のいずれか、不正/未指定は400)。
- `reportType: "rights_holder"` の場合は `claimantName`・`contactEmail`(要メール形式)・`rightType`(`"copyright"|"trademark"|"portrait"|"other"`)が必須。このとき `category` はサーバー側で自動的に `"rights_infringement"` に固定され、クライアントからの指定は無視される。
- `shareId` はURL全体(`https://.../d/xxxxxxxx`)を渡しても内部で正規化される(`extractShareId`)。
- レスポンス: `{ success: true }` または `{ success: false, error }`

詳細な通報カテゴリ・モデレーション運用は [`moderation.md`](./moderation.md) を参照。

## お問い合わせ

### `POST /api/contact`

特定の共有に紐づかない一般的な問い合わせを受け付ける。認証不要だが、`turnstileToken` によるTurnstile検証が必須。

- リクエスト: `{ name?, email, subject, message, turnstileToken }`(`name`のみ任意)
- `email` はメール形式チェックあり(不正/未指定は400)。`subject`・`message` も必須。
- レスポンス: `{ success: true }` または `{ success: false, error }`

不正なファイルの通報・権利侵害の申し立ては専用の `POST /api/report` を使う(上記「通報」セクション参照)。

## アカウント・有料プラン

詳細な設計は [`accounts.md`](./accounts.md) を参照。メールアドレスは収集しない。

### `POST /api/account/signup`

アカウントを新規作成する。ボット対策として `turnstileToken` が必須。

- リクエスト: `{ accountId, password, turnstileToken }`(`accountId`は本人が自由に決める3〜32文字の半角英数字・ハイフン・アンダースコア。パスワードは8〜200文字)
- レスポンス: `{ success: true, accountId, recoveryCode }`。`recoveryCode` はこの応答でのみ表示され、以後サーバーは平文を保持しない。
- `accountId`が既に使われている場合は409(`{ success: false, error }`)。

### `POST /api/account/login`

- リクエスト: `{ accountId, password, turnstileToken }`
- 成功時、セッションCookie(`anzdrop_session`)を発行する。レスポンス: `{ success: true }`
- 同一アカウントIDで5回連続してログインに失敗すると、5分間はパスワードが正しくても403になる([`accounts.md`](./accounts.md#ログインのロックアウト総当たり対策)参照)。

### `POST /api/account/logout`

セッションCookieを失効させる。リクエストボディ不要。

### `POST /api/account/recover`

アカウントID・リカバリーコードでパスワードを再設定する。メールでの再設定手段はない。

- リクエスト: `{ accountId, recoveryCode, newPassword, turnstileToken }`
- レスポンス: `{ success: true, recoveryCode }`。パスワードと同時にリカバリーコードも再発行される(使い捨て)。

### `GET /api/account/me`

ログイン中アカウントのプラン・有効期限を返す(要セッションCookie)。

- レスポンス: `{ success: true, accountId, plan: "free"|"standard"|"premium", planExpiresAt: string|null }`

### `POST /api/billing/stripe/subscription`

ログイン必須。指定プランのStripe Subscriptionを`payment_behavior: "default_incomplete"`で作成し、支払い確定用の値を`clientSecret`として返す(値はInvoiceの`latest_invoice.confirmation_secret.client_secret`から取得したもの)。クライアントはこの`clientSecret`でStripe Elements(Payment Element)をマウントし、自サイト内のフォームで決済を確定する(ホスト型Checkoutへのリダイレクトはしない)。

- リクエスト: `{ plan: "standard"|"premium" }`
- レスポンス: `{ success: true, clientSecret }`

### `POST /api/billing/stripe/webhook`

Stripeからのサーバー間Webhook。`stripe-signature` ヘッダーで署名検証する。人間が直接叩くエンドポイントではない。

### `POST /api/billing/stripe/sync`

ログイン必須。`customer.subscription.updated` / `deleted` のWebhookが一時的に届かなかった場合の保険。アカウントに紐づく`stripe_subscription_id`のSubscriptionをStripeから取り直し、`accounts.plan` / `plan_expires_at`をStripe側の実態へ合わせ直す(Webhookと同じ列・同じ判定を使い、新しい情報の保存はしない)。`/mypage`と`/mypage/billing`の初回表示時、およびカード決済確定直後のポーリングでクライアントから呼ばれる(クライアント側の呼び出し・401/500ハンドリングは`lib/account/planStatus.ts`に集約)。Stripeで契約したことが無いアカウントはStripe APIを呼ばず現在値を返す。あわせて画面表示用の現在のサブスクリプション要約も返す。

- レスポンス: `{ success: true, accountId, plan, planExpiresAt, subscription }`。`subscription`は`{ state: "active"|"canceling"|"past_due", currentPeriodEnd: string|null }`または`null`。`"canceling"`は期間末で終了予定(自動更新停止済み)、`"past_due"`は更新の決済に失敗しdunningリトライ中(お支払い方法の更新か自動更新の停止が必要)を表し、このとき`currentPeriodEnd`は常に`null`(Stripeの`current_period_end`が未払いの次期を指しうるため、支払い済みの期限としては使わない)。
  - `null`になるのは、契約が無い / Subscriptionが`active`・`trialing`・`past_due`のいずれでもない(`incomplete`・`canceled`等) / retrieveが失敗し`plan_expires_at`も過去のとき。
  - Stripe取得が**404**(Stripe側にSubscriptionが無い)の場合は、`accounts`を一切書き換えない。404はモード/APIキーの取り違えや破損IDでも起きるうえ、`stripe_subscription_id`まで外すと本物の削除時に後続の`customer.subscription.deleted`が突き合わせ先を失うため。実際のダウングレードは署名検証済みの`deleted`と`effectivePlan()`に委ねる。要約は次項と同じ暫定フォールバック。
  - Stripe取得が**404含め失敗**(モード不一致・レート制限・タイムアウト・Stripe障害)した場合は`accounts`を書き換えず、`stripe_subscription_id`があり`plan_expires_at`が未来なら暫定で`{ state: "active", currentPeriodEnd: planExpiresAt }`を返す(`active`/`canceling`の区別は付かない)。

### `POST /api/billing/stripe/cancellation`

ログイン必須。カード契約(自動更新サブスク)の期間末での解約と、その取り消し(再開)。`cancel_at_period_end`を切り替えるだけで、即時解約・日割り返金は行わない。実際のプラン失効は期間末にStripeが発火する`customer.subscription.deleted`(既存のWebhook処理)に委ねる。サーバーへ新しい情報は保存しない。

- リクエスト: `{ cancelAtPeriodEnd: boolean }`(`true`=期間末で解約、`false`=解約予約を取り消す)
- レスポンス: `{ success: true, subscription }`(形は`sync`と同じ)
- サブスクリプションが無い/`active`・`trialing`でない場合は409。Stripe取得が404(モード/APIキーの取り違え・破損ID・実際の削除)の場合も`accounts`を変更せず409を返す(`stripe_subscription_id`を外すと本物の削除時に`customer.subscription.deleted`が突き合わせ先を失うため)。それ以外のStripe障害は500

### `POST /api/billing/btc/charge`

ログイン必須。OpenNodeでBitcoin決済のchargeを作成する(「期間チャージ」方式、自動更新なし)。

- リクエスト: `{ plan: "standard"|"premium" }`
- レスポンス: `{ success: true, hostedCheckoutUrl }`

### `POST /api/billing/btc/webhook`

OpenNodeからのサーバー間Webhook(`application/x-www-form-urlencoded`)。`hashed_order`(HMAC-SHA256、鍵はAPIキー自体)で署名検証する。人間が直接叩くエンドポイントではない。

## 管理画面API(要Cloudflare Access認証)

以下は [`lib/api/adminAuth.ts`](../lib/api/adminAuth.ts) の `requireAdmin()` が内部で呼ぶ [`lib/access.ts`](../lib/access.ts) の `verifyAccessJwt()` によるCloudflare Access JWT検証を通過しないと `403 Unauthorized` を返す。主たる認証はCloudflare Access自体(エッジ側のZero Trust設定)であり、これはオリジン側の多層防御。状態を変更するPOST/DELETEルートは、`verifyAccessJwt()` に加えて `verifySameOrigin()` によるOriginヘッダー検証(CSRF対策の多層防御)も行い、不一致の場合は `403 Invalid origin` を返す。読み取り専用の `GET /api/admin/reports` はOrigin検証を行わない。

### `GET /api/admin/reports?status=open|resolved|all`

通報一覧を取得する。`status` 省略時は `"open"`(未対応)。

- レスポンスの `reports` は `created_at DESC` を基本としつつ、`category = "csam"` の通報を最優先で先頭に並べる。
- 各要素に共有の現況(`share.exists`/`share.expired`/`share.suspended`/`share.fileCount`)も付与される。

### `POST /api/admin/reports/[reportId]/resolve`

通報を対応済み(`resolved_at`設定)にする。

### `DELETE /api/admin/reports/[reportId]`

通報を削除する。誤送信・スパム的な通報などを一覧から完全に取り除く用途。既に削除済みの通報に対しても冪等に成功扱い。対応済みにする(`resolve`)とは異なり、行自体をDBから削除する。

### `GET /api/admin/contacts?status=open|resolved|all`

お問い合わせ一覧を取得する。`status` 省略時は `"open"`(未対応)。`reports`と異なり共有には紐づかないため、共有の現況は含まない。

### `POST /api/admin/contacts/[contactId]/resolve`

お問い合わせを対応済み(`resolved_at`設定)にする。

### `DELETE /api/admin/contacts/[contactId]`

お問い合わせを削除する。既に削除済みのお問い合わせに対しても冪等に成功扱い。

### `GET /api/admin/shares/[shareId]`

通報の有無にかかわらず、共有IDを直接指定して現況(`share.exists`/`share.expired`/`share.suspended`/`share.fileCount`)を取得する。`/admin`画面の「共有IDを直接操作する」欄から使う、読み取り専用ルートのためOrigin検証は行わない。

### `DELETE /api/admin/shares/[shareId]`

共有をR2/D1から完全に削除する(`lib/cleanup.ts` の `deleteShare()` を利用)。既に削除済みの共有に対しても冪等に成功扱い。

### `POST /api/admin/shares/[shareId]/suspend` / `POST /api/admin/shares/[shareId]/unsuspend`

共有を一時停止/再開する(`shares.suspended_at` の設定/解除)。削除と異なりR2/D1のデータは保持されたままで、一時停止中は当該共有のダウンロード(`GET /api/download/[shareId]`, `GET /api/file/[fileId]`)と追加アップロード(相乗り、`POST /api/upload/start`)がすべて403で拒否される。いずれも冪等(既に同じ状態への操作は無害)。
