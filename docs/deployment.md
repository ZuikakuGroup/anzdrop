# デプロイ・CI/CD

## 自動デプロイ(GitHub Actions)

`main` ブランチへのpushをトリガーに [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) が実行され、以下を順に行う。

1. 依存関係インストール(`npm ci`)
2. `npm run lint`
3. `npx tsc --noEmit`
4. **D1マイグレーションの本番適用**: `npx wrangler d1 migrations apply DB --remote`
5. **デプロイ**: `npm run deploy`(内部で `opennextjs-cloudflare build && opennextjs-cloudflare deploy`)

いずれかのステップが失敗すると後続は実行されない(特にlint/型チェックの失敗時はマイグレーション適用・デプロイまで到達しない)。マイグレーションはデプロイより先に適用されるため、新しいカラム/テーブルを前提とするコードをデプロイする場合は、対応するマイグレーションファイルを同じPR/コミットに含めておけば自動的に順序よく反映される。

### 必要なGitHub Secrets

| Secret名 | 用途 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | `wrangler`のD1マイグレーション適用・デプロイ両方に使用。対象アカウントの Workers / D1 / R2 への書き込み権限が必要 |
| `TURNSTILE_SITE_KEY` | ビルド時に `NEXT_PUBLIC_TURNSTILE_SITE_KEY` としてクライアントバンドルへ埋め込まれる、Turnstileのサイトキー(公開情報) |

## Cloudflareリソース

[`wrangler.jsonc`](../wrangler.jsonc) で以下を宣言している。

- **Workers**: `name: "anzdrop"`、エントリーポイントは `custom-worker.ts`。
- **D1**: `binding: "DB"`, `database_name: "anzdrop-db"`(`database_id` は固定値でリポジトリに含まれる。新しい環境向けに作り直す場合は `wrangler d1 create anzdrop-db` 後にIDを書き換える)。
- **R2**: `binding: "FILES_BUCKET"`, `bucket_name: "anzdrop"`。
- **Cron Trigger**: `"0 0 * * *"`(毎日0時UTC、期限切れ共有・放置アップロードの掃除。[`architecture.md`](./architecture.md#掃除cleanup)参照)。
- **vars**: `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD`(Cloudflare Accessのチームドメイン・監査対象=AppのAudience Tag)。
- **secrets**(`wrangler secret put` で設定、リポジトリには含まれない): `TURNSTILE_SECRET_KEY`。

## Cloudflare Access(管理画面の保護)

`/admin` と `/api/admin/*` はCloudflare Access配下のアプリケーションとして1つに統合されている(コミット「管理画面のCloudflare Accessアプリを/adminと/api/adminで1つに統合」)。エッジでのアクセス制御が主たる関門で、オリジン側(`lib/access.ts`)でもJWT検証による多層防御を行っている。

新しい環境でセットアップする場合の概略:

1. Cloudflare Zero Trustダッシュボードで `/admin*` と `/api/admin/*` を保護対象としたAccessアプリケーションを作成し、許可するIdP/メールアドレス等のポリシーを設定する。
2. 作成したアプリの Audience Tag を `wrangler.jsonc` の `CF_ACCESS_AUD` に、チームドメイン(`https://<team>.cloudflareaccess.com`)を `CF_ACCESS_TEAM_DOMAIN` に設定する。
3. 設定変更後は再デプロイが必要(`vars` はビルド時にWorkerへ埋め込まれる)。

## 手動デプロイ・プレビュー

```bash
npm run preview  # ローカルでCloudflare Workers向けビルド後、wranglerのローカルプレビューを起動
npm run deploy   # ビルドしてCloudflare Workersへ直接デプロイ
```

手動デプロイ時は `CLOUDFLARE_API_TOKEN` 等の認証情報をローカルの `wrangler` にも設定しておく必要がある(`wrangler login` またはトークンを環境変数で渡す)。CIと同様、事前にD1マイグレーションの適用(`npx wrangler d1 migrations apply DB --remote`)を忘れないこと(`npm run deploy` はマイグレーションを自動実行しない)。
