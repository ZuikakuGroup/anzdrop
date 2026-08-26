# API リファレンス

すべてのAPIは `app/api/**/route.ts` に実装されたNext.js App RouterのRoute Handlerで、Cloudflare Workers上で動作します。特記のない限り認証不要です。

## アップロード

### `POST /api/upload/start`

共有(または既存共有への相乗り)とR2マルチパートアップロードセッションを開始する。

- 新規共有作成時(`shareId`未指定時)は `turnstileToken` によるTurnstile検証が必須。既存共有への相乗り(`shareId`指定時)は `uploadToken` の一致で認可し、Turnstile再検証は行わない。
- リクエスト: `{ encryptedFileName, fileSize, retention: "once"|"1d"|"3d"|"7d", shareId?, uploadToken?, wrappedKey?, keySalt?, turnstileToken? }`
  - `wrappedKey`/`keySalt` は新規共有かつパスワード保護を設定した場合のみ。
- レスポンス: `{ success: true, shareId, uploadToken, uploadSessionId, expiresAt }`
- ファイルサイズは `MAX_FILE_SIZE_BYTES`(5GB, [`lib/limits.ts`](../lib/limits.ts))を超えると400。

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

- レスポンス: `{ success: true, accountId, plan: "free"|"paid", planExpiresAt: string|null }`

### `POST /api/billing/stripe/checkout`

ログイン必須。Stripe Checkout Session(`mode: "subscription"`)を作成する。

- レスポンス: `{ success: true, url }`。クライアントはこのURLへリダイレクトするだけでよい(Stripe.js不要)。

### `POST /api/billing/stripe/webhook`

Stripeからのサーバー間Webhook。`stripe-signature` ヘッダーで署名検証する。人間が直接叩くエンドポイントではない。

### `POST /api/billing/btc/charge`

ログイン必須。OpenNodeでBitcoin決済のchargeを作成する(「期間チャージ」方式、自動更新なし)。

- レスポンス: `{ success: true, hostedCheckoutUrl }`

### `POST /api/billing/btc/webhook`

OpenNodeからのサーバー間Webhook(`application/x-www-form-urlencoded`)。`hashed_order`(HMAC-SHA256、鍵はAPIキー自体)で署名検証する。人間が直接叩くエンドポイントではない。

## 管理画面API(要Cloudflare Access認証)

以下は [`lib/access.ts`](../lib/access.ts) の `verifyAccessJwt()` によるCloudflare Access JWT検証を通過しないと `403 Unauthorized` を返す。主たる認証はCloudflare Access自体(エッジ側のZero Trust設定)であり、これはオリジン側の多層防御。

### `GET /api/admin/reports?status=open|resolved|all`

通報一覧を取得する。`status` 省略時は `"open"`(未対応)。

- レスポンスの `reports` は `created_at DESC` を基本としつつ、`category = "csam"` の通報を最優先で先頭に並べる。
- 各要素に共有の現況(`share.exists`/`share.expired`/`share.suspended`/`share.fileCount`)も付与される。

### `POST /api/admin/reports/[reportId]/resolve`

通報を対応済み(`resolved_at`設定)にする。

### `DELETE /api/admin/reports/[reportId]`

通報を削除する。誤送信・スパム的な通報などを一覧から完全に取り除く用途。既に削除済みの通報に対しても冪等に成功扱い。対応済みにする(`resolve`)とは異なり、行自体をDBから削除する。

### `DELETE /api/admin/shares/[shareId]`

共有をR2/D1から完全に削除する(`lib/cleanup.ts` の `deleteShare()` を利用)。既に削除済みの共有に対しても冪等に成功扱い。

### `POST /api/admin/shares/[shareId]/suspend` / `POST /api/admin/shares/[shareId]/unsuspend`

共有を一時停止/再開する(`shares.suspended_at` の設定/解除)。削除と異なりR2/D1のデータは保持されたままで、一時停止中は当該共有のダウンロード(`GET /api/download/[shareId]`, `GET /api/file/[fileId]`)と追加アップロード(相乗り、`POST /api/upload/start`)がすべて403で拒否される。いずれも冪等(既に同じ状態への操作は無害)。
