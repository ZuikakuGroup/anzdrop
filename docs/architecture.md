# アーキテクチャ

## 全体構成

Anzdropは Next.js (App Router) を [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare) でCloudflare Workers上にデプロイして動かしています。フロントエンド(React)とAPI Routes(`app/api/**/route.ts`)が同じWorker上で動作し、状態は以下のCloudflareリソースに保存されます。

```
ブラウザ (E2EE暗号化/復号はすべてここで行う)
   │
   ▼
Cloudflare Workers (Next.js / @opennextjs/cloudflare)
   ├─ D1 (anzdrop-db)      … 共有・ファイル・アップロードセッション・通報のメタデータ
   ├─ R2 (anzdrop バケット) … 暗号化済みファイル本体
   └─ Cron Trigger (6時間ごと) … 期限切れ共有・放置されたアップロードセッションの掃除
```

エントリーポイントは [`custom-worker.ts`](../custom-worker.ts) で、OpenNextが生成する`fetch`ハンドラをそのまま使いつつ、`scheduled`ハンドラだけ追加してCronでの掃除処理([`lib/cleanup.ts`](../lib/cleanup.ts))を呼び出しています。

## Cloudflareバインディング

[`wrangler.jsonc`](../wrangler.jsonc) で定義されているバインディング(型定義は `worker-configuration.d.ts` に `wrangler types` で自動生成):

