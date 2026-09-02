# データベース(Cloudflare D1)

スキーマは [`migrations/`](../migrations) 配下のSQLファイルで管理されている。ローカル・本番いずれも `wrangler d1 migrations apply` で適用する(手順は [`development.md`](./development.md) / [`deployment.md`](./deployment.md))。

## テーブル一覧

### `shares`

共有(1つの共有URLに対応する単位)。

| カラム | 型 | 説明 |
| --- | --- | --- |
| `id` | TEXT PK | `nanoid(10)`で生成される公開共有ID([`lib/id.ts`](../lib/id.ts))。URLに露出する。 |
| `created_at` | TEXT | 作成日時(ISO8601) |
| `expires_at` | TEXT | 有効期限(ISO8601)。保存期間の選択から算出([`lib/retention.ts`](../lib/retention.ts)) |
| `upload_token` | TEXT (nullable) | 複数ファイル相乗り時の所有権証明トークン。`shareId`と異なりURLに含まれない(migration 0002) |
| `wrapped_key` | TEXT (nullable) | パスワード保護時、パスワード由来鍵でラップされた暗号化鍵(migration 0004) |
| `key_salt` | TEXT (nullable) | 上記のラップに使ったPBKDF2ソルト(migration 0004) |
| `suspended_at` | TEXT (nullable) | 管理画面からの一時停止日時。設定されている間はダウンロード・追加アップロードとも拒否される(migration 0008) |
| `preview_allowed` | INTEGER NOT NULL DEFAULT 0 | 共有作成時点のアップローダーの実効プランから決まるブラウザ内プレビュー可否(1=可)。`expires_at`と同様、作成時に一度だけ確定し以後変更しない(migration 0011) |

### `uploads`

進行中のマルチパートアップロードセッション(完了すると `files` に移り、この行は削除される)。

| カラム | 型 | 説明 |
| --- | --- | --- |
| `id` | TEXT PK | アップロードセッションID |
| `share_id` | TEXT | `shares.id`への参照(`ON DELETE CASCADE`) |
| `storage_key` | TEXT | R2オブジェクトキー |
| `upload_id` | TEXT | R2マルチパートアップロードID |
| `encrypted_file_name` | TEXT | 暗号化済みファイル名 |
| `file_size` | INTEGER (nullable) | クライアント申告のファイルサイズ |
| `max_downloads` | INTEGER (nullable) | 保存期間「1回」の場合`1`、それ以外`NULL`(migration 0004) |
| `created_at` | TEXT | 作成日時。24時間経過すると放置セッションとして掃除対象になる([`lib/cleanup.ts`](../lib/cleanup.ts)) |

### `upload_parts`

マルチパートアップロードの各パートのETag。

| カラム | 型 | 説明 |
| --- | --- | --- |
| `upload_session_id` | TEXT | `uploads.id`への参照(`ON DELETE CASCADE`) |
| `part_number` | INTEGER | パート番号(1始まり) |
| `etag` | TEXT | R2から返るETag(complete時に必要) |

主キーは `(upload_session_id, part_number)`。

### `files`

完了済みファイル(1共有に複数行ありうる)。

| カラム | 型 | 説明 |
| --- | --- | --- |
| `id` | TEXT PK | ファイルID |
| `share_id` | TEXT | `shares.id`への参照(`ON DELETE CASCADE`) |
| `storage_key` | TEXT | R2オブジェクトキー |
| `encrypted_file_name` | TEXT | 暗号化済みファイル名 |
| `size` | INTEGER | ファイルサイズ(バイト) |
| `max_downloads` | INTEGER (nullable) | 保存期間「1回」の場合`1`(migration 0004) |
| `download_count` | INTEGER NOT NULL DEFAULT 0 | ダウンロード回数。`GET /api/file/[fileId]`で原子的にインクリメント(migration 0004) |
| `created_at` | TEXT | 作成日時 |

### `reports`

通報(一般通報・権利者申し立ての両方を1テーブルで管理)。

