import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestEnv, clearAllTables, type TestEnv } from "@/test/env";
import {
  getAcquisitionReport,
  getFunnelReport,
  getOverviewReport,
  getRecipientGrowthReport,
  getReliabilityReport,
  getRetentionReport,
} from "@/lib/analytics/reports";
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
  eventName: string;
  occurredAt: string;
  anonymousClientId: string;
  sessionId?: string;
  analyticsTransferId?: string | null;
  attemptId?: string | null;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  landingPath?: string | null;
  deviceClass?: string | null;
  properties?: Record<string, unknown> | null;
};

async function insertEvent(input: EventInput): Promise<void> {
  await env.DB.prepare(
    `
      INSERT INTO analytics_events (
        event_id, event_name, occurred_at, received_at,
        anonymous_client_id, session_id, analytics_transfer_id, attempt_id,
        source, medium, campaign, landing_path, device_class, properties
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      crypto.randomUUID(),
      input.eventName,
      input.occurredAt,
      input.occurredAt,
      input.anonymousClientId,
      input.sessionId ?? crypto.randomUUID(),
      input.analyticsTransferId ?? null,
      input.attemptId ?? null,
      input.source ?? null,
      input.medium ?? null,
      input.campaign ?? null,
      input.landingPath ?? null,
      input.deviceClass ?? null,
      input.properties ? JSON.stringify(input.properties) : null
    )
    .run();
}

const TODAY = new Date("2026-05-10T12:00:00.000Z");

describe("getOverviewReport", () => {
  it("reads today's snapshot from analytics_daily_metrics", async () => {
    await insertEvent({
      eventName: "upload_success",
      occurredAt: "2026-05-10T09:00:00.000Z",
      anonymousClientId: "c1",
    });
    await insertEvent({
      eventName: "upload_start",
      occurredAt: "2026-05-10T08:59:00.000Z",
      anonymousClientId: "c1",
    });
    await computeDailyMetrics(env, "2026-05-10");

    const report = await getOverviewReport(env, TODAY);

    expect(report.today.uniqueSenders).toBe(1);
    expect(report.today.uploadSuccessRate).toBe(1);
  });

  it("returns null rates when there is no data (avoids division by zero)", async () => {
    const report = await getOverviewReport(env, TODAY);

    expect(report.today.uploadSuccessRate).toBeNull();
    expect(report.today.downloadSuccessRate).toBeNull();
    expect(report.last30Days.repeatSenderRate).toBeNull();
  });

  it("sums last30Days across multiple daily_metrics rows", async () => {
    await insertEvent({ eventName: "upload_success", occurredAt: "2026-05-08T00:00:00.000Z", anonymousClientId: "a" });
    await insertEvent({ eventName: "upload_success", occurredAt: "2026-05-09T00:00:00.000Z", anonymousClientId: "b" });
    await computeDailyMetrics(env, "2026-05-08");
    await computeDailyMetrics(env, "2026-05-09");

    const report = await getOverviewReport(env, TODAY);

    expect(report.last30Days.uniqueSenders).toBe(2);
  });
});

describe("getFunnelReport", () => {
  it("counts each funnel step and computes conversion rate from the previous step", async () => {
    for (let i = 0; i < 10; i++) {
      await insertEvent({ eventName: "landing_view", occurredAt: "2026-05-10T09:00:00.000Z", anonymousClientId: `c${i}` });
    }
    for (let i = 0; i < 5; i++) {
      await insertEvent({ eventName: "file_select", occurredAt: "2026-05-10T09:01:00.000Z", anonymousClientId: `c${i}` });
    }
    for (let i = 0; i < 2; i++) {
      await insertEvent({ eventName: "upload_start", occurredAt: "2026-05-10T09:02:00.000Z", anonymousClientId: `c${i}` });
    }

    const report = await getFunnelReport(env, "2026-05-10", "2026-05-10");

    const landing = report.steps.find((s) => s.name === "landing_view")!;
    const fileSelect = report.steps.find((s) => s.name === "file_select")!;
    const uploadStart = report.steps.find((s) => s.name === "upload_start")!;

    expect(landing.count).toBe(10);
    expect(landing.conversionRateFromPrevious).toBeNull();
    expect(fileSelect.count).toBe(5);
    expect(fileSelect.conversionRateFromPrevious).toBe(0.5);
    expect(uploadStart.count).toBe(2);
    expect(uploadStart.conversionRateFromPrevious).toBe(0.4);
  });

  it("merges share_link_copy and share_native into a single share step", async () => {
    await insertEvent({ eventName: "share_link_copy", occurredAt: "2026-05-10T09:00:00.000Z", anonymousClientId: "c1" });
    await insertEvent({ eventName: "share_native", occurredAt: "2026-05-10T09:01:00.000Z", anonymousClientId: "c2" });

    const report = await getFunnelReport(env, "2026-05-10", "2026-05-10");
    const share = report.steps.find((s) => s.name === "share")!;

    expect(share.count).toBe(2);
  });
});

describe("getReliabilityReport", () => {
  it("computes upload/download success rates and breaks down errors by code", async () => {
    await insertEvent({ eventName: "upload_start", occurredAt: "2026-05-10T09:00:00.000Z", anonymousClientId: "c1" });
    await insertEvent({ eventName: "upload_success", occurredAt: "2026-05-10T09:01:00.000Z", anonymousClientId: "c1" });
    await insertEvent({ eventName: "upload_start", occurredAt: "2026-05-10T09:02:00.000Z", anonymousClientId: "c2" });
    await insertEvent({
      eventName: "upload_error",
      occurredAt: "2026-05-10T09:03:00.000Z",
      anonymousClientId: "c2",
      properties: { errorCode: "UPLOAD_NETWORK_ERROR", errorStage: "chunk", retryCount: 1 },
    });

    const report = await getReliabilityReport(env, "2026-05-10", "2026-05-10");

    expect(report.uploadSuccessRate).toBe(0.5);
    expect(report.uploadErrorsByCode).toEqual([{ code: "UPLOAD_NETWORK_ERROR", count: 1 }]);
  });

  it("computes success rate broken down by size bucket, correlated via attempt_id", async () => {
    await insertEvent({
      eventName: "upload_start",
      occurredAt: "2026-05-10T09:00:00.000Z",
      anonymousClientId: "c1",
      attemptId: "attempt-1",
      properties: { totalSizeBucket: "<10MB" },
    });
    await insertEvent({
      eventName: "upload_success",
      occurredAt: "2026-05-10T09:01:00.000Z",
      anonymousClientId: "c1",
      attemptId: "attempt-1",
      properties: { durationMs: 100 },
    });
    // 別のsize bucketではsuccessが無い(attempt_idが一致しない)
    await insertEvent({
      eventName: "upload_start",
      occurredAt: "2026-05-10T09:02:00.000Z",
      anonymousClientId: "c2",
      attemptId: "attempt-2",
      properties: { totalSizeBucket: "10GB+" },
    });

    const report = await getReliabilityReport(env, "2026-05-10", "2026-05-10");
    const small = report.successRateBySizeBucket.find((b) => b.bucket === "<10MB");
    const huge = report.successRateBySizeBucket.find((b) => b.bucket === "10GB+");

    expect(small?.successRate).toBe(1);
    expect(huge?.successRate).toBe(0);
  });
});

describe("getAcquisitionReport", () => {
  it("groups sessions by source/medium/campaign/landing_path", async () => {
    await insertEvent({
      eventName: "landing_view",
      occurredAt: "2026-05-10T09:00:00.000Z",
      anonymousClientId: "c1",
      sessionId: "s1",
      source: "google",
      medium: "cpc",
      campaign: "launch",
      landingPath: "/",
    });
    await insertEvent({
      eventName: "upload_success",
      occurredAt: "2026-05-10T09:01:00.000Z",
      anonymousClientId: "c1",
      sessionId: "s1",
    });

    const report = await getAcquisitionReport(env, "2026-05-10", "2026-05-10");

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      source: "google",
      medium: "cpc",
      campaign: "launch",
      sessions: 1,
      uploadSuccesses: 1,
    });
  });

  it("does not count a returning sender's upload as a newSender", async () => {
    // 過去に(この集計期間より前に)一度upload_successしたことがあるクライアント。
    await insertEvent({
      eventName: "upload_success",
      occurredAt: "2026-04-01T00:00:00.000Z",
      anonymousClientId: "returning-client",
    });
    await insertEvent({
      eventName: "landing_view",
      occurredAt: "2026-05-10T09:00:00.000Z",
      anonymousClientId: "returning-client",
      sessionId: "s1",
      source: "google",
    });
    await insertEvent({
      eventName: "upload_success",
      occurredAt: "2026-05-10T09:01:00.000Z",
      anonymousClientId: "returning-client",
      sessionId: "s1",
    });

    const report = await getAcquisitionReport(env, "2026-05-10", "2026-05-10");

    expect(report.rows[0]).toMatchObject({ uploadSuccesses: 1, newSenders: 0 });
  });

  it("only counts a transfer as successful once a matching download_success exists", async () => {
    await insertEvent({
      eventName: "landing_view",
      occurredAt: "2026-05-10T09:00:00.000Z",
      anonymousClientId: "c1",
      sessionId: "s1",
      source: "google",
    });
    await insertEvent({
      eventName: "upload_success",
      occurredAt: "2026-05-10T09:01:00.000Z",
      anonymousClientId: "c1",
      sessionId: "s1",
      analyticsTransferId: "transfer-without-download",
    });

    const report = await getAcquisitionReport(env, "2026-05-10", "2026-05-10");

    expect(report.rows[0]).toMatchObject({ uploadSuccesses: 1, successfulTransfers: 0 });

    await insertEvent({
      eventName: "download_success",
      occurredAt: "2026-05-10T09:02:00.000Z",
      anonymousClientId: "c2",
      analyticsTransferId: "transfer-without-download",
    });

    const reportAfterDownload = await getAcquisitionReport(env, "2026-05-10", "2026-05-10");

    expect(reportAfterDownload.rows[0]).toMatchObject({ successfulTransfers: 1 });
  });
});

describe("getRetentionReport", () => {
  it("computes a cohort size and day-N retention rates", async () => {
    await insertEvent({
      eventName: "upload_success",
      occurredAt: "2026-04-01T00:00:00.000Z",
      anonymousClientId: "retained-client",
    });
    await insertEvent({
      eventName: "upload_success",
      occurredAt: "2026-04-08T00:00:00.000Z",
      anonymousClientId: "retained-client",
    });
    await insertEvent({
      eventName: "upload_success",
      occurredAt: "2026-04-01T00:00:00.000Z",
      anonymousClientId: "churned-client",
    });

    const report = await getRetentionReport(env, "2026-04-01", "2026-04-01");

    expect(report.cohortSize).toBe(2);
    expect(report.dayRates["7"]).toBe(0.5);
    expect(report.dayRates["1"]).toBe(0);
  });

  it("returns null rates for an empty cohort", async () => {
    const report = await getRetentionReport(env, "2026-04-01", "2026-04-01");

    expect(report.cohortSize).toBe(0);
    expect(report.dayRates["30"]).toBeNull();
  });
});

describe("getRecipientGrowthReport", () => {
  it("counts unique recipients, CTA views/clicks, and conversions", async () => {
    await insertEvent({
      eventName: "upload_success",
      occurredAt: "2026-05-01T00:00:00.000Z",
      anonymousClientId: "sender",
      analyticsTransferId: "transfer-1",
    });
    await insertEvent({
      eventName: "download_success",
      occurredAt: "2026-05-02T00:00:00.000Z",
      anonymousClientId: "recipient",
      analyticsTransferId: "transfer-1",
    });
    await insertEvent({
      eventName: "recipient_send_cta_view",
      occurredAt: "2026-05-02T00:01:00.000Z",
      anonymousClientId: "recipient",
    });
    await insertEvent({
      eventName: "recipient_send_cta_click",
      occurredAt: "2026-05-02T00:02:00.000Z",
      anonymousClientId: "recipient",
    });
    await insertEvent({
      eventName: "upload_start",
      occurredAt: "2026-05-03T00:00:00.000Z",
      anonymousClientId: "recipient",
      analyticsTransferId: "transfer-2",
    });

    const report = await getRecipientGrowthReport(env, "2026-05-01", "2026-05-31");

    expect(report.uniqueRecipients).toBe(1);
    expect(report.ctaViews).toBe(1);
    expect(report.ctaClicks).toBe(1);
    expect(report.conversions).toBe(1);
    expect(report.averageDaysToConversion).toBe(1);
  });
});