| バインディング | 種類 | 用途 |
| --- | --- | --- |
| `DB` | D1 Database | `shares` / `uploads` / `upload_parts` / `files` / `reports` / `accounts` / `btc_payments` / `stripe_events` テーブル |
| `FILES_BUCKET` | R2 Bucket | 暗号化済みファイル本体(マルチパートアップロード) |
| `FILE_RATE_LIMITER` / `SHARE_RATE_LIMITER` / `UPLOAD_RATE_LIMITER` / `ACCOUNT_RATE_LIMITER` | Rate Limiting | アプリ層のレート制限(下記「レート制限」参照) |
| `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` | 環境変数 | 管理画面(`/admin`, `/api/admin/*`)のCloudflare Access JWT検証用 |
| `TURNSTILE_SECRET_KEY` | シークレット | アップロード開始・アカウント関連APIのTurnstile検証用 |
| `SESSION_SECRET` / `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `OPENNODE_API_KEY` | シークレット | アカウントセッション・有料プラン決済([`accounts.md`](./accounts.md)参照) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ビルド時埋め込み | Stripe.js / Payment Element の初期化に使う公開可能キー(GitHub Secrets の `STRIPE_PUBLISHABLE_KEY` から埋め込み) |
| `STRIPE_PRICE_ID_STANDARD` / `STRIPE_PRICE_ID_PREMIUM` / `OPENNODE_BTC_CHARGE_AMOUNT_USD_STANDARD` / `OPENNODE_BTC_CHARGE_AMOUNT_USD_PREMIUM` / `OPENNODE_BTC_DAYS_PER_CHARGE` | 環境変数 | 有料プランの価格・期間設定([`deployment.md`](./deployment.md)参照)。`*_STANDARD` は提供準備中のStandard用で、現状の購入導線ではPremiumのみ使用する |

## 主要な画面とAPI

| パス | 役割 |
| --- | --- |
| `/`(`app/page.tsx`) | アップロード画面(`components/upload/uploadForm.tsx`) |
| `/d/[shareId]`(`app/d/[shareId]/page.tsx`) | ダウンロード画面(`components/download/DownloadPage.tsx`) |
| `/report`(`app/report/page.tsx`) | 一般向け通報フォーム |
| `/report/rights`(`app/report/rights/page.tsx`) | 権利者向け申し立てフォーム |
| `/admin`(`app/admin/page.tsx`) | 通報管理画面(要Cloudflare Access認証) |
| `/mypage/signup`・`/mypage/login`・`/mypage/recover` | アカウント作成・ログイン・パスワード再設定([`accounts.md`](./accounts.md)) |
| `/mypage`(`app/mypage/page.tsx`) | マイページ。現在のプラン・契約状態(自動更新中/解約予約中/有効期限/無料)・プラン内容・パスワード再設定の注意書き([`accounts.md`](./accounts.md))。ログイン後の着地先 |
| `/mypage/billing`(`app/mypage/billing/page.tsx`) | Stripe/Bitcoin決済導線・カード契約の解約/再開。購入できるのは現状Premiumのみ(Standardは提供準備中。`components/billing/BillingPage.tsx`の`PURCHASABLE_PLANS`) |
| `/pricing`(`app/pricing/page.tsx`) | プラン比較(Free・Standard・Premium)の紹介ページ。Standardは提供準備中で「準備中」表示のみ(実装はIssue #5でトラッキング) |
| `/about`(`app/about/page.tsx`) | サービス紹介ページ(理念・非営利であること、E2E暗号化の仕組み、OSSであること、よくある質問) |
| `/contact`(`app/contact/page.tsx`) | 一般向けお問い合わせフォーム(`components/contact/ContactForm.tsx`)。共通ヘッダー・フッターから遷移 |
| `/legal/terms`・`/legal/privacy`・`/legal/tokushoho` | 利用規約・プライバシーポリシー・特定商取引法に基づく表記([`legal.md`](./legal.md)) |

API側の詳細は [`api.md`](./api.md) を参照。

## フロントエンドのロジック配置

`components/upload/uploadForm.tsx`・`components/download/DownloadPage.tsx`・`components/admin/AdminReportsPage.tsx`は、UIの状態管理・JSX以外の非UIロジック(暗号化呼び出し・ネットワーク呼び出し・純粋な整形関数など)を対応する`lib/`配下に切り出しており、`lib/`側は個別にVitestテストを持つ(`tests/lib/upload/`・`tests/lib/download/`・`tests/lib/admin/`)。

- [`lib/upload/chunkUploader.ts`](../lib/upload/chunkUploader.ts): チャンクの並列アップロードワーカー(`uploadChunksFromStream`)。各パートは一時エラー(通信断・408・425・429・500・502・503・504・Cloudflare の 520-524)時に指数バックオフ付きで数回リトライする(`/api/upload/chunk` は同じパート番号の再送に冪等。GitHub issue #65)。
- [`lib/upload/uploadFile.ts`](../lib/upload/uploadFile.ts): 1 ファイル分の「start → チャンク送信 → complete」を通しで実行する `uploadEncryptedFile`。暗号化チャンクストリームは受け取らず、「その場で新規生成するファクトリ」を受け取る。失敗時は呼び出し側がそのまま再試行でき、再試行のたびに必ずファイル先頭からの新しいストリームで送り直す(途中まで消費したストリームを使い回すとサイレント破損する。GitHub issue #58)。
- [`lib/upload/dragDropFiles.ts`](../lib/upload/dragDropFiles.ts): ドラッグ&ドロップされたフォルダの再帰展開(`collectDataTransferFiles`)。
- [`lib/upload/encrypt.ts`](../lib/upload/encrypt.ts): ファイル名の暗号化・パスワードによる鍵のラップ(`encryptFileName`/`wrapKeyWithPassword`)。`lib/crypto/`の暗号プリミティブを組み合わせたアップロード固有の処理。
- [`lib/download/decrypt.ts`](../lib/download/decrypt.ts): ファイル名・ファイル一覧の復号、パスワードによる鍵のアンラップ、ファイル本体の取得+復号。復号済み平文を流す`ReadableStream`を返す`fetchDecryptedStream`と、それを丸ごとメモリに集める`fetchAndDecrypt`(プレビュー・ZIP一括ダウンロード用)。回数を数えないファイルは暗号文の取得を`parallelFetch.ts`へ委ね、消費側が現在のチャンクを処理する間に次のチャンクの復号を1段先読みする。
- [`lib/download/parallelFetch.ts`](../lib/download/parallelFetch.ts): 暗号化済みファイル本体を複数のHTTP `Range` リクエストで並列取得し、順番どおりの1本の`ReadableStream`として返す`createParallelCiphertextStream`。各リクエスト(先頭のプローブ含む)は一時エラー時に指数バックオフ付きで数回リトライし、buffered+in-flightのウィンドウ数を並列数+余裕に制限してメモリを抑える(消費が遅ければ新しい取得を止めてバックプレッシャーをかける)。先頭リクエストにサーバーが`Range`を無視して200を返した場合はその本体を単一ストリームとしてそのまま返すが、2本目以降で206以外が返った場合は(全体本体をウィンドウ位置へ混ぜて壊さないよう)そのダウンロードを失敗させ、呼び出し側の再試行に委ねる。
- [`lib/download/saveFile.ts`](../lib/download/saveFile.ts): 復号済みファイルの保存(`saveDecryptedFile`)。保存経路は環境に応じて (1) `showSaveFilePicker`(Chromium系)で保存先を選ばせてディスクへ逐次書き込み、(2) Service Worker 経由のストリーミング(Firefox/Safari。`streamDownloadSaver.ts`)、(3) Blob フォールバック(`triggerBlobDownload`。最後の手段)。(1)(2)はファイル全体をメモリに載せない。フォルダへ複数ファイルを一括保存する `saveDecryptedFilesToDirectory` も。
- [`lib/download/streamDownloadSaver.ts`](../lib/download/streamDownloadSaver.ts): `showSaveFilePicker` が使えないブラウザ向けの Service Worker(`public/download-sw.js`)登録と、復号済みストリームを Service Worker へ転送して `Content-Disposition: attachment` の Response としてダウンロードさせる `saveViaServiceWorker`(GitHub issue #61)。transferable stream 非対応の古いブラウザや Service Worker がまだページを制御していない場合は使わない(Blob フォールバックへ)。
- [`lib/download/errors.ts`](../lib/download/errors.ts): ユーザーに表示してよい文言だけを持つ`FriendlyError`/`FileGoneError`と、それ以外の例外を汎用メッセージへ丸める`toFriendlyMessage`。
- [`lib/download/zipDownload.ts`](../lib/download/zipDownload.ts): 一括ダウンロードのZIP生成。`streamFilesAsZip`(fflateの`Zip`をstoreモードで使い、各ファイルの平文ストリームを順にディスクへ流す。1ファイル分もZIP全体もメモリに載せない)と、環境非対応時のフォールバック用の非ストリーミング`zipFiles`。`canStreamFilesAsZip`はfflateがzip64非対応のため、単体/合計とも約4GiB(`0xFFFFFFFF` = 2³²−1 バイト)以内かを判定する。重複ファイル名の連番付与も。
- [`lib/download/downloadAll.ts`](../lib/download/downloadAll.ts): 「全てダウンロード」の経路選択(`downloadAllFiles`)。`showSaveFilePicker` ありならディスクへストリーミングZIP、`showSaveFilePicker` なし + Service Worker 可なら SW 経由でストリーミングZIP(issue #61)、約4GiB(`0xFFFFFFFF`)を超えて zip64 が必要ならフォルダを選んで1ファイルずつ保存、いずれも不可なら合計サイズ上限(512MiB)つきのメモリ内ZIP。
- [`lib/admin/reportLabels.ts`](../lib/admin/reportLabels.ts): 通報カテゴリ・権利種別・共有状態・日時の表示用ラベル整形(純粋関数)。
- [`lib/admin/reportsApi.ts`](../lib/admin/reportsApi.ts): 通報管理画面が呼ぶ`/api/admin/**`へのfetch呼び出し(取得・対応済み化・共有削除・一時停止切替・通報削除)。

## アップロードの流れ

1. ブラウザでファイルを8MiB単位に分割し、チャンクごとにAES-256-GCMで暗号化(鍵生成・暗号化の詳細は [`crypto.md`](./crypto.md))。ファイル本体の暗号化は「アップロードする」を押したあと、`upload()` がそのファイルを処理する直前に開始する。先読みバッファ(最大64MiB)が同時に走るのは常に1ファイル分だけで、数十〜数百ファイルのフォルダを追加してもメモリが `64MiB × ファイル数` にならない(GitHub issue #60)。
2. `POST /api/upload/start` で共有(または既存共有への相乗り)とマルチパートアップロードセッションを作成。新規共有作成時のみTurnstile検証が必須。`encryptedFileName`・`wrappedKey`・`keySalt` はヘッダに載せても安全な文字集合(`A-Za-z0-9._-`)と最大長で検証する。
3. 暗号化ストリームを `UPLOAD_PART_SIZE`(8MiB)ごとに切り出し、`POST /api/upload/chunk` でR2のマルチパートアップロードにパートとして送信(パケット境界とは独立。R2の「最終パート以外は同一サイズ」制約に対応するため。GitHub issue #34)。
4. 全パート送信後 `POST /api/upload/complete` でマルチパートアップロードを完了し、`files` テーブルにレコードを作成。`start`・`chunk` と同じく `uploadToken` の一致で認可し、`start` より後に共有が期限切れ/一時停止された場合は完了させない。
5. アップロード完了後のURLは `https://.../d/{shareId}#{復号鍵(base64url)}` の形。フラグメント(`#`以降)はブラウザからサーバーへ送信されないため、サーバー側のログ・アクセス解析等にも復号鍵は一切残りません。

各パートの送信は一時エラー(通信断・408・425・429・500・502・503・504・Cloudflare の 520-524)時に指数バックオフ付きで最大 6 回・合計 ~15.5 秒までリトライする(`/api/upload/chunk` は同じパート番号の再送に冪等。GitHub issue #65)。

これを超える通信断でアップロードが失敗しても、「アップロードする」を押し直すだけで再試行できる。まだ `complete` まで到達していないファイルだけを対象に、暗号化パイプラインを作り直して `start` からやり直す(部分的に消費されたストリームを持ち越さないため、リトライでファイルがサイレント破損することはない。GitHub issue #58)。既に完了したファイルや、作成済み共有のパスワード保護の有無は再試行をまたいで保持される。1 回目で失敗した `start` 済みのセッションは掃除(Cleanup)で回収される。なお押し直しでの再試行は毎回ファイルの先頭から送り直す(送信済みパートだけをスキップする本格的な「再開」は、パケットの IV がパートごとに乱数で、パケット境界とパート境界が一致しないため暗号化フォーマットの再設計が必要。別 issue)。

複数ファイルを1つの共有にまとめる場合、2回目以降のファイルは同じ `shareId` へ「相乗り」します。`shareId`自体はURLに露出する公開識別子のため所有権の証明には使えず、代わりにサーバー生成の `uploadToken`(クライアントのメモリ上にのみ存在)の一致で認可します([`lib/share-auth.ts`](../lib/share-auth.ts))。

## ダウンロードの流れ

1. `GET /api/download/[shareId]` で共有の有効期限・ファイル一覧(暗号化済みファイル名・サイズ)・パスワード保護の有無(`wrappedKey`/`keySalt` の有無)を取得。
2. パスワード保護がない場合はURLフラグメントから直接鍵をインポートしてファイル名を復号。パスワード保護がある場合はユーザー入力のパスワードから鍵を導出し、ラップされた鍵をアンラップしてから同様に復号(詳細は [`crypto.md`](./crypto.md))。
3. ファイル本体は `GET /api/file/[fileId]` からダウンロードし、受信しながらチャンクごとに復号(`lib/crypto/stream.ts`)。回数を数えないファイルは、暗号文を複数のHTTP `Range` リクエスト(既定8MiBのウィンドウ・6本並列)で並列取得し、順番に連結し直してから復号する(`lib/download/parallelFetch.ts`。単一コネクションの逐次ダウンロードより実効速度が上がる。連結後のバイト列は単一ストリームと同一なので復号側は変更なし)。回数を数えるファイル(保存期間「1回」など)は、サーバー側のダウンロード数カウントを1回に保つため単一の `GET` のまま取得する。復号済み平文の保存経路(`lib/download/saveFile.ts`):
   - `showSaveFilePicker` が使える環境(Chromium 系): ユーザーが選んだ保存先へ逐次書き込み。ファイル全体をメモリに載せない。
   - それ以外で Service Worker が使える環境(Firefox/Safari): 復号済みストリームを Service Worker(`public/download-sw.js`)へ転送し、`Content-Disposition: attachment` の Response としてストリーミングダウンロードさせる(`lib/download/streamDownloadSaver.ts`。GitHub issue #61)。これもファイル全体をメモリに載せない。Service Worker はダウンロードページのマウント時に登録され、初回訪問直後などまだページを制御していない間は次の Blob 経路になる。
   - どちらも使えない場合: Blob に集めてから保存(最後の手段。大容量ファイルではタブが落ちうる)。
   - **「全てダウンロード」**(`lib/download/downloadAll.ts`)は環境に応じて経路を選ぶ。`showSaveFilePicker` が使え ZIP が zip64 不要な範囲(単体・合計とも約 4GiB = `0xFFFFFFFF` バイト以内)なら選んだ `.zip` へストリーミング ZIP を書き出す(`streamFilesAsZip`。1ファイル分も ZIP 全体もメモリに載せない。GitHub issue #59)。`showSaveFilePicker` が無く Service Worker が使えるなら SW 経由でストリーミング ZIP をダウンロード(issue #61)。SW への受け渡しは ZIP 生成(= ファイルの fetch)を始める前に行うため、一過性の不通で失敗しても 1回限りファイルの枠を消費しておらず、下のメモリ内 ZIP へ安全にフォールバックできる。zip64 が必要な(約 4GiB を超える)場合は `showDirectoryPicker` でフォルダを選ばせ1ファイルずつストリーミング保存。いずれも不可なら合計サイズが上限(512MiB)以内でメモリ内 ZIP、超える場合は個別ダウンロードを案内して中断する。
4. ダウンロード回数の上限チェックと加算は1つの原子的な `UPDATE` で行う(同時アクセスでも上限を超えない)。回数を数えるファイル(保存期間「1回」など)は、R2 のボディを `TransformStream` 経由でクライアントへ流し、**実際にクライアントへ届いたバイト数**で後処理を分ける(GitHub issue #62)。
   - 全バイト届いた場合: それが最後の1回だったならR2オブジェクトとDBレコードを削除(`ctx.waitUntil()` で、レスポンスのストリーミングはブロックしない)。「最後のバイト送出直後にクライアントが接続を閉じる」ケースは `pipeTo` が reject するが、届いたバイト数が `object.size` に達していれば完走扱いにする。
   - 全バイト届く前に中断(通信断・タブクローズなど)された場合: このダウンロードは「消費されなかった」とみなし、加算しておいた `download_count` を戻す。これにより「1回」ファイルでも、途中で切れたらもう一度取得し直せる(削除は完走時のみ)。
   - この中断検知は「Cloudflare Workers がクライアント切断時にレスポンスの `ReadableStream` を cancel する」挙動に依存する。**本番相当のプレビュー/本番で「大容量の『1回』ファイルをタブクローズ/通信断 → もう一度取得できる」ことを一度は実機確認すること。** また、中断直後(`ctx.waitUntil` の回数戻しが完了する前のミリ秒オーダー)にクライアントが即座に再取得すると 404(既に上限到達)を踏みうる。人間の再クリックより速い自動リトライ実装がクライアント側に入る場合は、この窓を考慮すること(既知の軽微な制約)。

## 掃除(Cleanup)

[`lib/cleanup.ts`](../lib/cleanup.ts) が以下の2種類の掃除を担当し、`custom-worker.ts` の `scheduled` ハンドラ(6時間ごと、`wrangler.jsonc` の `triggers.crons`)から `runScheduledCleanup()` 経由で呼び出されます。また管理画面からの手動削除(`DELETE /api/admin/shares/[shareId]`)も同じ `deleteShare()` を利用します。

- **期限切れ共有の削除**(`cleanupExpiredShares`): `shares.expires_at` を過ぎた共有をR2オブジェクト・D1レコードごと削除。
- **放置されたアップロードセッションの削除**(`cleanupStaleUploads`): 通信断やタブを閉じるなどで `/api/upload/complete` まで到達しなかったセッションを、共有の有効期限とは無関係に、セッション自体の古さ(24時間)で判定して削除。R2の未完了マルチパートアップロードはabortしないと課金対象のストレージとして残り続けるため、DBレコードの削除前に必ずabortする。

どちらの掃除も、1件の削除失敗(R2/D1の一時エラーなど)でその回の実行全体が止まらないよう、対象を `LIMIT` 付きで少しずつ取得し、1件ずつ `try/catch` して失敗はログに残して次へ進みます(失敗した件数は結果に含めて次回以降の実行に委ねる)。恒久的に失敗する行が1バッチ分たまっても後続の正常な行が掃除されるよう、取得件数は「基準件数 + これまでの失敗数」に広げます。1回の実行あたりのバッチ数にも上限があり、バックログが大きくても Workers のサブリクエスト上限(1呼び出し1000)内で確実に一部を消化します。`runScheduledCleanup()` は2種類の掃除を個別の `try/catch` で囲むため、片方が想定外に失敗しても、もう片方は必ず実行されます。

掃除結果(処理件数・失敗件数・バッチ上限到達)は毎回ログに出し、失敗の持ち越しやバッチ上限到達があった実行は `console.warn` で目立たせます。「期限切れファイルが自動的に消える」というプライバシー上の約束が守られていることを確認できるよう、本番では Cloudflare の Workers Logs / Logpush / Tail Consumer のいずれかで scheduled ハンドラのログを拾える状態にしておくこと。

## レート制限

無認証・無課金で呼べるエンドポイントの連打で、Workers リクエスト・D1 行読み取り・R2 オペレーションといった課金コストが暴走しないようにするための多層防御です(GitHub issue #81)。非営利・コスト回収を前提とした運用のため、「壊さないこと」を最優先に、暴走を頭打ちにすることだけを狙っています。

| 層 | 設定場所 | 数える単位 | 守るもの |
| --- | --- | --- | --- |
| 外側 | Cloudflare WAF の Rate Limiting Rules(ゾーン側のダッシュボード設定。[`deployment.md`](./deployment.md#waf-のレート制限ルール)) | 送信元 IP | 単一 IP からの機械的な連打全般 |
| 内側 | Workers の Rate Limiting バインディング([`lib/rateLimit.ts`](../lib/rateLimit.ts)) | `fileId` / `shareId` / アップロードセッションID / アカウントID | 分散した IP から1つの共有・1つのセッションへ集中する濫用 |

内側の層でキーにするのはアプリ内の識別子だけで、**IP アドレスなどの訪問者情報は一切キーにしません**。Anzdrop 側のコードで訪問者の IP を収集・加工しないという方針([`lib/turnstile.ts`](../lib/turnstile.ts) が siteverify に `remoteip` を送らないのと同じ考え方)を保つためで、IP 単位の判定は Cloudflare 側に任せます。

| バインディング | 適用先 | キー | 閾値の考え方 |
| --- | --- | --- | --- |
| `FILE_RATE_LIMITER` | `GET /api/file/[fileId]` | `fileId` | 1回の論理的なダウンロードが8MiBウィンドウ×並列6本の `Range` リクエストへ分かれる([`lib/download/parallelFetch.ts`](../lib/download/parallelFetch.ts))。3000/60秒 ≒ 3.2Gbps 相当で、1人の利用者では到達しない |
| `SHARE_RATE_LIMITER` | `GET /api/download/[shareId]` | `shareId` | 正当な利用ではダウンロードページを開くたびに1回だけ([`components/download/DownloadPage.tsx`](../components/download/DownloadPage.tsx)。ポーリングもリトライもしない)。ただし1つの共有URLを多人数へ配る使い方があるため、人数ぶんの余裕を大きく取る |
| `UPLOAD_RATE_LIMITER` | `POST /api/upload/chunk` | アップロードセッションID | 最大12並列で8MiBのパートを送る([`lib/plan.ts`](../lib/plan.ts) の `uploadConcurrency`)。キーは1ファイル1セッションなので他人と合算されない |
| `ACCOUNT_RATE_LIMITER` | `POST /api/billing/stripe/sync`・`POST /api/billing/stripe/subscription` | アカウントID | ログイン済みだが回数無制限だと Stripe API のクォータを消費し続けられる(`subscription` は Stripe 側に Customer / Subscription を実際に作る)。正当な利用は請求ページを開いたときの数回 |

実際の閾値は [`wrangler.jsonc`](../wrangler.jsonc) の `ratelimits` にあります(`period` は 10 か 60 のみ指定可能)。

**閾値を決めるときに外してはいけない前提**:

- **カウンタは Cloudflare のロケーション(データセンター)単位**で、ベストエフォート・結果的整合。グローバルな厳密カウンタではないので、実効的な上限は設定値より緩くなる。
- **キーごとに独立して数える**。つまり `shareId` / `fileId` を毎回変える相手(列挙)には何の制約にもならない。列挙の抑止は外側の WAF ルールの役目。
- **同じキーを共有する利用者は合算される**。`fileId` / `shareId` をキーにする以上、同じファイル・同じ共有を同じ地域から同時に使う全員が1つの枠を分け合う。「1人あたりでは到達しない」だけでは不十分で、多人数同時のケースを必ず見積もること。
- **枠を締めすぎると、それ自体が新しい DoS 手段になる**。共有 URL を知る第三者が低速な連打(WAF の IP ルールが反応しない速度)で枠を使い切り、正当な利用者を締め出せてしまう。`SHARE_RATE_LIMITER` の閾値が「1ページロード1回」から見て過剰に緩いのはこのため。

設計上の要点:

- **フェイルオープン**: バインディングが未設定の環境や Cloudflare 側の一時障害では、制限をかけずに通します。レート制限は認証・認可の関門ではなくコストの保険であり、ここで配信やアップロードが丸ごと止まる方が利用者への影響がはるかに大きいためです。
- **できるだけ手前で弾く**: `GET /api/file/[fileId]` は D1 / R2 に触る前、`POST /api/upload/chunk` は8MiBのボディを読み込む前にチェックします。超過したリクエスト自体がコストを発生させないようにするためです。
- **429 で弾いた分は「消費」しない**: 保存期間「1回」のファイルの `download_count` は加算されません。
- **429 は利用者に「一時的だ」と伝える**: ダウンロード画面は429を専用の文言(`lib/download/errors.ts` の `RATE_LIMITED_MESSAGE`)で表示します。汎用の「URLが正しいかご確認のうえ」に丸めると、待てば直る混雑なのに「リンクが壊れている」と読めてしまうためです。
- **ログにキーを残さない**: `fileId` / `shareId` は共有URLの一部なので、エラーログにも含めません。
- **`/api/report`・`/api/contact`・`/api/account/signup` は対象外**: IP を使わずに数える適切な単位が無く(共通キーにすると1人の攻撃者が全員をロックアウトできてしまう)、既に Turnstile で保護されているため、この層では扱わず外側の WAF ルールに任せます。

Turnstile を含む濫用対策全体の位置づけは、アップロードが無認証で公開されている前提([`moderation.md`](./moderation.md))と合わせて読んでください。

## セキュリティレスポンスヘッダ

[`proxy.ts`](../proxy.ts)(Next.js 16 の Proxy。旧 `middleware.ts`)が、静的アセットを除く全レスポンスに以下を付与します。

- **Content-Security-Policy**: nonce ベースの厳格な CSP。`script-src` は `'self' 'nonce-<リクエストごと>' 'strict-dynamic'` を基本とし、`'unsafe-inline'` を許可しません。ダウンロード画面が URL フラグメントの E2E 復号鍵をメモリに保持するため、この origin 上の XSS を多層防御で抑えることが目的です(`'strict-dynamic'` により、nonce 付きスクリプトが読み込む Turnstile / Stripe.js の子スクリプトは追加のホスト許可なしで動きます)。
- **frame-ancestors 'none' / X-Frame-Options: DENY**: クリックジャッキング対策。
- **X-Content-Type-Options: nosniff**: 利用者アップロードのバイト列を配信する `/api/file/[fileId]` を含め、Content-Type の推測を全ルートで禁止。
- **Referrer-Policy: no-referrer** / **Strict-Transport-Security** (`DEPLOYMENT_ENV=production` のみ) / **Permissions-Policy**(カメラ・マイク・位置情報などを無効化、`payment` は Stripe のみ許可)。

nonce はリクエストごとに `proxy.ts` が生成し、Next.js が SSR 時に取り出してフレームワークスクリプト・ページバンドル・`next/script` へ付与します。この仕組みは動的レンダリングを前提とするため、[`app/layout.tsx`](../app/layout.tsx) で `export const dynamic = "force-dynamic"` を宣言し、全ページを動的レンダリングにしています(法務ページなども含めて静的生成・CDN キャッシュは行われません。Workers 上の低トラフィックな用途なので影響は小さいと判断)。

CSP は既定で enforce ですが、環境変数 `CSP_REPORT_ONLY=1` を設定すると `Content-Security-Policy-Report-Only` に切り替わり、違反をブロックせず観測だけできます(新しい外部フローを入れた直後のロールアウトや、OpenNext / Next 更新時の確認用の安全弁)。`proxy.ts` は OpenNext 上では「Node.js middleware」として動き OpenNext 側のサポートは実験的なため、更新時のリグレッション確認が必要です([`deployment.md`](./deployment.md#セキュリティレスポンスヘッダproxyts))。