| カラム | 型 | 説明 |
| --- | --- | --- |
| `id` | TEXT PK | 通報ID |
| `share_id` | TEXT | 通報対象の共有ID(外部キー制約なし。共有が既に削除済みでも通報は残る) |
| `reason` | TEXT | 通報理由(自由記述、最大1000文字) |
| `created_at` | TEXT | 通報日時 |
| `resolved_at` | TEXT (nullable) | 対応完了日時(migration 0005) |
| `report_type` | TEXT NOT NULL DEFAULT `'general'` | `"general"` または `"rights_holder"`(migration 0006) |
| `claimant_name` | TEXT (nullable) | 権利者申し立て時の申立者名(migration 0006) |
| `contact_email` | TEXT (nullable) | 権利者申し立て時の連絡先(migration 0006) |
| `right_type` | TEXT (nullable) | 権利者申し立て時の権利種別: `"copyright"|"trademark"|"portrait"|"other"`(migration 0006) |
| `category` | TEXT NOT NULL DEFAULT `'other'` | 通報カテゴリ: `"csam"|"malware"|"privacy"|"spam"|"other"|"rights_infringement"`(migration 0007)。詳細は [`moderation.md`](./moderation.md) |

### `contacts`

一般的なお問い合わせ(ファイル共有に紐づかない質問・要望など)。`reports`は`share_id`が必須のため、特定の共有に紐づかない問い合わせには使えず、別テーブルとして新設した(migration 0015)。

| カラム | 型 | 説明 |
| --- | --- | --- |
| `id` | TEXT PK | お問い合わせID |
| `name` | TEXT (nullable) | 送信者名(任意項目) |
| `email` | TEXT | 返信先メールアドレス(必須) |
| `subject` | TEXT | 件名 |
| `message` | TEXT | 本文(自由記述、最大2000文字) |
| `created_at` | TEXT | 送信日時 |
| `resolved_at` | TEXT (nullable) | 対応完了日時 |

`name`・`subject`・`message`は、`reports`と同様に保存前に[`lib/sanitize.ts`](../lib/sanitize.ts)の`sanitizeReportText()`でE2EE復号鍵らしき文字列を除去してから保存する(詳細は[`moderation.md`](./moderation.md)参照)。

### `accounts`

有料プラン(アカウント制サブスクリプション)。メールアドレスは保存しない。

