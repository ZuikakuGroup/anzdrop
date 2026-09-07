import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createTestEnv,
  clearAllTables,
  resetRateLimiters,
  type TestEnv,
} from "@/test/env";

let env: TestEnv;
let dispose: () => Promise<void>;

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env }),
}));

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
  resetRateLimiters(env);
});

type AnalyticsEventRow = {
  event_id: string;
  event_name: string;
  occurred_at: string;
  anonymous_client_id: string;
  session_id: string;
  analytics_transfer_id: string | null;
  properties: string | null;
};

function uploadStartEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: crypto.randomUUID(),
    eventName: "upload_start",
    anonymousClientId: "client-1",
    sessionId: "session-1",
    timestamp: new Date().toISOString(),
    attemptId: crypto.randomUUID(),
    analyticsTransferId: "a".repeat(64),
    ...overrides,
  };
}

async function postEvents(events: unknown[]) {
  const { POST } = await import("@/app/api/analytics/events/route");

  return POST(
    new Request("http://localhost/api/analytics/events", {
      method: "POST",
      body: JSON.stringify({ events }),
    })
  );
}

async function postRawBody(body: string, headers?: HeadersInit) {
  const { POST } = await import("@/app/api/analytics/events/route");

  return POST(
    new Request("http://localhost/api/analytics/events", {
      method: "POST",
      headers,
      body,
    })
  );
}

async function allEvents(): Promise<AnalyticsEventRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM analytics_events`
  ).all<AnalyticsEventRow>();

  return results ?? [];
}

describe("POST /api/analytics/events", () => {
  it("inserts a valid batch of events", async () => {
    const response = await postEvents([
      uploadStartEvent(),
      uploadStartEvent({ eventId: crypto.randomUUID() }),
    ]);

    expect(response.status).toBe(200);
    expect(await allEvents()).toHaveLength(2);
  });

  it("ignores a duplicate event_id instead of erroring (AC-14)", async () => {
    const duplicateId = crypto.randomUUID();

    const first = await postEvents([uploadStartEvent({ eventId: duplicateId })]);
    const second = await postEvents([uploadStartEvent({ eventId: duplicateId })]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await allEvents()).toHaveLength(1);
  });

  it("rejects the whole request when one event has an unknown event_name", async () => {
    const response = await postEvents([
      uploadStartEvent(),
      uploadStartEvent({ eventId: crypto.randomUUID(), eventName: "made_up_event" }),
    ]);

    expect(response.status).toBe(400);
    expect(await allEvents()).toHaveLength(0);
  });

  it("rejects the whole request when one event has a property outside its allowlist", async () => {
    const response = await postEvents([
      uploadStartEvent(),
      uploadStartEvent({
        eventId: crypto.randomUUID(),
        properties: { fileName: "secret.pdf" },
      }),
    ]);

    expect(response.status).toBe(400);
    expect(await allEvents()).toHaveLength(0);
  });

  it("rejects a batch mixing different anonymousClientId values", async () => {
    const response = await postEvents([
      uploadStartEvent({ anonymousClientId: "client-1" }),
      uploadStartEvent({ eventId: crypto.randomUUID(), anonymousClientId: "client-2" }),
    ]);

    expect(response.status).toBe(400);
    expect(await allEvents()).toHaveLength(0);
  });

  it("rejects a batch larger than the allowed size", async () => {
    const events = Array.from({ length: 21 }, () =>
      uploadStartEvent({ eventId: crypto.randomUUID() })
    );

    const response = await postEvents(events);

    expect(response.status).toBe(400);
    expect(await allEvents()).toHaveLength(0);
  });

  it.each([
    ["missing", undefined],
    ["invalid", { "content-length": "invalid" }],
    ["forged", { "content-length": "1" }],
    ["chunked", { "transfer-encoding": "chunked" }],
  ])("rejects an oversized body with a %s length header before rate limiting", async (_name, headers) => {
    const response = await postRawBody("x".repeat(32 * 1024 + 1), headers);
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("リクエストサイズが上限を超えています");
    expect(env.ANALYTICS_RATE_LIMITER.keys).toEqual([]);
  });

  it("preserves the oversized response when Content-Length declares an oversized body", async () => {
    const response = await postRawBody("{}", {
      "content-length": String(32 * 1024 + 1),
    });
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("リクエストサイズが上限を超えています");
  });

  it("rejects an empty events array", async () => {
    const response = await postEvents([]);

    expect(response.status).toBe(400);
  });

  it("rejects a timestamp far in the future", async () => {
    const response = await postEvents([
      uploadStartEvent({
        timestamp: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      }),
    ]);

    expect(response.status).toBe(400);
    expect(await allEvents()).toHaveLength(0);
  });

  it("returns 429 and inserts nothing once the analytics rate limit is exceeded", async () => {
    env.ANALYTICS_RATE_LIMITER.denyKeyFrom("client-1", 1);

    const response = await postEvents([uploadStartEvent()]);

    expect(response.status).toBe(429);
    expect(await allEvents()).toHaveLength(0);
  });

  it("applies an endpoint-wide limit before the anonymous client limit", async () => {
    env.ANALYTICS_RATE_LIMITER.denyKeyFrom("endpoint:all", 1);

    const response = await postEvents([uploadStartEvent()]);

    expect(response.status).toBe(429);
    expect(env.ANALYTICS_RATE_LIMITER.keys).toEqual(["endpoint:all"]);
    expect(await allEvents()).toHaveLength(0);
  });

  it("rejects a non-canonical timestamp before storing it", async () => {
    // +09:00オフセット表記はDate.parseでは正当でも、厳密なUTC ISO形式ではない。
    const now = new Date();
    now.setUTCMilliseconds(0);

    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const nonCanonical =
      `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}` +
      `T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}:${pad(jst.getUTCSeconds())}+09:00`;

    const response = await postEvents([uploadStartEvent({ timestamp: nonCanonical })]);

    expect(response.status).toBe(400);
    expect(await allEvents()).toHaveLength(0);
  });

  it("does not persist the raw shareId, only the hashed analyticsTransferId", async () => {
    await postEvents([uploadStartEvent({ analyticsTransferId: "f".repeat(64) })]);

    const rows = await allEvents();

    expect(rows[0].analytics_transfer_id).toBe("f".repeat(64));
  });

  it.each([
    ["anonymous client ID", { anonymousClientId: "alice@example.com" }],
    ["UTM source", { attribution: { source: "https://example.com/?token=secret" } }],
    ["IP address", { sessionId: "203.0.113.1" }],
    [
      "error stage",
      {
        eventName: "upload_error",
        properties: {
          errorCode: "UPLOAD_NETWORK_ERROR",
          errorStage: "+81 90 1234 5678",
          retryCount: 0,
        },
      },
    ],
  ])("rejects a sensitive %s in direct API requests before persisting it", async (_field, override) => {
    const response = await postEvents([uploadStartEvent(override)]);

    expect(response.status).toBe(400);
    expect(await allEvents()).toHaveLength(0);
  });
});
