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
  insertTestAccount,
  readJson,
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
});

async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(message)
  );

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function postWebhook(fields: Record<string, string>) {
  const { POST } = await import("@/app/api/billing/btc/webhook/route");
  const form = new URLSearchParams(fields);

  return POST(
    new Request("http://localhost/api/billing/btc/webhook", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    })
  );
}

async function insertPendingPayment(params: {
  accountId: string;
  chargeId: string;
  plan?: "standard" | "premium";
}) {
  await env.DB.prepare(
    `INSERT INTO btc_payments (id, account_id, opennode_charge_id, status, plan, created_at) VALUES (?, ?, ?, 'pending', ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      params.accountId,
      params.chargeId,
      params.plan ?? "premium",
      new Date().toISOString()
    )
    .run();
}

async function getAccount(accountId: string) {
  return env.DB.prepare(
    `SELECT plan, plan_expires_at FROM accounts WHERE id = ?`
  )
    .bind(accountId)
    .first<{ plan: string; plan_expires_at: string | null }>();
}

describe("POST /api/billing/btc/webhook", () => {
  it("rejects a malformed payload missing required fields", async () => {
    const response = await postWebhook({ id: "charge-1" });

    expect(response.status).toBe(400);
  });

  it("rejects a request with an invalid signature and makes no DB changes", async () => {
    const { accountId } = await insertTestAccount(env);
    await insertPendingPayment({ accountId, chargeId: "charge-bad-sig" });

    const response = await postWebhook({
      id: "charge-bad-sig",
      status: "paid",
      hashed_order: "not-the-right-signature",
    });

    expect(response.status).toBe(400);

    const payment = await env.DB.prepare(
      `SELECT status FROM btc_payments WHERE opennode_charge_id = ?`
    )
      .bind("charge-bad-sig")
      .first<{ status: string }>();
    expect(payment?.status).toBe("pending");
  });

  it("ignores non-paid statuses (e.g. processing) without touching the account", async () => {
    const { accountId } = await insertTestAccount(env);
    await insertPendingPayment({ accountId, chargeId: "charge-processing" });

    const hashedOrder = await hmacHex(env.OPENNODE_API_KEY, "charge-processing");
    const response = await postWebhook({
      id: "charge-processing",
      status: "processing",
      hashed_order: hashedOrder,
    });

    expect(response.status).toBe(200);

    const payment = await env.DB.prepare(
      `SELECT status FROM btc_payments WHERE opennode_charge_id = ?`
    )
      .bind("charge-processing")
      .first<{ status: string }>();
    expect(payment?.status).toBe("pending");

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("free");
  });

  it("activates the plan and extends the expiry from now when there was no prior expiry", async () => {
    const { accountId } = await insertTestAccount(env, { plan: "free" });
    await insertPendingPayment({ accountId, chargeId: "charge-fresh" });

    const hashedOrder = await hmacHex(env.OPENNODE_API_KEY, "charge-fresh");
    const before = Date.now();
    const response = await postWebhook({
      id: "charge-fresh",
      status: "paid",
      hashed_order: hashedOrder,
    });
    const after = Date.now();

    expect(response.status).toBe(200);

    const account = await getAccount(accountId);
    expect(account?.plan).toBe("premium");

    const expiresAtMs = new Date(account!.plan_expires_at!).getTime();
    const expectedDays = env.OPENNODE_BTC_DAYS_PER_CHARGE * 24 * 60 * 60 * 1000;
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + expectedDays);
    expect(expiresAtMs).toBeLessThanOrEqual(after + expectedDays);

    const payment = await env.DB.prepare(
      `SELECT status, extends_plan_until FROM btc_payments WHERE opennode_charge_id = ?`
    )
      .bind("charge-fresh")
      .first<{ status: string; extends_plan_until: string }>();
    expect(payment?.status).toBe("paid");
    expect(payment?.extends_plan_until).toBe(account?.plan_expires_at);
  });

  it("activates the standard plan when the pending payment was recorded for standard", async () => {
    const { accountId } = await insertTestAccount(env, { plan: "free" });
    await insertPendingPayment({
      accountId,
      chargeId: "charge-standard",
      plan: "standard",
    });

    const hashedOrder = await hmacHex(env.OPENNODE_API_KEY, "charge-standard");
    const response = await postWebhook({
      id: "charge-standard",
      status: "paid",
      hashed_order: hashedOrder,
    });

    expect(response.status).toBe(200);
    const account = await getAccount(accountId);
    expect(account?.plan).toBe("standard");
  });

  it("does not downgrade an active premium account when a standard payment is confirmed (but still extends the expiry)", async () => {
    const future = new Date(
      Date.now() + 10 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: future,
    });
    await insertPendingPayment({
      accountId,
      chargeId: "charge-downgrade-attempt",
      plan: "standard",
    });

    const hashedOrder = await hmacHex(
      env.OPENNODE_API_KEY,
      "charge-downgrade-attempt"
    );
    const response = await postWebhook({
      id: "charge-downgrade-attempt",
      status: "paid",
      hashed_order: hashedOrder,
    });

    expect(response.status).toBe(200);
    const account = await getAccount(accountId);
    // プランはpremiumのまま(格下げされない)。
    expect(account?.plan).toBe("premium");
    // 有効期限は支払った分だけ延長される。
    const expected =
      new Date(future).getTime() +
      env.OPENNODE_BTC_DAYS_PER_CHARGE * 24 * 60 * 60 * 1000;
    expect(
      Math.abs(new Date(account!.plan_expires_at!).getTime() - expected)
    ).toBeLessThan(1000);
  });

  it("upgrades an active standard account to premium when a premium payment is confirmed", async () => {
    const future = new Date(
      Date.now() + 10 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "standard",
      planExpiresAt: future,
    });
    await insertPendingPayment({
      accountId,
      chargeId: "charge-upgrade",
      plan: "premium",
    });

    const hashedOrder = await hmacHex(env.OPENNODE_API_KEY, "charge-upgrade");
    const response = await postWebhook({
      id: "charge-upgrade",
      status: "paid",
      hashed_order: hashedOrder,
    });

    expect(response.status).toBe(200);
    const account = await getAccount(accountId);
    expect(account?.plan).toBe("premium");
  });

  it("activates standard for a lapsed (expired) premium account instead of preserving the stale higher tier", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: past,
    });
    await insertPendingPayment({
      accountId,
      chargeId: "charge-lapsed-premium",
      plan: "standard",
    });

    const hashedOrder = await hmacHex(
      env.OPENNODE_API_KEY,
      "charge-lapsed-premium"
    );
    const response = await postWebhook({
      id: "charge-lapsed-premium",
      status: "paid",
      hashed_order: hashedOrder,
    });

    expect(response.status).toBe(200);
    const account = await getAccount(accountId);
    // 失効済みのpremiumは実効的にはfree扱いなので、standardへの新規加入が反映される。
    expect(account?.plan).toBe("standard");
  });

  it("stacks the extension on top of an existing future expiry instead of resetting it", async () => {
    const future = new Date(
      Date.now() + 10 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { accountId } = await insertTestAccount(env, {
      plan: "premium",
      planExpiresAt: future,
    });
    await insertPendingPayment({ accountId, chargeId: "charge-stack" });

    const hashedOrder = await hmacHex(env.OPENNODE_API_KEY, "charge-stack");
    await postWebhook({
      id: "charge-stack",
      status: "paid",
      hashed_order: hashedOrder,
    });

    const account = await getAccount(accountId);
    const expected =
      new Date(future).getTime() +
      env.OPENNODE_BTC_DAYS_PER_CHARGE * 24 * 60 * 60 * 1000;
    expect(
      Math.abs(new Date(account!.plan_expires_at!).getTime() - expected)
    ).toBeLessThan(1000);
  });

  it("does not double-extend the plan when the same paid webhook is replayed (idempotency)", async () => {
    const { accountId } = await insertTestAccount(env, { plan: "free" });
    await insertPendingPayment({ accountId, chargeId: "charge-replay" });

    const hashedOrder = await hmacHex(env.OPENNODE_API_KEY, "charge-replay");
    const payload = {
      id: "charge-replay",
      status: "paid",
      hashed_order: hashedOrder,
    };

    const first = await postWebhook(payload);
    expect(first.status).toBe(200);
    const afterFirst = await getAccount(accountId);

    const second = await postWebhook(payload);
    expect(second.status).toBe(200);
    const secondBody = await readJson<{ note: string }>(second);
    expect(secondBody.note).toBe("already processed");

    const afterSecond = await getAccount(accountId);
    expect(afterSecond?.plan_expires_at).toBe(afterFirst?.plan_expires_at);
  });

  it("is a safe no-op when the charge id does not match any known payment", async () => {
    const hashedOrder = await hmacHex(env.OPENNODE_API_KEY, "charge-unknown");

    const response = await postWebhook({
      id: "charge-unknown",
      status: "paid",
      hashed_order: hashedOrder,
    });

    expect(response.status).toBe(200);
  });
});
