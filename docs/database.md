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

新しいマイグレーションを追加する際は、既存の番号に続く連番のファイル名(`000N_説明.sql`)で `migrations/` に追加する。適用方法は [`development.md`](./development.md)(ローカル)・[`deployment.md`](./deployment.md)(本番、GitHub Actionsが自動実行)を参照。
