# SEO / Lighthouse 自動検査

Pull Request 作成・更新時と `main` への push 時に、本番ビルドに近い状態でサイトを起動し、SEO と Lighthouse を検査します。

| Workflow | ファイル | チェック名 |
| --- | --- | --- |
| SEO Audit | [`.github/workflows/seo-audit.yml`](../.github/workflows/seo-audit.yml) | SEO Audit |
| Lighthouse Audit | [`.github/workflows/lighthouse-audit.yml`](../.github/workflows/lighthouse-audit.yml) | Lighthouse Audit |

既存の `CI` / `Deploy` ワークフローとは独立しており、lint・テスト・デプロイを置き換えません。

## ローカル実行

1. 本番ビルド(監査用にブログ seed を許可):

```bash
WEB_AUDIT=true BLOG_USE_SEED_DATA=true SITE_URL=http://127.0.0.1:3000 npm run build
```

2. 別ターミナルで production server を起動:

```bash
WEB_AUDIT=true BLOG_USE_SEED_DATA=true SITE_URL=http://127.0.0.1:3000 npm run start -- --hostname 127.0.0.1 --port 3000
```

`WEB_AUDIT=true` は CI / ローカル監査専用です。本番デプロイには付けないでください。効果は次のとおりです。

- `BLOG_USE_SEED_DATA=true` と併用すると、production 起動でもブログ seed が有効になり、microCMS 無しで `/sitemap.xml` を検証できる
- CSP の `upgrade-insecure-requests` を、ループバック Host(`127.0.0.1` / `localhost` / `::1`)へのリクエストでのみ外し、ローカル HTTP 上の Lighthouse が HTTPS interstitial で落ちないようにする(本番 Host では `WEB_AUDIT` が付いていても外さない)

Lighthouse の `is-on-https` / `redirects-http` もローカル HTTP 計測向けに assertion から除外しています(本番は Cloudflare 終端の HTTPS)。

3. 検査:

```bash
SITE_URL=http://127.0.0.1:3000 npm run audit:seo
SITE_URL=http://127.0.0.1:3000 npm run audit:lighthouse
# まとめて
SITE_URL=http://127.0.0.1:3000 npm run audit:web
```

レポートは `.web-audit/` に出力されます(gitignore 済み)。

## 対象ページ

`config/web-audit.json` の `pages` が SEO / Lighthouse 共通の対象です。初期値:

- `/`
- `/about`
- `/pricing`
- `/lp/secure-file-sharing`

追加・削除はこの配列を編集します。一時的に上書きする場合:

```bash
SEO_AUDIT_PAGES=/,/about npm run audit:seo
LIGHTHOUSE_PAGES=/ npm run audit:lighthouse
```

`/mypage` は意図的に `noindex` のため対象外です。

## SEO で見ている項目

スクリプト: [`scripts/seo-audit.mjs`](../scripts/seo-audit.mjs)

- HTML / metadata: title, description, canonical, `html lang`, viewport, robots(予期しない noindex), OGP 基本4項目, Twitter Card
- heading: h1 の有無・複数、見出しレベルの飛び(WARN)
- images: `alt` 属性欠落
- links: 内部リンク切れ(FAIL)、外部リンク HTTP エラー(既定は WARN、CI 全体は落とさない)
- `/robots.txt` / `/sitemap.xml` の取得、XML、URL 形式、sitemap 内 URL のサンプルアクセス
- JSON-LD: 存在する場合のみ JSON / `@context` / `@type`

結果は GitHub Actions の Job Summary と Artifact `seo-audit-report` に出ます。

## Lighthouse

- 設定: [`lighthouserc.cjs`](../lighthouserc.cjs) + [`config/web-audit.json`](../config/web-audit.json)
- ラッパー: [`scripts/lighthouse-audit.mjs`](../scripts/lighthouse-audit.mjs)
- カテゴリ: Performance / Accessibility / Best Practices / SEO
- 各 URL を複数回計測し、median で閾値判定(`assertionMethod: median`)

### 閾値

| カテゴリ | CI フロア(現状) | 将来の目標 |
| --- | ---: | ---: |
| Performance | `config/web-audit.json` → `lighthouse.thresholds.performance` | `targetThresholds.performance` (0.80) |
| Accessibility | 同上 | 0.90 |
| Best Practices | 同上 | 0.90 |
| SEO | 同上 | 0.90 |

変更箇所は常に `config/web-audit.json` です。ローカル実測(2026-10)では全対象ページが Performance 90 台後半だったため、CI フロアも目標どおり 0.80 に揃えています。環境差で揺れる場合は `thresholds.performance` だけ下げ、`targetThresholds` に 0.80 を残してください。

### スコア低下(回帰)

`config/lighthouse-baseline.json` にページごとの中央値(0–1)を入れると、前回からの大幅悪化も検知します。

- Performance: 10 ポイント超の悪化で FAIL
- その他: 5 ポイント超の悪化で FAIL

初期状態は `pages: {}`(固定閾値のみ)です。ローカル実測値をそのまま入れると Actions runner で Performance が下振れしてフレークしやすいので、GitHub Actions 上の緑ランの Artifact(`lighthouse-summary.json` の `medians`)から転記してください。

### Artifact

Workflow 失敗時も `lighthouse-audit-report` Artifact に HTML/JSON レポートと Summary が残ります。PR の Checks → 該当 run → Artifacts から確認できます。

## GitHub Actions 上の実行条件

- `pull_request`: opened / synchronize / reopened
- `push` to `main`

権限は `contents: read` のみです。`pull_request_target` は使いません。Secrets も参照しません。

## 関連

- 簡易なトップページ合成計測(既存): `npm run measure:home`([`scripts/measure-home.mjs`](../scripts/measure-home.mjs))
