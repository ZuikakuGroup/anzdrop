# オウンドメディア

`/blog` は microCMS の公開済みコンテンツをサーバー側で取得して表示する。記事本文や閲覧情報を Anzdrop の D1/R2 へ保存しない。

## microCMS の API

いずれもリスト形式 API とし、コンテンツIDを公開URLの識別子として使う。IDは公開後に変更しない。

| API | フィールド |
| --- | --- |
| `blog-posts` | title、excerpt、body（リッチエディタ）、eyecatch（必須）、category（1件）、tags（複数）、author（1件） |
| `blog-categories` / `blog-tags` | name、description |
| `blog-authors` | name、bio、image（必須）、externalUrl（任意） |

記事のアイキャッチは必須で、一覧・詳細・OG画像に共用する。外部リンクは HTTPS を推奨する。本文は表示前にサニタイズされ、microCMS 画像 CDN 以外の本文画像は表示されない。

## 環境設定

`wrangler.jsonc` の `MICROCMS_SERVICE_DOMAIN` と `SITE_URL` を本番値へ変更する。以下は Worker secret として設定し、リポジトリ・`.env`・クライアントバンドルには含めない。

```bash
wrangler secret put MICROCMS_API_KEY
wrangler secret put MICROCMS_WEBHOOK_SECRET
```

Content API key は GET 権限だけを付与する。microCMS では4 API それぞれに `POST https://<domain>/api/revalidate/microcms` の Webhook を設定し、同一の Webhook secret を登録する。署名がない、または不正な通知は受理しない。

ブログは新しい永続キャッシュを使わず、各リクエストで microCMS の公開内容を取得する。`publishedAt[exists]` で公開済み記事だけを取得するため、APIキーに下書き取得権限があっても下書きはサイトに表示されない。そのため Webhook は署名付きの変更通知を受理するだけで、キャッシュの再検証は行わない。共有キャッシュを将来導入する場合は、D1/R2/DO への永続データ追加となるため、事前に設計と許可を得る。
