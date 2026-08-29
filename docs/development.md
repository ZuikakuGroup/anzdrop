# ローカル開発環境

## 前提

- Node.js 22系
- Cloudflareアカウント(D1・R2・Access・Turnstileを利用する場合。ローカルのD1/R2はwranglerのローカル永続化機能で完結するため、実際にAPIを叩く動作確認だけならCloudflareアカウント無しでも一部可能だが、`npm run preview`/`npm run deploy`やCloudflare Access連携の確認にはアカウントが必要)

## セットアップ手順

```bash
npm install
```

### 環境変数

| ファイル | 用途 | 主な変数 |
| --- | --- | --- |
| `.env.local`(gitignore対象) | Next.jsのビルド/実行時にクライアント側へ埋め込む値 | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`・`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` |
| `.dev.vars`(gitignore対象) | ローカルのWorkers実行時シークレット(wranglerが読む) | `TURNSTILE_SECRET_KEY` |

いずれもリポジトリには含まれないため、各自 [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) でサイトキー・シークレットキーを発行して設定する(開発用にはテスト用の常時成功/失敗キーも利用可能)。

`wrangler.jsonc` の `vars`(`CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD`)はCloudflare Accessのチーム/アプリ設定に依存する値のため、自分の検証用Accessアプリを使う場合はここも書き換える。

### D1・R2のローカル永続化

`next.config.ts` で `initOpenNextCloudflareForDev()` にローカルD1/R2の永続化先をOSの一時ディレクトリ(`os.tmpdir()/anzdrop-wrangler-state`)に指定している(理由は後述の「既知の問題」参照)。この永続化先に対して初回のみマイグレーションを適用する必要がある。

```bash
npx wrangler d1 migrations apply DB --local --persist-to "$(node -e 'console.log(require(\"os\").tmpdir())')/anzdrop-wrangler-state"
```

新しいマイグレーションを追加した際も、上記コマンドで同じ永続化先に再適用すること。

> **注意:** `wrangler` CLIの `--persist-to` が書き込む実際のディレクトリ構成(`<path>/v3/d1/...`)と、`next dev` 経由(`@opennextjs/cloudflare`の `getPlatformProxy`)がバインディングとして実際に開く実行時のディレクトリ構成(`<path>/d1/...`、`v3`なし)がズレることがある。この場合CLIでの `migrations apply` が成功と表示されても、実際に動いている開発サーバーには反映されない(`D1_ERROR: no such table`等になる)。ズレを疑ったら、`lsof -p <workerdのpid>` で実際に開かれているsqliteファイルを特定し、そのファイルへ直接 `sqlite3 <file> < migrations/000N_*.sql` を実行する、または一度開発サーバーを再起動してから再度CLIでマイグレーションを適用する。

### 開発サーバー

```bash
npm run dev
```

内部的には `next dev --webpack` を実行している。

> **既知の問題(Turbopack)**: `next dev`(Turbopackモード、デフォルト)では、ローカルD1/R2の永続化ディレクトリへの定期的な書き込みをTurbopackのファイル監視が変更として検知し続け、既知のTurbopack内部パニック(`Next.js package not found`)を踏んで、ブラウザへ無限にフルリロードを送り続ける不具合が確認されている。これを回避するため、`dev` スクリプトはwebpackモードを使っている。本番ビルド(`npm run build`/`npm run deploy`)はTurbopackのまま影響を受けない。

> **既知の問題(.wasm静的import)**: [`lib/account/wasm-argon2/`](../lib/account/wasm-argon2/)の`.wasm`ファイルは、`next dev`(webpack)と`next build`(Turbopack)とで別々の設定(`next.config.ts`の`webpack()`・`turbopack.rules`)を必要とし、かつ実行時に渡ってくる値の形も異なる(`lib/account/wasm-argon2/wasm-interface.ts`のコメント参照)。この設定を変えると、ローカルでは問題なく動くのに本番のCloudflare Workersでだけ`CompileError: WebAssembly.compile(): Wasm code generation disallowed by embedder`で全滅する、という壊れ方をしうる(実際に一度これで本番のアカウント登録が完全に止まった)。`.wasm`のimport方法を変更した場合は、`npx opennextjs-cloudflare build`でビルドした後、`npx wrangler dev --local`(実際のビルド成果物を本物のworkerdで動かす、`next dev`とは別のローカル実行環境)でアカウント登録・ログイン・パスワード再設定を一通り確認すること。`next dev`だけの確認では不十分。

[http://localhost:3000](http://localhost:3000) で確認できる。

### Docker(任意)

[`Dockerfile`](../Dockerfile) / [`compose.yaml`](../compose.yaml) に日本語ロケール入りの最小限の開発コンテナ定義がある。`docker compose up` でコンテナに入り、コンテナ内で上記と同じ手順(`npm install` → `npm run dev`)を実行する用途。

## テスト

```bash
npm test              # Vitestでユニットテストを1回実行
npm run test:watch    # ウォッチモード
npm run test:coverage # カバレッジ付き
```

テストは `tests/` 以下に、`lib/`・`app/` のソースと同じディレクトリ構成でまとめて置かれている(例: `lib/account/password.ts` のテストは `tests/lib/account/password.test.ts`)。暗号化(`tests/lib/crypto/*.test.ts`)・アクセス制御(`tests/lib/access.test.ts`)・掃除処理(`tests/lib/cleanup.test.ts`)・保存期間計算(`tests/lib/retention.test.ts`)・各APIルート(`tests/app/api/**/route.test.ts`)などをカバーしている。共有のテストヘルパー(`createTestEnv`など)は `test/env.ts`(単数形、`tests/`とは別)にある。

## Lint・型チェック

```bash
npm run lint
npx tsc --noEmit
```

GitHub Actions(`.github/workflows/deploy.yml`)でも `main` へのpush時に同じチェックを実行しており、失敗するとデプロイは行われない。

## 動作確認のコツ

- ブラウザで実際にアップロード→共有URL発行→別タブでダウンロード、まで一通り試すのが最も確実。パスワード保護・保存期間「1回」・複数ファイル(相乗り)のケースも忘れずに。
- `/admin` はCloudflare Access配下のため、ローカルでは `lib/access.ts` の `verifyAccessJwt()` が(`CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD`が本物のAccess設定を指していない限り)常に401/403相当を返す。管理画面のロジック単体を確認したい場合は `tests/lib/access.test.ts` のようにモックしたテストで検証するか、実際にCloudflare Access配下にデプロイして確認する。
