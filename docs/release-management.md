# ステージング検証と承認付きリリース

同じmainコミットのステージング検証に成功したうえで、人間がコミットSHAを指定し、GitHub Environmentで別の承認者が承認してから、本番を更新する。今回の作業ではリソースの作成、GitHub/Cloudflareの設定変更、デプロイ、リモートのデータ操作は行っていない。設定例は未設定のままではリリースできない。

## 現在の3 Workerと既存の成果物管理を使う

| 役割 | 本番 | ステージング | 接続先 |
| --- | --- | --- | --- |
| Hono APP | `anzdrop` | `anzdrop-staging` | それぞれのD1・R2 |
| Astro PUBLIC | `anzdrop-public` | `anzdrop-public-staging` | 同環境のAPP。DB・R2・アプリSecretなし |
| 入口ルーター | `anzdrop-router` | `anzdrop-router-staging` | 同環境のAPP・PUBLIC |
| D1 | `anzdrop-db` | `anzdrop-staging-db` | 独立したdatabase ID |
| R2 | `anzdrop` | `anzdrop-staging` | 独立したバケット |
| 公開経路 | `https://anzdrop.com` | `https://staging.<zone>` | ルーターだけがRouteを持つ |

本番の元のWrangler設定ファイルのリソースID・Route・Service Bindingは変更していない。ステージング設定は `scripts/prepare-staging-config.mjs` で `tmp/staging-config` に生成し、成果物には同環境の設定を収める。本番値を含む設定全体を継承せず、APPは必要な項目だけを組み立てる。将来の未確認Bindingや変数は検証で拒否する。

API・Astro・ルーターを決定論的なtarにまとめ、SHA-256とGitHub Artifact Attestationを付ける既存方式を維持する。今回、適用するマイグレーションSQLもtarへ含め、本番では再ビルドせず同じrunの署名済み成果物を取得・検証して配信する。ステージングと本番はURL・公開キー・Bindingが異なるため別のtarだが、同一コミット・lockfileのソースを使う。環境差分を含めたバイト単位の同一成果物昇格ではない。

調査時の問題は、main更新から本番のD1変更・デプロイまで承認なしで進むこと、ステージングがリポジトリに定義されていないこと、3 Workerの途中失敗時に成功manifestが残らないこと、本番向けの既存E2Eに書込みを伴うテストが含まれることだった。新しいフローでは本番の自動リリースを止め、事前のVersion記録と部分完了の記録を保存し、本番の自動スモークを読取り専用にした。

## 実リソースの準備は人間が行う

`config/staging.example.json` をコピーし、実際に作成した非本番リソースのIDと専用ホストを設定する。設定値は秘密ではないが、今回は実リソースを作成せず、例のプレースホルダーを残している。

必要な作業は次のとおり。

1. ステージング用の3 Worker、D1、R2、ルーターの専用Routeを準備する。可能ならCloudflareアカウントも本番と分ける。同じアカウントでもD1・R2・Worker名は分離する。
2. 専用ホスト全体をCloudflare Accessで保護する。管理者向けのaudienceは本番と別にする。APP・PUBLICのworkers.devとVersion URLは公開しない。preflightは資格情報なしのトップ・APIアクセスが設定済みAccessチームのログインへリダイレクトされることも確認する。Service Authのみで401を返す設定はこの検証を通らないため、利用者のログインポリシーと専用サービストークンの許可を併用する。Access/WAF/DNS設定全体をWorkerデプロイが作成・検証するわけではないため、初回リリース前に人間が確認する。
3. APPの必須Secretを個別に設定する。空の既存Workerを作り、Secretと初期Versionを用意する初回bootstrapは通常リリースと分けて承認・実施する。PUBLIC・ルーターにはアプリSecretを設定しない。
4. ステージング全体にAccessを適用したことを確認して、Turnstileの公式テスト用サイトキーとSecretを設定する。Accessサービストークンはステージング専用とし、本番Accessアプリを許可対象にしない。
5. GitHubに `staging` と `production` Environmentsを作成する。どちらも対象ブランチをmainに制限する。productionにはRequired reviewers、自己承認禁止、管理者の保護ルール回避禁止を設定する。設定を確認できない場合は本番preflightを失敗させる。
6. ステージング設定・Secret・アクセス経路をレビューした後、リポジトリ変数 `STAGING_RELEASE_ENABLED=true` でステージングの自動更新を有効にする。今回はこの変数も設定していない。

