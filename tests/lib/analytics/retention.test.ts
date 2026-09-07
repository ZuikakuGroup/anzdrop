import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestEnv, clearAllTables, type TestEnv } from "@/test/env";
import { deleteExpiredAnalyticsEvents } from "@/lib/analytics/retention";

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

async function insertEventAt(occurredAt: string): Promise<string> {
  const eventId = crypto.randomUUID();

  await env.DB.prepare(
    `
      INSERT INTO analytics_events (
        event_id, event_name, occurred_at, received_at, anonymous_client_id, session_id
      ) VALUES (?, 'landing_view', ?, ?, 'client-1', 'session-1')
    `
  )
    .bind(eventId, occurredAt, occurredAt)
    .run();

  return eventId;
}

async function eventIds(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT event_id FROM analytics_events`
  ).all<{ event_id: string }>();

  return (results ?? []).map((row) => row.event_id);
}

describe("deleteExpiredAnalyticsEvents", () => {
  it("deletes events older than the retention window and keeps recent ones", async () => {
    const oldEventId = await insertEventAt(
      new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString()
    );
    const recentEventId = await insertEventAt(
      new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
    );

    const deletedCount = await deleteExpiredAnalyticsEvents(env);

    const remaining = await eventIds();

    expect(deletedCount).toBe(1);
    expect(remaining).toEqual([recentEventId]);
    expect(remaining).not.toContain(oldEventId);
  });

  it("does nothing when there are no expired events", async () => {
    await insertEventAt(new Date().toISOString());

    const deletedCount = await deleteExpiredAnalyticsEvents(env);

    expect(deletedCount).toBe(0);
    expect(await eventIds()).toHaveLength(1);
  });

  it("respects a custom retention window", async () => {
    const eventId = await insertEventAt(
      new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    );

    const deletedCount = await deleteExpiredAnalyticsEvents(env, 1);

    expect(deletedCount).toBe(1);
    expect(await eventIds()).not.toContain(eventId);
  });
});
