# 通報・モデレーション

Anzdropは認証なしで誰でもアップロードできる公開サービスであるため、不正利用への対応として通報機能と管理画面を用意している。

## 通報フォーム

### 一般向け(`/report`, `components/report/ReportForm.tsx`)

共有URLと理由に加え、**通報の種類(カテゴリ)** の選択を必須とする。

| `category` の値 | 表示ラベル |
| --- | --- |
| `csam` | 児童ポルノ等の違法コンテンツ |
| `malware` | マルウェア・危険なファイル |
| `privacy` | 個人情報の無断掲載・晒し |
| `spam` | スパム・迷惑行為 |
| `other` | その他 |

著作権など権利者本人からの申し立て導線として、フォーム内に `/report/rights` へのリンクを案内している。

### 権利者向け(`/report/rights`, `components/report/RightsHolderReportForm.tsx`)

著作権・商標権・肖像権などの侵害を主張する権利者本人(またはその代理人)向けの専用フォーム。共有URL・理由に加え、申立者名・連絡先メールアドレス・権利の種類(`right_type`: `copyright`/`trademark`/`portrait`/`other`)、および「内容が真実であり正当な権利者/代理人である」ことの確認チェックボックスが必須。

送信時、`category` はユーザーに選ばせず **サーバー側で自動的に `"rights_infringement"` に固定** される(`app/api/report/route.ts`)。これは一般向けフォームの `category` 選択肢(`csam`/`malware`/`privacy`/`spam`/`other`)には含まれない値で、クライアントから `rights_infringement` を指定しても一般通報のバリデーションには通らない(=なりすまし不可)。

## 優先度付け(CSAM対応)

児童ポルノ等の違法コンテンツ(`category = "csam"`)は特に迅速な対応が必要なため、以下の形で管理画面上の視認性を高めている。

- `GET /api/admin/reports` のSQLで `ORDER BY (category = 'csam') DESC, created_at DESC` を指定し、対応状況フィルタ(未対応/対応済み/すべて)に関わらず `csam` カテゴリの通報を常に一覧の先頭に表示する。
- 管理画面(`components/admin/AdminReportsPage.tsx`)では該当する通報カードを赤枠で囲み、「緊急対応」バッジを表示する。

これはあくまで**自己申告に基づく優先表示**であり、通報内容そのものの真偽をシステムが検証しているわけではない(通報自体は認証不要のAPIで、誰でも送信できる)。最終的な判断・対応は管理者が行う。

## 管理画面(`/admin`, `components/admin/AdminReportsPage.tsx`)

Cloudflare Access配下([`deployment.md`](./deployment.md#cloudflare-access管理画面の保護)参照)。

- 通報一覧を「未対応」「対応済み」「すべて」で絞り込み表示。
- 各通報カードに、通報カテゴリ・対象共有の現況(存在するか/期限切れか/ファイル数)を表示。権利者申し立ての場合は申立者名・連絡先・権利の種類も追加表示。
- 「対応済みにする」: `POST /api/admin/reports/[reportId]/resolve` で `resolved_at` を設定。
- 「共有を削除する」(確認ダイアログ付き): `DELETE /api/admin/shares/[shareId]` で対象共有をR2/D1から完全削除([`lib/cleanup.ts`](../lib/cleanup.ts)の`deleteShare()`)。

運営者は共有URL(=どのファイル群を対象にするか)をもとに削除等の対応を行うのみで、**ファイルの中身を復号して確認することはない**(そもそも復号鍵をサーバーは持たない。詳細は [`crypto.md`](./crypto.md))。

## 今後の検討事項

このサービスは認証なしで誰でもアップロード可能な公開サービスとして運用されている。通報・優先表示の仕組みは事後対応の枠組みであり、アップロード自体の不正利用対策(レート制限の強化、既知の悪用パターン検知など)は別途の検討課題として残っている。