| カラム | 型 | 説明 |
| --- | --- | --- |
| `id` | TEXT PK | 本人が自由に設定するアカウントID([`lib/account/id.ts`](../lib/account/id.ts)の`isValidAccountId()`で3〜32文字・半角英数字/ハイフン/アンダースコアのみを検証。一意性はINSERT自体で判定) |
| `password_hash` | TEXT | パスワードのArgon2idハッシュ([`lib/account/password.ts`](../lib/account/password.ts)。Cloudflare WorkersランタイムがPBKDF2の反復回数を10万回までしか許可しないため、メモリハードで反復回数の制約を受けないArgon2idを採用)。実行時の動的WebAssemblyコンパイルもCloudflare Workers本番では禁止されているため、npmのhash-wasmはそのままでは使えず、静的importで済むよう自前でビルドしたWASM実装を[`lib/account/wasm-argon2/`](../lib/account/wasm-argon2/)に置いている(由来・ビルド方法は同ディレクトリの`NOTICE.md`を参照) |
| `recovery_code_hash` | TEXT | リカバリーコードのハッシュ。パスワード忘れ時の再設定にのみ使う(サインアップ時に1回だけ平文を表示し、以後は保持しない) |
| `plan` | TEXT NOT NULL DEFAULT `'free'` | `"free"` / `"standard"` / `"premium"`(旧値`"paid"`はmigration 0013で`"premium"`へ正規化済み。アプリ側の`normalizeStoredPlan()`も同じ変換を防御的に行う) |
| `plan_expires_at` | TEXT (nullable) | 有料プランの有効期限(ISO8601)。Bitcoin決済は自動更新されないため、この期限が切れるとfreeに戻る。`/admin/accounts`からの「無期限」付与では`lib/plan.ts`の`INDEFINITE_PLAN_EXPIRES_AT`(遠い未来の番兵値)が入る |
| `stripe_customer_id` | TEXT (nullable) | Stripe Customer ID |
| `stripe_subscription_id` | TEXT (nullable) | Stripe Subscription ID |
| `created_at` | TEXT | 作成日時 |
| `session_version` | INTEGER NOT NULL DEFAULT 0 | セッションCookie(JWT)に埋め込まれる世代番号。パスワード再設定([`recover`](../app/api/account/recover/route.ts))のたびにインクリメントされ、それより前に発行済みのセッションを全て失効させる(migration 0010) |
| `failed_login_attempts` | INTEGER NOT NULL DEFAULT 0 | ログイン連続失敗回数。アカウントIDが本人設定になり予測不可能性に頼れなくなったための総当たり対策(migration 0012)。成功時・パスワード再設定時に0へリセットされる |
| `locked_until` | TEXT (nullable) | この時刻まではログインを一時制限する(`failed_login_attempts`が5に達すると5分後の時刻をセット、同時に0へリセット。migration 0012)。制限中でも正しいパスワードなら本人は通すが、制限期間内の試行が20回を超えたら以降はダミー照合+403にする(標的型ロックアウト嫌がらせ対策と総当たり抑制の両立。詳細は[`accounts.md`](./accounts.md#ログインのロックアウト総当たり対策)) |

migration 0009(`session_version`は0010、`failed_login_attempts`/`locked_until`は0012)。

### `btc_payments`

Bitcoin(OpenNode)決済の履歴。カード決済と異なり自動更新できないため、支払い1回ごとに「期間チャージ」として記録する。

| カラム | 型 | 説明 |
| --- | --- | --- |
| `id` | TEXT PK | 支払いID |
| `account_id` | TEXT | `accounts.id`への参照(`ON DELETE CASCADE`) |
| `opennode_charge_id` | TEXT | OpenNode側のcharge ID |
| `status` | TEXT NOT NULL DEFAULT `'pending'` | `"pending"|"paid"|"expired"` |
| `plan` | TEXT NOT NULL DEFAULT `'premium'` | `"standard"` または `"premium"`。charge作成時のリクエストの値をそのまま記録し、Webhook確定時にこれを読み戻して`accounts.plan`へ反映する(migration 0014) |
| `extends_plan_until` | TEXT (nullable) | この支払いが確定した場合に`accounts.plan_expires_at`へ反映する日時 |
| `created_at` | TEXT | 作成日時 |

migration 0009(`plan`は0014)。

### `stripe_events`

処理済みStripe WebhookイベントIDの記録のみ(二重処理防止)。

| カラム | 型 | 説明 |
| --- | --- | --- |
| `id` | TEXT PK | StripeのイベントID |
| `processed_at` | TEXT | 処理日時 |

migration 0009。

## マイグレーション一覧

| ファイル | 内容 |
| --- | --- |
| `0001_init.sql` | 初期スキーマ(`shares`/`uploads`/`upload_parts`/`files`) |
| `0002_add_share_upload_token.sql` | `shares.upload_token` 追加(複数ファイル相乗りの認可) |
| `0003_add_reports.sql` | `reports` テーブル新設 |
| `0004_add_password_and_retention.sql` | パスワード保護(`wrapped_key`/`key_salt`)・保存期間「1回」(`max_downloads`/`download_count`)対応 |
| `0005_add_report_resolution.sql` | `reports.resolved_at` 追加(対応済み管理) |
| `0006_add_rights_holder_reports.sql` | 権利者向け申し立てフォーム対応(`report_type`/`claimant_name`/`contact_email`/`right_type`) |
| `0007_add_report_category.sql` | 通報カテゴリ(`category`)追加 |
| `0008_add_share_suspension.sql` | `shares.suspended_at` 追加(管理画面からの共有一時停止) |
| `0009_add_accounts.sql` | 有料プラン用の`accounts`/`btc_payments`/`stripe_events`テーブル新設 |
| `0010_add_session_version.sql` | `accounts.session_version` 追加(パスワード再設定時の既存セッション失効) |
| `0011_add_preview_allowed.sql` | `shares.preview_allowed` 追加(有料プラン限定のブラウザ内プレビュー機能。MP4/MP3/JPEG/PNG) |
| `0012_add_login_lockout.sql` | `accounts.failed_login_attempts`/`accounts.locked_until` 追加(アカウントID自由設定化に伴うログイン総当たり対策) |
| `0013_normalize_paid_plan_to_premium.sql` | Standardプラン新設に伴う`Plan`型3値化(`"free"\|"standard"\|"premium"`)。既存の`accounts.plan = 'paid'`を`'premium'`へ正規化 |
| `0014_add_btc_payments_plan.sql` | `btc_payments.plan` 追加(Bitcoin決済がどのプラン向けかをWebhook確定時に判定するため) |
| `0015_add_contacts.sql` | `contacts` テーブル新設(一般的なお問い合わせ) |

新しいマイグレーションを追加する際は、既存の番号に続く連番のファイル名(`000N_説明.sql`)で `migrations/` に追加する。適用方法は [`development.md`](./development.md)(ローカル)・[`deployment.md`](./deployment.md)(本番、GitHub Actionsが自動実行)を参照。
