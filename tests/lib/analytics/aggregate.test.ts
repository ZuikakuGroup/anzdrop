import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestEnv, clearAllTables, type TestEnv } from "@/test/env";
import { computeDailyMetrics } from "@/lib/analytics/aggregate";

let env: TestEnv;
let dispose: () => Promise<void>;

beforeAll(async () => {
  const handle = await createTestEnv();
  env = handle.env;
  dispose = handle.dispose;
});

afterAll(async () => {
  await dispose();
});

beforeEach(async () => {
  await clearAllTables(env);
});

type EventInput = {
  eventId?: string;
  eventName: string;
  occurredAt: string;
  anonymousClientId: string;
  sessionId?: string;
  analyticsTransferId?: string | null;
};

async function insertEvent(input: EventInput): Promise<void> {
  await env.DB.prepare(
    `
      INSERT INTO analytics_events (
        event_id, event_name, occurred_at, received_at,
        anonymous_client_id, session_id, analytics_transfer_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      input.eventId ?? crypto.randomUUID(),
      input.eventName,
      input.occurredAt,
      input.occurredAt,
      input.anonymousClientId,
      input.sessionId ?? crypto.randomUUID(),
      input.analyticsTransferId ?? null
    )
    .run();
}

const DAY = "2026-05-10";
const DAY_TS = (hhmm: string) => `${DAY}T${hhmm}:00.000Z`;

describe("computeDailyMetrics", () => {
  it("counts upload_starts/successes and download_starts/successes for the target day only", async () => {
    await insertEvent({ eventName: "upload_start", occurredAt: DAY_TS("10:00"), anonymousClientId: "c1" });
    await insertEvent({ eventName: "upload_success", occurredAt: DAY_TS("10:01"), anonymousClientId: "c1" });
    await insertEvent({ eventName: "download_start", occurredAt: DAY_TS("11:00"), anonymousClientId: "c2" });
    await insertEvent({ eventName: "download_success", occurredAt: DAY_TS("11:01"), anonymousClientId: "c2" });
    // 別の日のイベントは含めない
    await insertEvent({ eventName: "upload_start", occurredAt: "2026-05-11T00:00:00.000Z", anonymousClientId: "c1" });

    const metrics = await computeDailyMetrics(env, DAY);

    expect(metrics.uploadStarts).toBe(1);
    expect(metrics.uploadSuccesses).toBe(1);
    expect(metrics.downloadStarts).toBe(1);
    expect(metrics.downloadSuccesses).toBe(1);
  });

  it("counts unique_senders as distinct clients with an upload_success that day", async () => {
    await insertEvent({ eventName: "upload_success", occurredAt: DAY_TS("09:00"), anonymousClientId: "c1" });
    await insertEvent({ eventName: "upload_success", occurredAt: DAY_TS("09:05"), anonymousClientId: "c1" });
    await insertEvent({ eventName: "upload_success", occurredAt: DAY_TS("09:10"), anonymousClientId: "c2" });

    const metrics = await computeDailyMetrics(env, DAY);

    expect(metrics.uniqueSenders).toBe(2);
  });

  it("counts a client as a new_sender only on the day of their first-ever upload_success", async () => {
    await insertEvent({
      eventName: "upload_success",
      occurredAt: "2026-05-01T00:00:00.000Z",
      anonymousClientId: "returning-client",
    });
    await insertEvent({
      eventName: "upload_success",
      occurredAt: DAY_TS("09:00"),
      anonymousClientId: "returning-client",
    });
    await insertEvent({
      eventName: "upload_success",
      occurredAt: DAY_TS("09:05"),
      anonymousClientId: "first-time-client",
    });

    const metrics = await computeDailyMetrics(env, DAY);

    expect(metrics.uniqueSenders).toBe(2);
    expect(metrics.newSenders).toBe(1);
  });

  it("counts successful_transfers once per transfer, on the day of the first download_success, even with repeat downloads", async () => {
    await insertEvent({
      eventName: "upload_success",
      occurredAt: DAY_TS("09:00"),
      anonymousClientId: "sender",
      analyticsTransferId: "transfer-1",
    });
    await insertEvent({
      eventName: "download_success",
      occurredAt: DAY_TS("10:00"),
      anonymousClientId: "recipient",
      analyticsTransferId: "transfer-1",
    });
    // 同じtransferの2回目のダウンロード(別の日)は二重計上しない
    await insertEvent({
      eventName: "download_success",
      occurredAt: "2026-05-11T00:00:00.000Z",
      anonymousClientId: "recipient-2",
      analyticsTransferId: "transfer-1",
    });

    const dayMetrics = await computeDailyMetrics(env, DAY);
    const nextDayMetrics = await computeDailyMetrics(env, "2026-05-11");

    expect(dayMetrics.successfulTransfers).toBe(1);
    expect(nextDayMetrics.successfulTransfers).toBe(0);
  });

  it("does not count a transfer as successful if there was no upload_success (orphaned download)", async () => {
    await insertEvent({
      eventName: "download_success",
      occurredAt: DAY_TS("10:00"),
      anonymousClientId: "recipient",
      analyticsTransferId: "transfer-without-upload",
    });

    const metrics = await computeDailyMetrics(env, DAY);

    expect(metrics.successfulTransfers).toBe(0);
  });

  it("counts a recipient_to_sender_conversion when a downloader later uploads a different transfer", async () => {
    await insertEvent({
      eventName: "upload_success",
      occurredAt: "2026-05-01T00:00:00.000Z",
      anonymousClientId: "original-sender",
      analyticsTransferId: "transfer-1",
    });
    await insertEvent({
      eventName: "download_success",
      occurredAt: "2026-05-02T00:00:00.000Z",
      anonymousClientId: "recipient-turned-sender",
      analyticsTransferId: "transfer-1",
    });
    await insertEvent({
      eventName: "upload_start",
      occurredAt: DAY_TS("09:00"),
      anonymousClientId: "recipient-turned-sender",
      analyticsTransferId: "transfer-2",
    });

    const metrics = await computeDailyMetrics(env, DAY);

    expect(metrics.recipientToSenderConversions).toBe(1);
  });

  it("does not count self-downloads (uploader downloading their own transfer) as a conversion", async () => {
    await insertEvent({
      eventName: "upload_success",
      occurredAt: "2026-05-01T00:00:00.000Z",
      anonymousClientId: "same-client",
      analyticsTransferId: "transfer-1",
    });
    await insertEvent({
      eventName: "download_success",
      occurredAt: "2026-05-02T00:00:00.000Z",
      anonymousClientId: "same-client",
      analyticsTransferId: "transfer-1",
    });
    await insertEvent({
      eventName: "upload_start",
      occurredAt: DAY_TS("09:00"),
      anonymousClientId: "same-client",
      analyticsTransferId: "transfer-2",
    });

    const metrics = await computeDailyMetrics(env, DAY);

    expect(metrics.recipientToSenderConversions).toBe(0);
  });

  it("counts sessions and landing_sessions as distinct session_id values", async () => {
    await insertEvent({
      eventName: "landing_view",
      occurredAt: DAY_TS("09:00"),
      anonymousClientId: "c1",
      sessionId: "session-a",
    });
    await insertEvent({
      eventName: "file_select",
      occurredAt: DAY_TS("09:01"),
      anonymousClientId: "c1",
      sessionId: "session-a",
    });
    await insertEvent({
      eventName: "download_start",
      occurredAt: DAY_TS("09:02"),
      anonymousClientId: "c2",
      sessionId: "session-b",
    });

    const metrics = await computeDailyMetrics(env, DAY);

    expect(metrics.sessions).toBe(2);
    expect(metrics.landingSessions).toBe(1);
  });

  it("writes a row to analytics_daily_metrics that can be read back", async () => {
    await insertEvent({ eventName: "upload_success", occurredAt: DAY_TS("09:00"), anonymousClientId: "c1" });

    await computeDailyMetrics(env, DAY);

    const row = await env.DB.prepare(
      `SELECT * FROM analytics_daily_metrics WHERE date = ?`
    )
      .bind(DAY)
      .first<{ date: string; unique_senders: number }>();

    expect(row?.date).toBe(DAY);
    expect(row?.unique_senders).toBe(1);
  });

  it("overwrites the previous row when recomputed for the same day (idempotent)", async () => {
    await insertEvent({ eventName: "upload_success", occurredAt: DAY_TS("09:00"), anonymousClientId: "c1" });
    await computeDailyMetrics(env, DAY);

    await insertEvent({ eventName: "upload_success", occurredAt: DAY_TS("09:05"), anonymousClientId: "c2" });
    await computeDailyMetrics(env, DAY);

    const { results } = await env.DB.prepare(
      `SELECT * FROM analytics_daily_metrics WHERE date = ?`
    )
      .bind(DAY)
      .all<{ unique_senders: number }>();

    expect(results).toHaveLength(1);
    expect(results[0].unique_senders).toBe(2);
  });
});
