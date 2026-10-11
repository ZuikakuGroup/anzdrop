# CI 自動化

このリポジトリは **Cloudflare Pages ではなく Cloudflare Workers** に、GitHub Actions の [`deploy.yml`](../.github/workflows/deploy.yml) 経由でデプロイする。以下の Workflow はその前提に合わせて追加している(Pages への二重デプロイは行わない)。

| Workflow | ファイル | 目的 |
| --- | --- | --- |
| Link Check | [`.github/workflows/link-check.yml`](../.github/workflows/link-check.yml) | Markdown / HTML / 公開 URL のリンク切れ検出 |
| E2E (post-deploy) | [`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml) | 本番デプロイ成功後の Playwright スモーク |
| Weekly Development Report | [`.github/workflows/weekly-report.yml`](../.github/workflows/weekly-report.yml) | 週次の開発活動レポート Issue |
| File sharing E2E | [`.github/workflows/file-sharing-e2e.yml`](../.github/workflows/file-sharing-e2e.yml) | 3ブラウザのローカル共有・保存検証 |
| Review coverage and split | [`.github/workflows/review-split.yml`](../.github/workflows/review-split.yml) | レビュー省略の通知・大規模 PR の分割 |

## リンク切れチェック

### 実行タイミング

- Pull Request
- `main` への push
- 毎週月曜 03:00 UTC(定期)
- `workflow_dispatch`(手動)

### 何をチェックするか

- リポジトリ内の `README.md` と `docs/`(相対リンク含む)
- PR 以外では本番 `https://anzdrop.com` の主要ページと `sitemap.xml` / `robots.txt` も追加でチェック

設定は [`.lychee.toml`](../.lychee.toml)。`lychee` を利用し、タイムアウト・リトライ・ホスト単位レート制限・キャッシュでフレークを抑える。README/docs 検査だけ外部サイト向けに CLI で 403/429 を追加許容し、本番 URL 検査では 2xx 以外(403/429 含む)を失敗とする。404 など確定的な切れはどちらでも失敗。`/_next/image` エンドポイントのみ(クエリ付き URL を含む)は Cloudflare Images 未設定時に 404 になりやすく、かつ HTML の `srcset` から大量に抽出されるため除外する(Deploy 完了前の古い HTML が残る場合のフレーク防止も兼ねる)。`/_next/image-preview` のような別パスや、画像の実体 URL は除外しない。

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

Link Check / E2E / Weekly report に追加の必須 Secrets は **ない**(`GITHUB_TOKEN` と公開 URL で完結)。Review coverage and split でブランチ・Draft PR を作成する場合は、下記の専用 GitHub App が必要。

既存のデプロイ用 `CLOUDFLARE_API_TOKEN` 等は E2E / リンクチェックでは使わない。

## トラブルシューティング

| 症状 | 確認すること |
| --- | --- |
| Link Check が外部 URL でフレークする | `.lychee.toml` の retry / accept。本当に 404 なら修正。特定ドメインだけ恒常的に bot 拒否なら `exclude` に追加を検討 |
| E2E がデプロイ直後に失敗する | Deploy workflow が success か、`wait-for-url` のログ、本番障害の有無 |
| E2E のテキストアサーション失敗 | 文言変更に合わせて `tests/e2e/` を更新 |
| Weekly report が Issue を作れない | Actions の `issues: write` 権限、Organization の Issue 制限 |
| Weekly report が重複する | タイトル完全一致で更新する実装。タイトルを手で変えると新規作成される |

## 大規模 PR は通知を確認し、分割した列を先頭から取り込む

対象はリポジトリの管理者・レビュー担当者。まず次の「App の準備」と「取り込み順」を確認し、停止した場合は「停止理由と復旧」を参照する。

`Review coverage and split` は CodeRabbit の「成功表示だがレビュー省略」を検出し、元 PR のコメントを更新する。PR の作成・更新・再オープン・マージ、コミットステータス、check run 完了で評価し、15分ごとの定期実行で取りこぼしを補う。GitHub の定期実行は遅れる場合がある。Actions の手動実行では `pr` に元 PR または生成 PR の番号を指定できる。

レビュー状態は「完了を確認」「省略」「処理中」「判定不能」。現在の HEAD に対する CodeRabbit の提出済みレビューを完了の証拠として使う。ステータスの `success` だけでは完了としない。新しい未対応の文言や API 障害も判定不能にする。レビューの完了と指摘の解消は別であり、この通知だけでマージを判断しない。初回は必須チェック・ブランチ保護を変更しない。

### App を準備してから自動作成を有効にする

初期状態では `REVIEW_SPLIT_ENABLED` が未設定のため、通知と分割候補の分析だけを行う。自動作成は、検証用 PR で確認してから有効にする。

1. 専用 GitHub App を作り、このリポジトリだけにインストールする。Repository permissions は **Contents: Read and write、Pull requests: Read and write、Metadata: Read**。Workflow の書き込みや保護ルールの迂回権限は与えない。Webhook サーバーは不要。
2. Repository variable `REVIEW_SPLIT_APP_ID` に App ID、Repository secret `REVIEW_SPLIT_APP_PRIVATE_KEY` に生成した PEM 秘密鍵を設定する。状態署名には独立したランダム値（32 バイト以上）を生成し、Repository secret `REVIEW_SPLIT_STATE_KEY` に設定する。App 秘密鍵を状態署名に流用しない。秘密情報をチャットやコミットへ貼り付けない。
3. ローカルテストを通し、Workflow を main に反映する。検証時だけ Repository variable `REVIEW_SPLIT_ENABLED` を文字列 `true` にし、独立したファイルを上限超過分変更した検証用 PR で、Draft 作成・各 CI・CodeRabbit を確認する。
4. 未編集 Draft の更新、失敗後の再実行、先頭の Squash merge とブランチ自動削除後の積み直しを確認する。確認が終わるまでは `REVIEW_SPLIT_ENABLED` を削除または `false` に戻す。

App 秘密鍵はトークン生成ステップだけに渡す。App 秘密鍵を更新しても、状態署名鍵を維持すれば既存の記録を検証できる。App の一時トークンは生成ブランチと PR の作成・更新にのみ使う。通知は `GITHUB_TOKEN` で行う。解析・更新の実行コードと設定は常に main から取得し、対象 PR を checkout しない。依存インストールとコンパイルは App の秘密情報を渡す前に完了する。生成 PR の通常 CI に書き込みトークンや App 秘密鍵は渡さない。

### 設定更新を含む変更は自動分割を止めることがある

[`config/review-split.json`](../config/review-split.json) の `fileLimit` は初期値100。100を超える PR だけを自動作成対象にする。改名は旧・新パスを合わせて2ファイルとして保守的に数える。ソース解析は1ファイル1MiB、各 tree 合計20MiBまで、差分は3000ファイル、生成は30 PRまで。

変更前後の import/export、動的 import の文字列、Astro の frontmatter と script、パスエイリアスを読み、参照関係のある変更と対応テストをまとめる。共通の未変更利用側、ドキュメントの相対リンクも確認する。設定・依存関係の更新や解決不能の動的参照は、影響を見落とさないよう保守的に結合する。結果が1グループになる、依存する塊が100ファイルを超える場合は作成しない。静的解析では実行時の意味まで保証できないため、生成した列にも CI と人のレビューが必要。

同一リポジトリの main 向け PR だけを自動作成する。fork、コンフリクト、マージ可否未確定、`.github/workflows/` の追加・変更・削除・改名を含む PR は通知して停止する。最新 main が元 HEAD の祖先であることも要求し、main に追加された変更を分割で失わないようにする。

### Draft のまま先頭から確認し、main 向けの PR だけをマージする

生成ブランチは `review-split/<元PR番号>/<連番>`。1番目は main 向け、2番目以降は直前の生成ブランチ向けの Draft PR になる。このように前の変更の上へ順に積む構成を、この文書では「列」と呼ぶ。各 PR の差分を小さく保ち、最後の Git tree（ファイル内容・配置・権限の一覧）が元 HEAD と一致することを作成前に確認する。

元 PR の更新は、すべてが未マージ・未編集 Draft で、人のレビューが始まっていない場合だけ追従する。本文・タイトル・対象ブランチの編集、レビュー要求、人のコメント・レビュー、Ready 化、クローズ、SHA の不一致を検出したら停止する。分割数が減る場合も、余った PR を勝手に整理せず停止する。生成 PR の本文は自動更新の照合に使うため、編集する前に自動作成を無効にする。CodeRabbit が本文を変更した場合も安全のため停止することがある。

レビューを始めるときは元 PR の変更をいったん止め、先頭 PR の CI と CodeRabbit の指摘を確認する。先頭を Ready にして main に Squash merge すると、残りの未編集 Draft の変更だけを最新 main に積み直す（restack）。次の PR が main 向けになり、CI とレビューが再実行される。以後、同じ順番で取り込む。下流 PR を生成ブランチへ直接マージすると main の保護を通らないため、自動処理は停止する。

元 PR のコード・ブランチ・開閉状態は自動化で変更しない。列を取り込んだ後の元 PR のクローズは管理者が行う。自動マージ、Ready 化、生成ブランチの削除も行わない。

### 停止理由を確認し、未完了の操作は同じ PR 番号で再実行する

元 PR には通知コメントと、App が書く署名付きの操作記録を置く。記録は、対象 SHA・生成 SHA・PR 番号・更新前の状態を持つ。元の最終内容を再現し、作成済みのブランチ・PR を確認してから再開するため、途中の API 障害や再実行で重複 PR を作らない。記録を手で書き換えると署名検証に失敗する。

| 停止理由 | 復旧方法 |
| --- | --- |
| App 未設定・権限不足 | App ID・秘密鍵・状態署名鍵・インストール対象・権限を確認し、同じ番号で手動実行する |
| 最新 main が元 HEAD に含まれない | 元ブランチに main を取り込み、更新する |
| 解析不能・上限超過・Workflow 変更 | 元の変更を手動で整理する。通知のグループ数と結合理由を確認する |
| API 障害・途中失敗 | 元 HEAD を変えずに同じ番号で再実行する。未完了記録の HEAD が変わっていたら先に記録を確認する |
| 人の編集・レビュー開始 | 自動作成を無効にし、生成 PR を人が管理する。自動化を再開したい場合は管理者が記録との差分を確認する |
| Squash 後の競合・下流の先行マージ | 自動作成を無効にし、main 向けへ手動で積み直す。署名付き記録は変更しない |
| 状態署名鍵の変更・記録の破損 | 自動作成を無効にし、既存列を手動管理する。鍵の変更前に既存列を取り込み終える |

生成ブランチの push は SHA を指定した lease（期待した状態のときだけ更新する条件）で保護する。PR の本文・タイトル・対象ブランチは更新直前に再確認し、必要なフィールドだけを書き換える。ただし GitHub の PR 更新 API には完全な比較交換がないため、確認と更新の間に行われた編集を必ず防げるとは限らない。人が編集するときは自動作成を無効にし、実行中の Workflow が終わったことを確認する。

操作記録は GitHub のコメントと Git オブジェクトだけで管理する。D1・R2・アプリのログへ新しい情報を保存せず、外部 AI にコードを送信しない。

### ローカルでは Git と API のテストを実行する

```bash
npx tsc -p scripts/review-split/tsconfig.json
npx vitest run tests/scripts/review-split --maxWorkers=1
```

Git のテストは一時リポジトリを作り、API のテストは偽の応答で実行する。上のコマンドは GitHub に PR やブランチを作らない。実際の App 認証・レビュー・CI の確認は、main 反映後の検証用 PR で行う。運用中の不明点は #240 または後続 Issue に、秘密情報を除いて停止理由を記録する。

## ファイル共有 E2E

[File sharing E2E](../.github/workflows/file-sharing-e2e.yml) は PR と Merge Queue で Chromium・Firefox・WebKit を別ジョブ、各1ワーカーで実行する。64KiB の基本共有、パスワード、ZIP を対象とし、ジョブ上限は20分。毎日18:00 UTC（翌日03:00 JST）と手動実行では、大容量・Blob・障害・キャンセルを含む拡張スイートを実行し、上限は40分。各テストは基本60秒、拡張180秒、リトライ0回。

書き込みトークンや本番ストレージを使わず、既存の隔離ローカル環境で実行する。失敗時のレポート・トレースはブラウザ別に7日間保存する。ブランチ保護は変更しない。既存の post-deploy は Chromium のみを明示し、共有スイートは本番では実行しない。

実行コマンド・保存経路の判定・障害注入は [開発ガイド](development.md)、Safari 製品の確認状況は [実機確認表](safari-file-sharing-checklist.md) を参照する。
