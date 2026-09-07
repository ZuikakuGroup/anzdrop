# 計測・分析基盤

要件定義書「Anzdrop 計測・分析基盤 要件定義書 v1.0」に基づく、Phase 1 + Phase 2 スコープの実装について説明します。Phase 3(Google Ads連携)は未実装です。

## 目的とプライバシー原則

Anzdropの成長・改善判断に必要な最小限のデータを、E2E暗号化とプライバシー保護を損なわずに収集します。以下は計測イベントへ**一切含めません**(サーバー側のZodスキーマとPrivacy Guardで強制、[`lib/analytics/schema.ts`](../lib/analytics/schema.ts)):

- ファイル本体・ファイル名・復号鍵・暗号鍵
- 共有URL全体・URL Fragment・Query文字列全体
- メールアドレス・電話番号・真のIPアドレス・完全なUser-Agent

## アーキテクチャ

```
ブラウザ
  lib/analytics/{ids,attribution,device,client,schema}.ts
        │ track(eventName, properties) — 非同期・失敗を握りつぶす
        │ navigator.sendBeacon() 優先 / fetch(keepalive) fallback
        ▼
POST /api/analytics/events
        │ Zod validation (allowlist) → Privacy Guard → 重複除去(event_id) → レート制限(anonymous_client_id)
        ▼
D1: analytics_events (append-only, 90日保持)
        │ 日次バッチ (Cron Trigger, 毎日UTC 00:10)
        ▼
D1: analytics_daily_metrics (24ヶ月以上保持)
        │
        ▼
/admin/analytics (Cloudflare Access 保護)
```

計測APIへの送信は常に非同期・fire-and-forestで行われ、失敗してもアップロード・ダウンロード・共有といった本来の機能は一切ブロックされません([`lib/analytics/client.ts`](../lib/analytics/client.ts))。

## 識別子

| 識別子 | 生成場所 | 保存先 | 用途 |
| --- | --- | --- | --- |
| `anonymous_client_id` | ブラウザ([`lib/analytics/ids.ts`](../lib/analytics/ids.ts)) | `localStorage` | ブラウザ単位の匿名継続利用の把握。個人を特定しない |
| `session_id` | ブラウザ(同上) | `localStorage`(30分操作がなければ再発行) | セッション単位の行動分析 |
| `event_id` | ブラウザ(`crypto.randomUUID()`) | — | 重複送信の除外(`analytics_events.event_id` にUNIQUE制約) |
| `analytics_transfer_id` | サーバー([`lib/analytics/transferId.ts`](../lib/analytics/transferId.ts)) | — | `HMAC-SHA256(shareId, ANALYTICS_SECRET)`。生の`shareId`をAnalytics DBへ保存せずに、同一transferのupload/downloadイベントを相関する |

`analytics_transfer_id` は `POST /api/upload/start` と `GET /api/download/[shareId]` のレスポンスに含まれます(どちらも既に`shareId`自体を返しているため、追加の情報漏洩にはなりません)。`ANALYTICS_SECRET`の未設定・不正により生成できない場合だけ省略し、ファイルのアップロードやダウンロード自体は継続します。

## イベント一覧(Phase 1 + Phase 2)

`lib/analytics/schema.ts` の `ANALYTICS_EVENT_NAMES` で固定されたallowlist。それ以外の`event_name`・未定義の`properties`キーは`POST /api/analytics/events`がリクエストごと拒否します。

| イベント | 発火箇所 |
| --- | --- |
| `landing_view` | `components/upload/uploadForm.tsx` マウント時 |
| `file_select` | ファイル選択・ドロップ時 |
| `upload_start` / `upload_success` / `upload_error` | `lib/upload/uploadFile.ts` の各段階(`errorCode`は[`lib/analytics/errorCodes.ts`](../lib/analytics/errorCodes.ts)で定義済みコードへ丸める) |
| `share_link_copy` / `share_native` | 共有リンクコピー・Web Share API利用時 |
| `download_start` / `download_success` / `download_error` | `components/download/DownloadPage.tsx` |
| `recipient_send_cta_view` / `recipient_send_cta_click` | ダウンロード成功後に表示される「Anzdropでファイルを送る」導線 |