Workers作成・実行、D1・R2容量、Actions/Artifacts等には契約による利用料が発生し得る。作成や有料プランの変更は、権限と費用を確認してから人間が行う。

### 環境ごとにSecretと公開設定を分ける

| 場所 | 名前 | 内容 |
| --- | --- | --- |
| GitHub staging変数 | `STAGING_PLAN_JSON` | 設定例を実ID・専用Originに置き換えたJSON |
| GitHub staging変数 | `TURNSTILE_SITE_KEY` | Access保護済みステージング用のテストサイトキー |
| GitHub staging Secret | `CLOUDFLARE_API_TOKEN` | 非本番の対象アカウント専用トークン |
| GitHub staging Secret | `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | ステージング全体を検証する専用サービストークン |
| Cloudflare staging APP Secret | `TURNSTILE_SECRET_KEY` | ステージングのサイトキーに対応するテストSecret |
| Cloudflare staging APP Secret | `SESSION_SECRET` / `ACCOUNT_AUTH_ENCRYPTION_KEY` | 本番と異なる新しい鍵。形式は既存のaccounts/deployment文書に従う |
| GitHub production Secret | `CLOUDFLARE_API_TOKEN` | 本番アカウント用。リポジトリ共通SecretからEnvironmentへ移す |
| GitHub production Secret（必要時） | `ENVIRONMENT_READ_TOKEN` | GITHUB_TOKENでEnvironment保護設定を参照できない場合のみ。対象repoのEnvironments読取り権限だけを付けたトークン |
| GitHub既存の公開ビルド値 | `TURNSTILE_SITE_KEY` / `STRIPE_PUBLISHABLE_KEY` | 本番の公開キー。アプリSecretとは別物。staging jobはproductionの公開キーを使わない |

CloudflareのpreflightはSecretの**名前の一覧だけ**を確認し、値を取得しない。鍵の形式、ステージングと本番で値が異なること、外部サービスのモードまでは判定できないため、人間が初回設定時に確認する。

Cloudflare APIトークンは、Workersのデプロイ・Deployment/Secretメタデータ参照、D1の対象DBへのマイグレーション、R2バケット情報参照、既存Routeの配信に必要な権限だけにする。R2オブジェクトの読書き資格情報、DNSやAccess管理、アカウント管理の権限は通常リリースに与えない。Workersの権限は必ずしもWorker名単位に細分化できないため、Environmentの分離だけでトークンの権限範囲が狭まるとは扱わない。別アカウントと対象zone/DBへのスコープを優先し、実アカウントで必要権限を確認する。

初期ステージングではR2直アップロードと課金を無効にし、対応する資格情報がある場合はpreflightを停止する。ファイル共有は既存proxy経路で検証する。Stripe/OpenNodeのテストモード、microCMS、メール、直アップロードの検証は別途のsandbox資格情報と設定レビューが必要。これらまで本番と同等に検証済みとは扱わない。

## PRから本番までのフロー

PR/merge queueは既存CIでLint・TypeScript・Astro・Vitest・ローカルE2Eを実行する。ファイル共有は既存の3ブラウザーworkflowを維持する。PRではCloudflareリリース用トークンを渡さず、`pull_request_target` やPR成果物を特権jobへ引き渡す方式も使わない。

main更新では `deploy.yml` がテスト、隔離したChromium共有E2E、本番用ビルドと署名を行う。ステージングが有効な場合は同じSHAを非本番設定でビルドし、分離設定・実D1/R2の識別情報・Secret名を読取り確認する。初期Versionの組をマイグレーション前に記録し、ステージングのマイグレーション・APP→PUBLIC→ルーターのデプロイ・読取りスモーク・合成ファイルのアップロード／共有URL／復号ダウンロード検証を行う。

**mainへのpushだけでは、本番マイグレーションも本番デプロイも実行しない。** 本番リリースには、GitHub Actionsの「Deploy to Cloudflare Workers」をmainで手動実行し、`production_commit_sha` に対象mainの完全なコミットSHAを入力する。同じrunでもう一度テスト・ステージング検証を行い、その成功後にproduction Environmentの承認者が成果物とステージング結果を確認して承認する。SHA不一致、ステージング未設定・失敗、承認保護未設定、事前検証失敗では本番へ進まない。

production jobは同じrunの本番用tarをダウンロードし、署名のworkflow・SHA・refとハッシュを確認する。Bindingと既存リソース、必須Secret、Environment保護を確認してから、成果物に含むSQLを適用し、既存の順序で3 Workerを配信する。配信前のVersion組と比較して、外部操作でVersionが変わっていたら停止する。

全jobを同じ `production-deploy` concurrencyで直列化し、途中のリリースをキャンセルしない。ただし、ダッシュボードや別workflowでの操作まではロックしない。リリースと復旧中は外部の更新を止める。

## スモークテストは対象と副作用を制限する

`scripts/release-smoke.mjs` はHTML、参照先のAstroアセット、未認証のaccount API、内部経路の非公開を確認する。設定されたHTTPS OriginだけへGETし、リダイレクトを追わない。本番ではこの読取り専用検証だけを自動実行する。

`tests/e2e/release-staging.spec.ts` は、検証済みplanとOriginが一致するステージング、または既存の使い捨てローカル環境だけで小さな合成ファイルを送信する。Accessヘッダーは同じOriginだけに付け、第三者へのリクエストには付けない。トークンがtraceに残らないよう記録を無効にし、Service Workerを止めて小さなファイルの通常保存経路を検証する。1日保持の合成データがステージングに残るため、容量を監視し、必要に応じて対象をドライラン確認して人間が片付ける。ステージングのCronは今回有効にしない。新たな自動削除を有効化する際は承認が必要。

ローカルでの再現例を以下に示す。

```sh
node scripts/prepare-staging-config.mjs --template
npx vitest run tests/scripts/release-safety.test.ts tests/scripts/release-smoke.test.ts tests/scripts/release-workflow.test.ts
E2E_RELEASE_STAGING=1 E2E_TEST_FILES=tests/e2e/release-staging.spec.ts E2E_WORKERS=1 npm run test:astro-hono
bash scripts/prepare-auditable-deployment.sh
```

`--template` はローカルの設定生成にだけ使える。リリース用ビルド・preflight・デプロイはプレースホルダーを受け付けない。ビルドコマンドはdry-runで、リモートのマイグレーションやデプロイを行わない。

## 割合配信は今回有効にしない

Versions & Deploymentsには新Versionのアップロード、無トラフィックの保存、割合指定の配信がある。ただし、3 Workerを別々に5→25→50→100%に進めると、APP・PUBLIC・ルーターの新旧組合せと、複数リクエストにまたがる共有処理が増える。CloudflareもService Binding間のversion skewを説明している。AstroではHTMLとハッシュ付きアセットを別リクエストで取得する点にも注意が必要。

今回は独立ステージングでの検証と、承認後に同じソースの3 Workerを各100%へ順次更新する方式を採る。Workerのコードとアセットは同じVersionで管理するが、古いHTMLを開いたブラウザーから旧アセットが要求される問題までは解消しない。HTMLの既存no-storeを維持し、リリースをまたいで開きっぱなしのタブも確認する。

将来の割合配信には、APIの新旧互換性、version affinity/overrides、旧アセット保持、Version別のエラー率・共有成功率、昇格／中止の観測時間を設計する必要がある。現時点では十分な実トラフィックと判定指標を測っていないため、5%等を安全な閾値と決めない。Version URLも本番Bindingへ接続する可能性があり、独立ステージングの代用にしない。

## 復旧は明示した安定Versionへ戻す

自動ロールバックは追加していない。D1/R2を含む処理の途中失敗時に、コードだけを自動で戻すことが安全とは限らないためである。

1. 進行中のリリースと外部更新を止める。失敗jobの `deployment-manifest-<runId>-<attempt>` から `pre-release-deployments.json`、`partial-deployment-records.json` を取得する。ステージングは `staging-release-...`。事前記録はマイグレーション前の稼働Versionであり、安定稼働の保証ではない。過去の成功manifestと監視結果で戻し先を選ぶ。
2. 成功manifestを使う場合は、対応するbuild artifactのAttestation・SHA・commitを既存の手順で照合する。途中失敗の記録は信頼したActions runから取得し、CloudflareのDeployment一覧と照合する。各WorkerのVersion IDを「最新」から推測しない。
3. 現在のD1スキーマ・R2の状態・Secret・Bindingに旧コードが対応できるか確認する。schema変更がある場合は下記の互換性方針で判断する。
4. 次の読取り専用plannerで、対象環境・アカウント・3 Worker・Version IDを確認し、復旧コマンドを生成する。割合配信の複数Versionは自動で選ばずエラーにする。旧形式の本番成功manifestもmain・本番URLを確認して受け付ける。

   ```sh
   node scripts/rollback-plan.mjs trusted-pre-release-deployments.json production
   # または、確認済みの成功deployment-manifest.jsonを入力する
   ```

5. 人間が承認した後、plannerが出した `wrangler rollback <VERSION_ID> --name <WORKER> --config <CONFIG>` を1 Workerずつ実行する。原則はルーター→PUBLIC→APPの逆順だが、障害箇所とAPI互換性に応じて判断する。単独Workerだけを戻す場合も同じ確認が必要。リリースworkflowのconcurrencyは手動CLIを止めないため、同時実行を避ける。
6. 各段階のDeployment一覧と、最後に読取りスモークを確認する。ファイル共有の書込み検証はまずステージングで行う。本番の既存利用者ファイルをテスト用に変更しない。復旧の対象Version・時刻・承認者・検証結果を運用記録へ残す。
7. ロールバック失敗時は後続操作を止め、存在しないBindingや互換性不足を確認する。D1復元やR2削除を試行錯誤で実施しない。コードの前方修正が可能か判断し、データ復旧は別途の承認付き作業に分ける。

Workersのロールバックはデータ・外部リソース・Cron/Route等のWorker外設定を復元するものではない。Cloudflareが保持するVersion数にも制限があり、90日のActions成果物保存と同じ保証ではない。復旧対象が利用可能かを定期的に確認する。権限は対象アカウントのWorkers更新と履歴参照を基本とし、通常のコード復旧にD1復元・R2削除権限を付けない。

### D1は旧コードと共存できる順序で移行する

まず追加のテーブル・nullable列・索引等を用意し、旧コードも動く状態で新コードへ切り替える。列名変更や削除、意味の変更は同時リリースで行わず、新旧両方に対応する期間を置いてから、復旧可能期間を過ぎた別リリースで整理する。新しい種類のユーザー情報を保存する場合は、従来どおり実装前の明示承認が必要。

自動的なdown migrationは用意しない。マイグレーションが途中まで適用された場合も、適用履歴と現在のschemaを読み取り確認し、旧Versionとの互換性を評価してから再実行または前方修正する。D1の復元やR2の復旧は、アップロード実体・files・uploadsの整合性や復元後の欠落を伴うため、Worker rollbackとは別の承認・手順・復旧時点の判断が必要。

## ローカル検証結果（2026-10-30）

- Vitest: 165ファイル、1,672テスト成功。設定の誤接続、承認条件、preflightの障害、デプロイ成功後の履歴取得失敗とVersion ID保持を検証した。Cloudflare/GitHub APIはモックを使用した。
- 隔離したAstro/HonoのPlaywright: 7テスト成功、既存の拡張ケース16件は通常設定によりスキップ。暗号化アップロード・共有URL・ダウンロードの一致と、Access認証情報をリダイレクト先へ送らないことを確認した。
- 本番・ステージングの成果物生成はWranglerのdry-runで成功。生成したBindingの検証も成功した。
- ESLint、TypeScript、ルーターの型チェック、Astroチェックも成功。Astroは40ファイルでエラー・警告ともに0件だった。
- 独立した検証エージェントがレビューし、指摘されたリダイレクト時の認証情報漏洩を修正・再検証した。未解消の重大な指摘はない。

ステージングのブラウザーテストは認証情報の転送を防ぐため同一originを含めてリダイレクトを拒否する。

## 適用前に残る確認

GitHub上のworkflow実行、Environment承認、Cloudflareの実リソース照合、Access/WAF、実ステージングでの共有、実際のrollbackは未実施。ローカル検証に成功しても、この接続確認が完了したことにはならない。初回は非本番でリリース途中の失敗・復旧の演習を行い、承認者、監視指標、当番連絡、停止判断を決めてから本番運用に移す。

参照した一次資料は次のとおり。

- [Cloudflare gradual deployments](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/)
- [Cloudflare rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [GitHub deployment protection rules](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
