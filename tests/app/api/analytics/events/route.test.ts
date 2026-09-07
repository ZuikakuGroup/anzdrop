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

  it("normalizes a non-canonical (but validly parseable) timestamp before storing it", async () => {
    // +09:00オフセット表記はDate.parseでは正当だが、UTC/Z終端のtoISOString()
    // 表記とは文字列としての大小関係が食い違いうる。DBへは正規化した値
    // (常にUTC・Z終端)を保存し、日付範囲での文字列比較(BETWEEN等)が
    // 表記ゆれで狂わないことを確認する。timestampPlausibleの24時間許容幅に
    // 収まるよう、現在時刻を+09:00表記に書き換えたものを使う。
    const now = new Date();
    now.setUTCMilliseconds(0);
    const expectedCanonical = now.toISOString();

    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const nonCanonical =
      `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}` +
      `T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}:${pad(jst.getUTCSeconds())}+09:00`;

    await postEvents([uploadStartEvent({ timestamp: nonCanonical })]);

    const rows = await allEvents();

    expect(rows[0].occurred_at).toBe(expectedCanonical);
  });

  it("does not persist the raw shareId, only the hashed analyticsTransferId", async () => {
    await postEvents([uploadStartEvent({ analyticsTransferId: "f".repeat(64) })]);

    const rows = await allEvents();

    expect(rows[0].analytics_transfer_id).toBe("f".repeat(64));
  });
});
