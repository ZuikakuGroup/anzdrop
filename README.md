# Anzdrop

Anzdrop(あんずどろっぷ)は、Cloudflare Workers上で動くエンドツーエンド暗号化(E2EE)のファイル共有サービスです。ファイルはブラウザ上で暗号化してからアップロードされ、復号鍵はURLのフラグメント(`#`以降)にのみ含まれるため、サーバー(運営者)は平文はもちろん復号鍵も一度も目にしません。

## 特徴

- **E2EE**: ファイルはブラウザでAES-256-GCM暗号化してからアップロード。復号鍵はURLフラグメントに載るのみで、サーバーへは送信されません。
- **チャンク分割・マルチパートアップロード**: 8MiB単位で暗号化・アップロードするため大容量ファイルにも対応(最大5GB)。
- **保存期間の選択**: 「1回」「1日」「3日」「7日」から選択可能。「1回」はファイルごとに1回ダウンロードされると即座に削除されます。
- **パスワード保護(任意)**: 設定するとパスワード由来の鍵で実際の暗号化キーをラップして保存します。パスワードなしではサーバーが侵害されても復号できません。
- **通報・モデレーション**: 誰でも共有URLを通報でき、通報時に種類(児童ポルノ等の違法コンテンツ・マルウェア・個人情報の無断掲載・スパム・その他)を選択できます。児童ポルノ等の通報は管理画面で自動的に最優先表示されます。著作権など権利者からの申し立ては専用フォーム(`/report/rights`)で受け付けます。
- **管理画面**: `/admin`でCloudflare Access配下の通報一覧・共有削除ができます。
- **自動掃除**: 期限切れの共有や、完了しなかったアップロードセッションをCronで定期的に削除します。

詳しい設計は [`docs/`](./docs) を参照してください。

## 技術スタック

- [Next.js](https://nextjs.org/)(App Router)/ React / TypeScript
- [Cloudflare Workers](https://workers.cloudflare.com/) + [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)(メタデータ)/ [Cloudflare R2](https://developers.cloudflare.com/r2/)(暗号化済みファイル本体)
- [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)(管理画面の認証)/ [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/)(アップロード時のBot対策)
- Tailwind CSS v4 / Vitest

## セットアップ

```bash
npm install
```

Cloudflareの各種バインディング(D1・R2)や認証(Cloudflare Access・Turnstile)の準備が必要です。手順は [`docs/development.md`](./docs/development.md) を参照してください。

### 開発サーバー

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000) で確認できます。ローカルのD1/R2はwranglerのローカル永続化機能を利用します。

### 主なスクリプト

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー起動(Turbopackの既知の不具合を避けるためwebpackモード) |
| `npm run build` | Next.jsの本番ビルド |
| `npm run lint` | ESLint |
| `npm test` | Vitestによるユニットテスト実行 |
| `npm run test:coverage` | カバレッジ付きテスト実行 |
| `npm run preview` | Cloudflare Workers向けビルド後、ローカルでプレビュー |
| `npm run deploy` | Cloudflare Workersへビルド・デプロイ |

`main`ブランチへのpushで GitHub Actions が自動的にD1マイグレーション適用とデプロイを行います([`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml))。

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| [`docs/architecture.md`](./docs/architecture.md) | システム構成・リクエストの流れ・Cloudflareバインディング |
| [`docs/crypto.md`](./docs/crypto.md) | E2EEの設計(鍵の生成・共有・パスワード保護の仕組み) |
| [`docs/api.md`](./docs/api.md) | APIエンドポイント一覧 |
| [`docs/database.md`](./docs/database.md) | D1のテーブル定義・マイグレーション |
| [`docs/development.md`](./docs/development.md) | ローカル開発環境の構築手順 |
| [`docs/deployment.md`](./docs/deployment.md) | デプロイ・CI/CD・必要なシークレット |
| [`docs/moderation.md`](./docs/moderation.md) | 通報・モデレーション機能の仕様 |
| [`docs/legal.md`](./docs/legal.md) | 利用規約・プライバシーポリシー・特定商取引法に基づく表記の各ページ |

## ライセンス

[Apache License 2.0](./LICENSE)
