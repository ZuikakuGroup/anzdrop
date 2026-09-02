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
   └─ Cron Trigger (毎日0時) … 期限切れ共有・放置されたアップロードセッションの掃除
```

エントリーポイントは [`custom-worker.ts`](../custom-worker.ts) で、OpenNextが生成する`fetch`ハンドラをそのまま使いつつ、`scheduled`ハンドラだけ追加してCronでの掃除処理([`lib/cleanup.ts`](../lib/cleanup.ts))を呼び出しています。

## Cloudflareバインディング

[`wrangler.jsonc`](../wrangler.jsonc) で定義されているバインディング(型定義は `worker-configuration.d.ts` に `wrangler types` で自動生成):

| バインディング | 種類 | 用途 |
| --- | --- | --- |
| `DB` | D1 Database | `shares` / `uploads` / `upload_parts` / `files` / `reports` / `accounts` / `btc_payments` / `stripe_events` テーブル |
| `FILES_BUCKET` | R2 Bucket | 暗号化済みファイル本体(マルチパートアップロード) |
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

- [`lib/upload/chunkUploader.ts`](../lib/upload/chunkUploader.ts): チャンクの並列アップロードワーカー(`uploadChunksFromStream`)。
- [`lib/upload/dragDropFiles.ts`](../lib/upload/dragDropFiles.ts): ドラッグ&ドロップされたフォルダの再帰展開(`collectDataTransferFiles`)。
- [`lib/upload/encrypt.ts`](../lib/upload/encrypt.ts): ファイル名の暗号化・パスワードによる鍵のラップ(`encryptFileName`/`wrapKeyWithPassword`)。`lib/crypto/`の暗号プリミティブを組み合わせたアップロード固有の処理。
- [`lib/download/decrypt.ts`](../lib/download/decrypt.ts): ファイル名・ファイル一覧の復号、パスワードによる鍵のアンラップ、ファイル本体の取得+復号。復号済み平文を流す`ReadableStream`を返す`fetchDecryptedStream`と、それを丸ごとメモリに集める`fetchAndDecrypt`(プレビュー・ZIP一括ダウンロード用)。
- [`lib/download/saveFile.ts`](../lib/download/saveFile.ts): 復号済みファイルの保存(`saveDecryptedFile`)。`showSaveFilePicker`が使える環境(Chromium系)では保存先を選ばせてディスクへ逐次書き込み、ファイル全体をメモリに載せない。それ以外の環境ではBlobフォールバック(`triggerBlobDownload`)。
- [`lib/download/errors.ts`](../lib/download/errors.ts): ユーザーに表示してよい文言だけを持つ`FriendlyError`/`FileGoneError`と、それ以外の例外を汎用メッセージへ丸める`toFriendlyMessage`。
- [`lib/download/zipDownload.ts`](../lib/download/zipDownload.ts): 複数ファイル一括ダウンロード時のZIP圧縮(fflateのラップ)と重複ファイル名の連番付与。
- [`lib/admin/reportLabels.ts`](../lib/admin/reportLabels.ts): 通報カテゴリ・権利種別・共有状態・日時の表示用ラベル整形(純粋関数)。
- [`lib/admin/reportsApi.ts`](../lib/admin/reportsApi.ts): 通報管理画面が呼ぶ`/api/admin/**`へのfetch呼び出し(取得・対応済み化・共有削除・一時停止切替・通報削除)。

## アップロードの流れ

1. ブラウザでファイルを8MiB単位に分割し、チャンクごとにAES-256-GCMで暗号化(鍵生成・暗号化の詳細は [`crypto.md`](./crypto.md))。
2. `POST /api/upload/start` で共有(または既存共有への相乗り)とマルチパートアップロードセッションを作成。新規共有作成時のみTurnstile検証が必須。
3. 暗号化ストリームを `UPLOAD_PART_SIZE`(8MiB)ごとに切り出し、`POST /api/upload/chunk` でR2のマルチパートアップロードにパートとして送信(パケット境界とは独立。R2の「最終パート以外は同一サイズ」制約に対応するため。GitHub issue #34)。
4. 全パート送信後 `POST /api/upload/complete` でマルチパートアップロードを完了し、`files` テーブルにレコードを作成。
5. アップロード完了後のURLは `https://.../d/{shareId}#{復号鍵(base64url)}` の形。フラグメント(`#`以降)はブラウザからサーバーへ送信されないため、サーバー側のログ・アクセス解析等にも復号鍵は一切残りません。

複数ファイルを1つの共有にまとめる場合、2回目以降のファイルは同じ `shareId` へ「相乗り」します。`shareId`自体はURLに露出する公開識別子のため所有権の証明には使えず、代わりにサーバー生成の `uploadToken`(クライアントのメモリ上にのみ存在)の一致で認可します([`lib/share-auth.ts`](../lib/share-auth.ts))。

## ダウンロードの流れ

1. `GET /api/download/[shareId]` で共有の有効期限・ファイル一覧(暗号化済みファイル名・サイズ)・パスワード保護の有無(`wrappedKey`/`keySalt` の有無)を取得。
2. パスワード保護がない場合はURLフラグメントから直接鍵をインポートしてファイル名を復号。パスワード保護がある場合はユーザー入力のパスワードから鍵を導出し、ラップされた鍵をアンラップしてから同様に復号(詳細は [`crypto.md`](./crypto.md))。
3. ファイル本体は `GET /api/file/[fileId]` からストリーミングダウンロードし、受信しながらチャンクごとに復号(`lib/crypto/stream.ts`)。復号済み平文は、`showSaveFilePicker` が使える環境ではユーザーが選んだ保存先へ逐次書き込み、それ以外の環境では Blob に集めてから保存する(`lib/download/saveFile.ts`)。前者ではファイル全体をメモリに保持しないため、大容量ファイルでもメモリ不足になりにくい。
4. ダウンロード回数の上限チェックと加算は1つの原子的な `UPDATE` で行う(同時アクセスでも上限を超えない)。回数を数えるファイル(保存期間「1回」など)は、R2 のボディを `TransformStream` 経由でクライアントへ流し、**実際にクライアントへ届いたバイト数**で後処理を分ける(GitHub issue #62)。
   - 全バイト届いた場合: それが最後の1回だったならR2オブジェクトとDBレコードを削除(`ctx.waitUntil()` で、レスポンスのストリーミングはブロックしない)。「最後のバイト送出直後にクライアントが接続を閉じる」ケースは `pipeTo` が reject するが、届いたバイト数が `object.size` に達していれば完走扱いにする。
   - 全バイト届く前に中断(通信断・タブクローズなど)された場合: このダウンロードは「消費されなかった」とみなし、加算しておいた `download_count` を戻す。これにより「1回」ファイルでも、途中で切れたらもう一度取得し直せる(削除は完走時のみ)。
   - この中断検知は「Cloudflare Workers がクライアント切断時にレスポンスの `ReadableStream` を cancel する」挙動に依存する。**本番相当のプレビュー/本番で「大容量の『1回』ファイルをタブクローズ/通信断 → もう一度取得できる」ことを一度は実機確認すること。** また、中断直後(`ctx.waitUntil` の回数戻しが完了する前のミリ秒オーダー)にクライアントが即座に再取得すると 404(既に上限到達)を踏みうる。人間の再クリックより速い自動リトライ実装がクライアント側に入る場合は、この窓を考慮すること(既知の軽微な制約)。

## 掃除(Cleanup)

[`lib/cleanup.ts`](../lib/cleanup.ts) が以下の2種類の掃除を担当し、`custom-worker.ts` の `scheduled` ハンドラ(毎日0時、`wrangler.jsonc` の `triggers.crons`)から呼び出されます。また管理画面からの手動削除(`DELETE /api/admin/shares/[shareId]`)も同じ `deleteShare()` を利用します。

- **期限切れ共有の削除**(`cleanupExpiredShares`): `shares.expires_at` を過ぎた共有をR2オブジェクト・D1レコードごと削除。
- **放置されたアップロードセッションの削除**(`cleanupStaleUploads`): 通信断やタブを閉じるなどで `/api/upload/complete` まで到達しなかったセッションを、共有の有効期限とは無関係に、セッション自体の古さ(24時間)で判定して削除。R2の未完了マルチパートアップロードはabortしないと課金対象のストレージとして残り続けるため、DBレコードの削除前に必ずabortする。