## データベース

`migrations/0016_create_analytics_tables.sql`:

- `analytics_events`: 生イベント。90日保持([`lib/analytics/retention.ts`](../lib/analytics/retention.ts)が毎日削除)。
- `analytics_daily_metrics`: 日次集計。無期限保持([`lib/analytics/aggregate.ts`](../lib/analytics/aggregate.ts)が毎日UTC 00:10に前日分を計算)。

**既知の制約**: `successful_transfers`・`recipient_to_sender_conversions`・Retentionダッシュボードのコホート分析は、対象クライアント/transferの過去の全イベントを参照する集計です。生イベントの保持期間(90日)を超えた期間をまたぐ場合、当時のイベントが既に削除されているため正確に計算できないことがあります。Retentionダッシュボードの観測上限をDay 90に揃えているのはこのためです。

## Admin Dashboard

`/admin/analytics`(Cloudflare Access保護 + `requireAdmin()`)、`GET /api/admin/analytics?view=...` から以下の6種のレポートを取得します(`lib/analytics/reports.ts`):

- `overview` — 本日・直近30日のNorth Star / 主要KPI
- `funnel` — landing_view → file_select → upload_start → upload_success → share → download_success
- `reliability` — Upload/Download Success Rate、エラーコード別発生数、Size Bucket/Device Class別成功率
- `acquisition` — source/medium/campaign/landing_path別のセッション数・New Sender数
- `retention` — 初回upload_successを基準にしたDay 1/7/14/30/60/90の継続率
- `recipient-growth` — Unique Recipients、CTA表示・クリック数、Recipient→Sender Conversion数・平均転換日数

## KPI定義

| KPI名 | 定義 | 実装(集計ロジック) | バージョン | 変更日 |
| --- | --- | --- | --- | --- |
| Monthly Successful Transfer | 1つのtransferについて`upload_success`後、少なくとも1回の`download_success`が発生した場合を1件とする(重複ダウンロードは二重計上しない) | `lib/analytics/aggregate.ts` の `countSuccessfulTransfers`(初回`download_success`の日に計上) | 1.0 | 2026-09-07 |
| Monthly Unique Senders | 期間内に最低1回`upload_success`が発生した`anonymous_client_id`のユニーク数 | `lib/analytics/aggregate.ts` の `countEventName(..., distinctClient=true)` | 1.0 | 2026-09-07 |
| New Senders | 期間中に初めて`upload_success`が発生したクライアント数 | `lib/analytics/aggregate.ts` の `countNewSenders` | 1.0 | 2026-09-07 |
| 30-day Repeat Sender Rate | 初回`upload_success`から30日以内に2回目の`upload_success`を行ったクライアント数 ÷ 30日間の観測が終了した新規sender数 | `lib/analytics/reports.ts` の `computeRepeatSenderRate` | 1.0 | 2026-09-07 |
| Recipient → Sender Conversion Rate | あるtransferを`download_success`した(自分がuploadした場合を除く)クライアントが、その後別のtransferを`upload_start`した件数 | `lib/analytics/aggregate.ts` の `countRecipientToSenderConversions` / `lib/analytics/reports.ts` の `getRecipientGrowthReport` | 1.0 | 2026-09-07 |
| Upload Success Rate | `upload_success` ÷ `upload_start` | `lib/analytics/reports.ts` の `getOverviewReport` / `getReliabilityReport` | 1.0 | 2026-09-07 |
| Download Success Rate | `download_success` ÷ `download_start` | 同上 | 1.0 | 2026-09-07 |
| Landing → Upload Start Conversion | `upload_start`が発生したsession数 ÷ `landing_view`が発生したsession数 | `lib/analytics/reports.ts` の `getFunnelReport` | 1.0 | 2026-09-07 |
| Share Completion Rate | (`share_link_copy` または `share_native`) ÷ `upload_success` | `lib/analytics/reports.ts` の `getFunnelReport` | 1.0 | 2026-09-07 |

KPIの定義を変更する場合は、このテーブルの「バージョン」「変更日」を必ず更新し、過去バージョンとの非連続性をダッシュボード上で分かるようにしてください(要件書36章)。
