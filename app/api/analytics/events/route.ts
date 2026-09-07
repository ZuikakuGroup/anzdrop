import { getCloudflareContext } from "@opennextjs/cloudflare";
import { withApiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  findForbiddenAnalyticsValueFields,
  findForbiddenPropertyKeys,
  type AnalyticsEvent,
} from "@/lib/analytics/schema";
import {
  AnalyticsEventsRequestSchema,
  type AnalyticsEventsResponse,
} from "@/app/api/analytics/events/schema";

// Beacon/fetchのbodyサイズが際限なく膨らまないようにする(20件バッチ、
// 各イベントは小さなJSONのため十分な余裕を見た上限)。
const MAX_BODY_BYTES = 32 * 1024;

async function readBodyWithinLimit(
  request: Request
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;

    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }

    chunks.push(value);
  }

  const body: Uint8Array<ArrayBuffer> = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

// クライアント時刻を信頼しすぎないための妥当性チェック(要件書19章の
// 「計測処理がUXをブロックしない」とは独立に、明らかに壊れた/なりすました
// タイムスタンプのイベントを弾く)。
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

function acceptedResponse(): Response {
  const body: AnalyticsEventsResponse = { success: true };

  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

function rejectedResponse(error: string): Response {
  const body: AnalyticsEventsResponse = { success: false, error };

  return Response.json(body, { status: 400, headers: { "Cache-Control": "no-store" } });
}

// `occurred_at`はD1側でBETWEEN/`<`/MIN()等の文字列比較で扱われる。クライアント
// から届く値はISO 8601として解釈さえできればスキーマ検証を通る(オフセット表記・
// ミリ秒省略など表記ゆれを許す)ため、ここで`Date`を経由した正規形
// (`toISOString()`、常にUTC・ミリ秒3桁・Z終端)へ揃えてから保存し、日付
// バケット集計や保持期限の判定が表記ゆれで狂わないようにする。
function normalizeTimestamp(timestamp: string): string | null {
  const parsed = Date.parse(timestamp);

  if (Number.isNaN(parsed)) {
    return null;
  }

  if (Math.abs(Date.now() - parsed) > MAX_CLOCK_SKEW_MS) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function toPropertiesJson(event: AnalyticsEvent): string | null {
  if (!("properties" in event) || event.properties === undefined) {
    return null;
  }

  return JSON.stringify(event.properties);
}

export const POST = withApiHandler(
  "POST /api/analytics/events",
  async (request: Request): Promise<Response> => {
    const { env } = getCloudflareContext();

    const contentLength = request.headers.get("content-length");

    if (
      /^\d+$/.test(contentLength?.trim() ?? "") &&
      Number(contentLength) > MAX_BODY_BYTES
    ) {
      return rejectedResponse("リクエストサイズが上限を超えています");
    }

    const body = await readBodyWithinLimit(request);

    if (!body) {
      return rejectedResponse("リクエストサイズが上限を超えています");
    }

    const parsed = await parseJsonBody(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: body.buffer,
      }),
      AnalyticsEventsRequestSchema
    );

    if (!parsed.ok) {
      return parsed.response;
    }

    const { events } = parsed.data;

    // Privacy Guard(要件書33章)。allowlistスキーマ自体も未知キーを
    // reject する。さらに、許可済みキーの値にもPrivacy Guardを適用して
    // リクエスト全体を拒否する。timestampは正規化した値をこのループで
    // 確定させ、以降のINSERTでは元の(表記ゆれがありうる)値を使わない。
    const normalizedTimestamps: string[] = [];

    for (const event of events) {
      const forbiddenKeys = findForbiddenPropertyKeys(
        "properties" in event ? event.properties : undefined
      );

      if (forbiddenKeys.length > 0) {
        console.error(
          `POST /api/analytics/events: forbidden property keys detected: ${forbiddenKeys.join(", ")}`
        );

        return rejectedResponse("許可されていないデータが含まれています");
      }

      const forbiddenValueFields = findForbiddenAnalyticsValueFields(event);

      if (forbiddenValueFields.length > 0) {
        console.error(
          `POST /api/analytics/events: forbidden values detected in: ${forbiddenValueFields.join(", ")}`
        );

        return rejectedResponse("許可されていないデータが含まれています");
      }

      const normalizedTimestamp = normalizeTimestamp(event.timestamp);

      if (!normalizedTimestamp) {
        return rejectedResponse("timestampの値が不正です");
      }

      normalizedTimestamps.push(normalizedTimestamp);
    }

    // バッチ内の全イベントは同一クライアントからの送信を前提とする
    // (レート制限のキー単位をそろえ、無関係なclientIdを1回のリクエストへ
    // 混ぜてレート制限を回避する経路を作らないため)。
    const anonymousClientId = events[0].anonymousClientId;
    const hasMixedClientIds = events.some(
      (event) => event.anonymousClientId !== anonymousClientId
    );

    if (hasMixedClientIds) {
      return rejectedResponse("バッチ内のanonymousClientIdが一致していません");
    }

    // このキー(anonymousClientId)はクライアントが自己申告する値で、
    // shareId/fileId等と異なり事前に「知っている」必要のある秘密ではない
    // ため、悪意ある送信者は毎回新しい値を名乗ることでこのキー単位の枠を
    // 回避できるため、まず固定キーでエンドポイント全体の書き込み量を頭打ちにし、
    // 続けて匿名ID単位の連打も制限する。Cloudflare WAFの送信元IP単位ルールが
    // 未適用の環境でも、固定キー側は使い捨てIDでは回避できない。
    const endpointRateLimit = await checkRateLimit(
      env.ANALYTICS_RATE_LIMITER,
      "endpoint:all",
      "POST /api/analytics/events"
    );

    if (!endpointRateLimit.ok) {
      return endpointRateLimit.response;
    }

    const clientRateLimit = await checkRateLimit(
      env.ANALYTICS_RATE_LIMITER,
      anonymousClientId,
      "POST /api/analytics/events"
    );

    if (!clientRateLimit.ok) {
      return clientRateLimit.response;
    }

    const receivedAt = new Date().toISOString();

    const statements = events.map((event, index) =>
      env.DB.prepare(
        `
          INSERT OR IGNORE INTO analytics_events (
            event_id, event_name, occurred_at, received_at,
            anonymous_client_id, session_id, analytics_transfer_id, attempt_id,
            source, medium, campaign, content, term,
            landing_path, referrer_domain, device_class, browser_family, locale,
            properties
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      ).bind(
        event.eventId,
        event.eventName,
        normalizedTimestamps[index],
        receivedAt,
        event.anonymousClientId,
        event.sessionId,
        "analyticsTransferId" in event ? event.analyticsTransferId ?? null : null,
        "attemptId" in event ? event.attemptId ?? null : null,
        event.attribution?.source ?? null,
        event.attribution?.medium ?? null,
        event.attribution?.campaign ?? null,
        event.attribution?.content ?? null,
        event.attribution?.term ?? null,
        event.context?.landingPath ?? null,
        event.context?.referrerDomain ?? null,
        event.context?.deviceClass ?? null,
        event.context?.browserFamily ?? null,
        event.context?.locale ?? null,
        toPropertiesJson(event)
      )
    );

    await env.DB.batch(statements);

    return acceptedResponse();
  }
);
