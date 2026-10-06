# CI 自動化(リンク切れ / デプロイ後 E2E / 週次レポート)

このリポジトリは **Cloudflare Pages ではなく Cloudflare Workers** に、GitHub Actions の [`deploy.yml`](../.github/workflows/deploy.yml) 経由でデプロイする。以下の3つの Workflow はその前提に合わせて追加している(Pages への二重デプロイは行わない)。

| Workflow | ファイル | 目的 |
| --- | --- | --- |
| Link Check | [`.github/workflows/link-check.yml`](../.github/workflows/link-check.yml) | Markdown / HTML / 公開 URL のリンク切れ検出 |
| E2E (post-deploy) | [`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml) | 本番デプロイ成功後の Playwright スモーク |
| Weekly Development Report | [`.github/workflows/weekly-report.yml`](../.github/workflows/weekly-report.yml) | 週次の開発活動レポート Issue |

## リンク切れチェック

### 実行タイミング

- Pull Request
- `main` への push
- 毎週月曜 03:00 UTC(定期)
- `workflow_dispatch`(手動)

### 何をチェックするか

- リポジトリ内の `README.md` と `docs/`(相対リンク含む)
- PR 以外では本番 `https://anzdrop.com` の主要ページと `sitemap.xml` / `robots.txt` も追加でチェック

設定は [`.lychee.toml`](../.lychee.toml)。`lychee` を利用し、タイムアウト・リトライ・ホスト単位レート制限・キャッシュでフレークを抑える。README/docs 検査だけ外部サイト向けに CLI で 403/429 を追加許容し、本番 URL 検査では 2xx 以外(403/429 含む)を失敗とする。404 など確定的な切れはどちらでも失敗。

### 失敗時

- Job Summary と Artifact `link-check-report` に詳細
- ログに対象 URL・ステータスが残る

### 手動実行

GitHub → Actions → **Link Check** → Run workflow

## デプロイ後 E2E

### 実行タイミング

- Workflow `Deploy to Cloudflare Workers` が **成功完了**したあと(`workflow_run`)
- `workflow_dispatch`(手動。`base_url` 入力可、既定は `https://anzdrop.com`)

### 対象 URL

既定は本番 `https://anzdrop.com`(Workers ルーター経由)。Pages Preview は使わない。

デプロイ完了後、`scripts/wait-for-url.sh` でトップが 2xx/3xx を返すまで最大180秒待つ。

`workflow_run` ではデフォルトブランチのテストコードを checkout し、検証対象は常に本番 URL とする(`workflow_run.head_sha` の privileged checkout は cache poisoning 回避のため使わない)。

### 実装しているテスト

- Smoke: トップの「Anzdrop」見出しと「アップロードする」ボタン、致命的な pageerror がないこと
- Navigation: `/about` `/pricing` `/blog` `/contact` `/report` `/legal/*` `/mypage/login` `/lp/secure-file-sharing` などが 4xx にならないこと、フッターリンク遷移

認証が必要な `/admin` や実アップロード(Turnstile)は対象外。

### 失敗時 Artifact

- `playwright-report/`(HTML)
- `test-results/`(screenshot / trace / video)
- 保存期間 7 日。成功時はアップロードしない

### ローカル実行

```bash
npx playwright install chromium
E2E_BASE_URL=https://anzdrop.com npm run test:e2e
# またはローカルサーバー向け
# E2E_BASE_URL=http://127.0.0.1:3000 npm run test:e2e
```

### 手動実行

GitHub → Actions → **E2E (post-deploy)** → Run workflow

## 毎週の開発レポート

### 実行タイミング

- 毎週月曜 00:15 UTC
- `workflow_dispatch`

### 集計内容

コミット数、PR の open/merged、Issue の open/closed、Dependabot、主要 Workflow(CI / Deploy / E2E / Link Check)の成否、オープン中の PR/Issue。

実装: [`scripts/weekly-report.mjs`](../scripts/weekly-report.mjs)

### Issue 生成

- タイトル: `Weekly Development Report - YYYY-MM-DD`(生成日 UTC)
- ラベル: `weekly-report`(無ければ作成を試行。失敗しても続行)
- 同一タイトルの Issue があれば **更新**(重複作成しない)

### 手動実行

GitHub → Actions → **Weekly Development Report** → Run workflow

## 必要な GitHub Secrets

追加の必須 Secrets は **ない**(いずれも `GITHUB_TOKEN` と公開 URL で完結)。

既存のデプロイ用 `CLOUDFLARE_API_TOKEN` 等は E2E / リンクチェックでは使わない。

## トラブルシューティング

| 症状 | 確認すること |
| --- | --- |
| Link Check が外部 URL でフレークする | `.lychee.toml` の retry / accept。本当に 404 なら修正。特定ドメインだけ恒常的に bot 拒否なら `exclude` に追加を検討 |
| E2E がデプロイ直後に失敗する | Deploy workflow が success か、`wait-for-url` のログ、本番障害の有無 |
| E2E のテキストアサーション失敗 | 文言変更に合わせて `tests/e2e/` を更新 |
| Weekly report が Issue を作れない | Actions の `issues: write` 権限、Organization の Issue 制限 |
| Weekly report が重複する | タイトル完全一致で更新する実装。タイトルを手で変えると新規作成される |
