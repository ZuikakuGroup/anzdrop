import { describe, expect, it } from "vitest";
import {
  AnalyticsEventSchema,
  findForbiddenPropertyKeys,
} from "@/lib/analytics/schema";

function baseUploadStartEvent() {
  return {
    eventId: "11111111-1111-4111-8111-111111111111",
    eventName: "upload_start" as const,
    anonymousClientId: "client-1",
    sessionId: "session-1",
    timestamp: new Date().toISOString(),
    attemptId: "22222222-2222-4222-8222-222222222222",
    analyticsTransferId: "a".repeat(64),
  };
}

describe("AnalyticsEventSchema", () => {
  it("accepts a valid upload_start event with no extra properties", () => {
    const result = AnalyticsEventSchema.safeParse(baseUploadStartEvent());

    expect(result.success).toBe(true);
  });

  it("accepts a valid upload_start event with allowlisted properties", () => {
    const result = AnalyticsEventSchema.safeParse({
      ...baseUploadStartEvent(),
      properties: { fileCount: 2, totalSizeBucket: "10-100MB" },
    });

    expect(result.success).toBe(true);
  });

  it("rejects an unknown event_name", () => {
    const result = AnalyticsEventSchema.safeParse({
      ...baseUploadStartEvent(),
      eventName: "some_unknown_event",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a property key that is not in the event's allowlist", () => {
    const result = AnalyticsEventSchema.safeParse({
      ...baseUploadStartEvent(),
      properties: { fileCount: 2, unexpectedField: "nope" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects an event missing a required field (analyticsTransferId for upload_success)", () => {
    const result = AnalyticsEventSchema.safeParse({
      eventId: "11111111-1111-4111-8111-111111111111",
      eventName: "upload_success",
      anonymousClientId: "client-1",
      sessionId: "session-1",
      timestamp: new Date().toISOString(),
      attemptId: "22222222-2222-4222-8222-222222222222",
      properties: { durationMs: 100 },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a non-ISO timestamp", () => {
    const result = AnalyticsEventSchema.safeParse({
      ...baseUploadStartEvent(),
      timestamp: "not-a-date",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an attribution object containing the full query string as a single field", () => {
    const result = AnalyticsEventSchema.safeParse({
      eventId: "11111111-1111-4111-8111-111111111111",
      eventName: "landing_view",
      anonymousClientId: "client-1",
      sessionId: "session-1",
      timestamp: new Date().toISOString(),
      attribution: { fullQuery: "utm_source=x&secret=y" },
    });

    expect(result.success).toBe(false);
  });
});

describe("findForbiddenPropertyKeys", () => {
  it("returns an empty array when there are no forbidden keys", () => {
    expect(findForbiddenPropertyKeys({ fileCount: 3 })).toEqual([]);
  });

  it("returns an empty array for undefined/null properties", () => {
    expect(findForbiddenPropertyKeys(undefined)).toEqual([]);
    expect(findForbiddenPropertyKeys(null)).toEqual([]);
  });

  it("detects a forbidden key such as encryptionKey", () => {
    expect(
      findForbiddenPropertyKeys({ encryptionKey: "abc", fileCount: 1 })
    ).toEqual(["encryptionKey"]);
  });

  it("detects multiple forbidden keys such as email and ip", () => {
    const found = findForbiddenPropertyKeys({
      email: "a@example.com",
      ip: "127.0.0.1",
    });

    expect(found.sort()).toEqual(["email", "ip"]);
  });
});
