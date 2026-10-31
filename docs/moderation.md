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

著作権などの権利者本人が申し立てられるよう、フォーム内に `/report/rights` へのリンクを置いている。

### 権利者向け(`/report/rights`, `components/report/RightsHolderReportForm.tsx`)

著作権・商標権・肖像権などの侵害を主張する権利者本人(またはその代理人)向けの専用フォーム。共有URL・理由に加え、申立者名・連絡先メールアドレス・権利の種類(`right_type`: `copyright`/`trademark`/`portrait`/`other`)、および「内容が真実であり正当な権利者/代理人である」ことの確認チェックボックスが必須。

送信時、`category` はユーザーに選ばせず **サーバー側で自動的に `"rights_infringement"` に固定** される(`server/routes/report/route.ts`)。これは一般向けフォームの `category` 選択肢(`csam`/`malware`/`privacy`/`spam`/`other`)には含まれない値で、クライアントから `rights_infringement` を指定しても一般通報のバリデーションには通らない(=なりすまし不可)。

## お問い合わせフォーム(`/contact`, `components/contact/ContactForm.tsx`)

通報・権利侵害の申し立てとは別に、特定の共有に紐づかない一般的な問い合わせ(質問・要望など)を受け付けるフォーム。氏名(任意)・メールアドレス・件名・本文を送信する。`reports`テーブルは`share_id`が必須のため、通報とは別に`contacts`テーブル(migration 0015)へ保存する(詳細は[`database.md`](./database.md#contacts))。

通報フォームと同様にTurnstile検証が必須で、自由記述欄(氏名・件名・本文)は保存前に[`lib/sanitize.ts`](../lib/sanitize.ts)の`sanitizeReportText()`でE2EE復号鍵らしき文字列を除去する(下記「管理画面」セクションで説明している`reports`の`reason`欄と同じ処理)。管理画面は`/admin/contacts`(`components/admin/AdminContactsPage.tsx`)で、`/admin`とは`AdminNav`のタブ切り替えで行き来できる。

## 優先度付け(CSAM対応)

児童ポルノ等の違法コンテンツ(`category = "csam"`)は特に迅速な対応が必要なため、以下の形で管理画面上の視認性を高めている。

- `GET /api/admin/reports` のSQLで `ORDER BY (category = 'csam') DESC, created_at DESC` を指定し、対応状況フィルタ(未対応/対応済み/すべて)に関わらず `csam` カテゴリの通報を常に一覧の先頭に表示する。
- 管理画面(`components/admin/AdminReportsPage.tsx`)では該当する通報カードを赤枠で囲み、「緊急対応」バッジを表示する。

これはあくまで**自己申告に基づく優先表示**であり、通報内容そのものの真偽をシステムが検証しているわけではない(通報自体は認証不要のAPIで、誰でも送信できる。ただしTurnstile検証により機械的な大量送信は防いでいる)。最終的な判断・対応は管理者が行う。

## 管理画面(`/admin`, `components/admin/AdminReportsPage.tsx`)

Cloudflare Access配下([`deployment.md`](./deployment.md#cloudflare-access管理画面の保護)参照)。`/admin`(通報)・`/admin/contacts`(お問い合わせ)はそれぞれ独立したページで、両ページ上部の`AdminNav`タブで行き来できる。

共有IDから対象を検索でき、通報のない共有も操作できる。一覧は「未対応」「対応済み」「すべて」で絞り込む。各通報にはカテゴリと共有の状態（存在・期限切れ・一時停止・ファイル数）を表示し、権利者申し立てには申立者名・連絡先・権利の種類を加える。

| 操作 | API | 影響 |
| --- | --- | --- |
| 共有IDで検索 | `GET /api/admin/shares/[shareId]` | 共有の現在の状態を取得 |
| 対応済みにする | `POST /api/admin/reports/[reportId]/resolve` | `resolved_at`を設定 |
| 一時停止する・解除する | `POST /api/admin/shares/[shareId]/suspend`・`/unsuspend` | データを保持したまま、ダウンロードと追加アップロードを禁止・再開 |
| 共有を削除する | `DELETE /api/admin/shares/[shareId]` | R2・D1から完全削除。取り消し不可。削除前に確認ダイアログを表示 |
| この通報を削除する | `DELETE /api/admin/reports/[reportId]` | 通報行だけを削除し、共有は残す。確認ダイアログを表示 |

共有の削除は[`lib/cleanup.ts`](../lib/cleanup.ts)の`deleteShare()`で行う。画面を改修する際は、操作前の注意を削除対象と取り消せない影響に絞り、一覧の使い方や保存処理の説明を画面に重ねない。

運営者は共有URL(=どのファイル群を対象にするか)をもとに削除等の対応を行うのみで、**ファイルの中身を復号して確認することはない**(そもそも復号鍵をサーバーは持たない。詳細は [`crypto.md`](./crypto.md))。

共有URLは `https://.../d/{shareId}#{復号鍵}` の形式で、復号鍵はURLフラグメント(`#`以降)に入る([`crypto.md`](./crypto.md)参照)。通報フォームの「共有URL」欄は `extractShareId()`(`server/routes/report/route.ts`)でフラグメントを除いた `shareId` のみを抽出するが、自由記述の「理由」欄にユーザーが鍵(または鍵付きURL)を貼り付けてしまうケースに備え、保存前に [`lib/sanitize.ts`](../lib/sanitize.ts) の `sanitizeReportText()` で以下の2段階のサニタイズを行ってからD1へ保存している(送信直前のクライアント側と、受信時のサーバー側の両方で適用)。

1. URLらしき文字列の場合、フラグメント部分(`#`以降)を機械的に除去する。
2. URLの形をしていなくても、復号鍵はbase64urlエンコードされた固定長文字列(AES-256-GCM鍵なら43文字、`AES_KEY_LENGTH`から導出)になるため、その文字種(英数字・`-`・`_`)が43文字以上連続する箇所があれば、そのひと続き全体を除去する。「鍵は○○です」のように鍵の文字列だけが書き写された場合にも対応するため。「ちょうど43文字」ではなく「43文字以上」を対象にしているのは、鍵の前後に別の文字が1つでもくっつくと完全一致条件から外れ、鍵が丸ごと残ってしまう問題を防ぐため。

## 今後の検討事項

このサービスは認証なしで誰でもアップロード可能な公開サービスとして運用されている。通報・優先表示の仕組みは事後対応の枠組みであり、アップロード自体の不正利用対策(レート制限の強化、既知の悪用パターン検知など)は別途の検討課題として残っている。
