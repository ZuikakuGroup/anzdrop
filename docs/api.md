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

- 共有が存在しない/期限切れの場合はそれぞれ404/410。
- レスポンス: `{ success: true, share: { id, expires_at, wrappedKey, keySalt }, files: [{ id, name, size }] }`
  - `files` の `name` は暗号化済みファイル名(クライアント側で復号が必要)。
  - ダウンロード回数上限(保存期間「1回」)に達したファイルは一覧から自動的に除外される。
- `Cache-Control: no-store`。

### `GET /api/file/[fileId]`

ファイル本体を暗号化済みバイナリのままストリーミング返却する。

- 共有が期限切れの場合410。ファイル/共有が存在しない場合404。
- ダウンロード回数の上限チェックと加算を1つの `UPDATE ... RETURNING` で原子的に行い、条件を満たさない(既に上限到達)場合は404扱い。
- このリクエストが許可された最後の1回だった場合、レスポンスをブロックせず `ctx.waitUntil()` で裏からR2オブジェクトとDBレコードを削除する。
- レスポンスヘッダーに `Content-Disposition: attachment; filename="<暗号化済みファイル名>"` を付与(実際のファイル名表示はクライアント側で復号後に行う)。

## 通報

### `POST /api/report`

共有の通報を受け付ける。認証不要(誰でも通報可能)。

- リクエスト(共通): `{ shareId, reason, reportType?: "general"|"rights_holder" }`(`reportType`省略時は`"general"`)
- `reportType: "general"` の場合は `category` が必須(`"csam"|"malware"|"privacy"|"spam"|"other"`のいずれか、不正/未指定は400)。
- `reportType: "rights_holder"` の場合は `claimantName`・`contactEmail`(要メール形式)・`rightType`(`"copyright"|"trademark"|"portrait"|"other"`)が必須。このとき `category` はサーバー側で自動的に `"rights_infringement"` に固定され、クライアントからの指定は無視される。
- `shareId` はURL全体(`https://.../d/xxxxxxxx`)を渡しても内部で正規化される(`extractShareId`)。
- レスポンス: `{ success: true }` または `{ success: false, error }`

詳細な通報カテゴリ・モデレーション運用は [`moderation.md`](./moderation.md) を参照。

## 管理画面API(要Cloudflare Access認証)

以下は [`lib/access.ts`](../lib/access.ts) の `verifyAccessJwt()` によるCloudflare Access JWT検証を通過しないと `403 Unauthorized` を返す。主たる認証はCloudflare Access自体(エッジ側のZero Trust設定)であり、これはオリジン側の多層防御。

### `GET /api/admin/reports?status=open|resolved|all`

通報一覧を取得する。`status` 省略時は `"open"`(未対応)。

- レスポンスの `reports` は `created_at DESC` を基本としつつ、`category = "csam"` の通報を最優先で先頭に並べる。
- 各要素に共有の現況(`share.exists`/`share.expired`/`share.fileCount`)も付与される。

### `POST /api/admin/reports/[reportId]/resolve`

通報を対応済み(`resolved_at`設定)にする。

### `DELETE /api/admin/shares/[shareId]`

共有をR2/D1から完全に削除する(`lib/cleanup.ts` の `deleteShare()` を利用)。既に削除済みの共有に対しても冪等に成功扱い。
