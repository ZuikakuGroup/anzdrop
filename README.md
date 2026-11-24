# Anzdrop

Anzdrop（あんずどろっぷ）は、ファイル本体とファイル名をブラウザで暗号化するE2EEファイル共有サービスです。

通常の共有では復号鍵をURLフラグメントに含めます。パスワード保護時はブラウザで鍵をラップし、生の復号鍵をURLに含めません。

## 利用できる機能

アカウントを作らずにファイルを送受信できます。無料プランでは1ファイル5GBまで送信でき、保存期間は「1回」「1日」「3日」「7日」から選べます。「1回」のファイルは1回のダウンロード完了後に削除され、ダウンロードされない場合も7日で期限切れになります。

Standardは1ファイル20GB・最長15日、Premiumは50GB・最長30日に対応します。アカウント登録にメールアドレスは使いません。プランの条件と課金の仕組みは[アカウント・有料プラン](./docs/accounts.md)を参照してください。

ファイルは8MiBずつ暗号化・転送するため、送信前にファイル全体をメモリへ読み込む必要はありません。パスワード保護、複数ファイルの共有、受信時のZIP保存に対応しています。通報・問い合わせの受付と管理画面、期限切れデータの自動削除も備えています。

## 開発環境を起動する

Node.js 22.12以降とnpmを使います。CIはNode.js 24系です。初回の環境設定とローカルD1へのマイグレーション適用は、[開発ガイド](./docs/development.md)に従ってください。

```sh
npm ci
# 開発ガイドに沿って環境変数とローカルD1を準備する
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開きます。APIはローカルのHono Workerで動き、D1・R2もローカル環境を使います。認証や外部サービス連携の設定は、確認したい機能に応じて追加します。

| コマンド | 用途 |
| --- | --- |
| `npm run dev` | Astro＋Reactの画面とHono APIを起動 |
| `npm run check` | Lint、各型チェック、Vitestを順に実行 |
| `npm test` | Vitestだけを実行 |
| `npm run test:astro-hono` | 隔離したローカル環境で画面・認証・ファイル共有を検証 |
| `npm run build` | 3つのWorkerをビルド。Cloudflareにはデプロイしない |
| `npm run preview` | ビルド済みのWorkerをローカルで起動 |
| `npm run audit:web` | 起動中のサイトをSEO・Lighthouseで検査 |

公開ページだけの開発、3ブラウザのE2E、計測コマンドの使い方は[開発ガイド](./docs/development.md)にまとめています。

## 構成とデプロイ

画面はAstroとReact、APIはHonoで実装しています。Cloudflare上では、リクエストを振り分けるルーター、画面を返すAstro、APIを処理するHonoの3つのWorkerを使います。D1には共有・認証などのメタデータ、R2には暗号化済みファイルを保存します。管理画面はCloudflare Accessで保護し、Bot対策にはTurnstileを使います。

`main`へのPRマージ後、GitHub Actionsが検証・ビルド・D1マイグレーション・デプロイを実行します。配信した成果物はSHA-256とGitHub Artifact Attestation、WorkerのVersion ID・Deployment IDで追跡できます。これはデプロイの来歴を確認する仕組みで、Cloudflare上の実行コードを暗号学的に証明するものではありません。運用手順は[デプロイガイド](./docs/deployment.md)を参照してください。

## 目的別のドキュメント

| 知りたいこと | ドキュメント |
| --- | --- |
| ローカル起動・テスト・動作確認 | [開発ガイド](./docs/development.md) |
| 全体構成・処理の流れ・コードの責務 | [アーキテクチャ](./docs/architecture.md) |
| 暗号化・復号・鍵の受け渡し | [E2EEの設計](./docs/crypto.md) |
| APIの入力・応答・認証条件 | [APIリファレンス](./docs/api.md) |
| D1のテーブル・保持データ・マイグレーション | [データベース](./docs/database.md) |
| アカウント・パスキー・OTP・有料プラン | [アカウント・有料プラン](./docs/accounts.md) |
| 本番環境・Secret・反映・切り戻し | [デプロイガイド](./docs/deployment.md) |
| CIの実行条件・失敗時の対応・PR自動分割 | [CI自動化](./docs/ci-automations.md) |
| 障害検知・ヘルスチェック・通知設定・復旧 | [運用Runbook](./docs/operations.md) |
| イベント・識別子・分析指標 | [計測・分析基盤](./docs/analytics.md) |
| 通報・問い合わせ・管理画面 | [通報・モデレーション](./docs/moderation.md) |
| 規約・ポリシーページの更新 | [規約・ポリシーページ](./docs/legal.md) |
| microCMS・ブログ配信 | [オウンドメディア](./docs/media.md) |
| SEO・Lighthouseの検査 | [Web監査](./docs/web-audit.md) |
| Safari製品での実機確認 | [Safari実機確認表](./docs/safari-file-sharing-checklist.md) |
| 色・文字・レイアウト・共通部品 | [UIデザインシステム](./DESIGN.md) |

## ライセンス

[Apache License 2.0](./LICENSE)
