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
| `STRIPE_PRICE_ID` / `OPENNODE_BTC_CHARGE_AMOUNT_USD` / `OPENNODE_BTC_DAYS_PER_CHARGE` | 環境変数 | 有料プランの価格・期間設定 |

## 主要な画面とAPI

| パス | 役割 |
| --- | --- |
| `/`(`app/page.tsx`) | アップロード画面(`components/upload/uploadForm.tsx`) |
| `/d/[shareId]`(`app/d/[shareId]/page.tsx`) | ダウンロード画面(`components/download/DownloadPage.tsx`) |
| `/report`(`app/report/page.tsx`) | 一般向け通報フォーム |
| `/report/rights`(`app/report/rights/page.tsx`) | 権利者向け申し立てフォーム |
| `/admin`(`app/admin/page.tsx`) | 通報管理画面(要Cloudflare Access認証) |
| `/mypage/signup`・`/mypage/login`・`/mypage/recover` | アカウント作成・ログイン・パスワード再設定([`accounts.md`](./accounts.md)) |
| `/mypage/billing`(`app/mypage/billing/page.tsx`) | プラン確認・Stripe/Bitcoin決済導線 |
| `/pricing`(`app/pricing/page.tsx`) | プラン比較(Free・Standard・Premium)の紹介ページ。Standardは未実装で「近日公開」表示のみ(実装はIssue #5でトラッキング) |
| `/about`(`app/about/page.tsx`) | サービス紹介ページ(理念・非営利であること、E2E暗号化の仕組み、OSSであること、よくある質問) |
| `/legal/terms`・`/legal/privacy`・`/legal/tokushoho` | 利用規約・プライバシーポリシー・特定商取引法に基づく表記([`legal.md`](./legal.md)) |

API側の詳細は [`api.md`](./api.md) を参照。

## フロントエンドのロジック配置

`components/upload/uploadForm.tsx`・`components/download/DownloadPage.tsx`・`components/admin/AdminReportsPage.tsx`は、UIの状態管理・JSX以外の非UIロジック(暗号化呼び出し・ネットワーク呼び出し・純粋な整形関数など)を対応する`lib/`配下に切り出しており、`lib/`側は個別にVitestテストを持つ(`tests/lib/upload/`・`tests/lib/download/`・`tests/lib/admin/`)。

- [`lib/upload/chunkUploader.ts`](../lib/upload/chunkUploader.ts): チャンクの並列アップロードワーカー(`uploadChunksFromStream`)。
- [`lib/upload/dragDropFiles.ts`](../lib/upload/dragDropFiles.ts): ドラッグ&ドロップされたフォルダの再帰展開(`collectDataTransferFiles`)。
- [`lib/upload/encrypt.ts`](../lib/upload/encrypt.ts): ファイル名の暗号化・パスワードによる鍵のラップ(`encryptFileName`/`wrapKeyWithPassword`)。`lib/crypto/`の暗号プリミティブを組み合わせたアップロード固有の処理。
- [`lib/download/decrypt.ts`](../lib/download/decrypt.ts): ファイル名・ファイル一覧の復号、パスワードによる鍵のアンラップ、ファイル本体の取得+復号(`fetchAndDecrypt`)。
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
3. ファイル本体は `GET /api/file/[fileId]` からストリーミングダウンロードし、受信しながらチャンクごとに復号(`lib/crypto/stream.ts`)。
4. 保存期間「1回」のファイルは、ダウンロード回数が上限に達した時点で `ctx.waitUntil()` により裏でR2オブジェクトとDBレコードを削除(レスポンスのストリーミングはブロックしない)。

## 掃除(Cleanup)

[`lib/cleanup.ts`](../lib/cleanup.ts) が以下の2種類の掃除を担当し、`custom-worker.ts` の `scheduled` ハンドラ(毎日0時、`wrangler.jsonc` の `triggers.crons`)から呼び出されます。また管理画面からの手動削除(`DELETE /api/admin/shares/[shareId]`)も同じ `deleteShare()` を利用します。

- **期限切れ共有の削除**(`cleanupExpiredShares`): `shares.expires_at` を過ぎた共有をR2オブジェクト・D1レコードごと削除。
- **放置されたアップロードセッションの削除**(`cleanupStaleUploads`): 通信断やタブを閉じるなどで `/api/upload/complete` まで到達しなかったセッションを、共有の有効期限とは無関係に、セッション自体の古さ(24時間)で判定して削除。R2の未完了マルチパートアップロードはabortしないと課金対象のストレージとして残り続けるため、DBレコードの削除前に必ずabortする。
