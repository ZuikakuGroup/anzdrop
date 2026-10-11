import { bindRouteHandlers } from "@/test/runtime";
import {
  afterAll,
  afterEach,
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
  sessionCookieHeader,
  readJson,
  type TestEnv,
} from "@/test/env";

let env: TestEnv;
let dispose: () => Promise<void>;

let forceBindingError = false;

const testRuntime = () => ({
  env: forceBindingError ? new Proxy(env, {
    get() { throw new Error("boom: unexpected internal failure"); },
  }) : env,
});

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

afterEach(() => {
  vi.unstubAllGlobals();
});

async function postCharge(cookie?: string, body: unknown = { plan: "premium" }) {
  const { POST } = bindRouteHandlers(await import("@/server/routes/billing/btc/charge/route"), testRuntime);

  return POST(
    new Request("http://localhost/api/billing/btc/charge", {
      method: "POST",
      headers: {
        Origin: "http://localhost",
        ...(cookie ? { cookie } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  );
}

function stubOpenNodeSuccess(chargeId: string, hostedCheckoutUrl: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { id: chargeId, hosted_checkout_url: hostedCheckoutUrl },
        }),
        { status: 201 }
      )
    )
  );
}

describe("POST /api/billing/btc/charge", () => {
  it("requires login", async () => {
    const response = await postCharge();

    expect(response.status).toBe(401);
  });

  it("returns 400 when plan is missing or invalid", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);

    const missing = await postCharge(cookie, {});
    const invalid = await postCharge(cookie, { plan: "free" });

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
  });

  it("creates a pending btc_payments row (with the requested plan) and returns the hosted checkout url on success", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);

    stubOpenNodeSuccess("charge-abc", "https://checkout.opennode.com/charge-abc");

    const response = await postCharge(cookie, { plan: "premium" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      hostedCheckoutUrl: "https://checkout.opennode.com/charge-abc",
    });

    const payment = await env.DB.prepare(
      `SELECT account_id, opennode_charge_id, status, plan, extends_plan_until FROM btc_payments WHERE opennode_charge_id = ?`
    )
      .bind("charge-abc")
      .first<{
        account_id: string;
        opennode_charge_id: string;
        status: string;
        plan: string;
        extends_plan_until: string | null;
      }>();

    expect(payment).toEqual({
      account_id: accountId,
      opennode_charge_id: "charge-abc",
      status: "pending",
      plan: "premium",
      // 支払い確定前はまだ延長先を確定させない(webhook側で計算する)。
      extends_plan_until: null,
    });
  });

  it("records the requested plan (premium) on the btc_payments row", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);

    stubOpenNodeSuccess("charge-prm", "https://checkout.opennode.com/charge-prm");

    await postCharge(cookie, { plan: "premium" });

    const payment = await env.DB.prepare(
      `SELECT plan FROM btc_payments WHERE opennode_charge_id = ?`
    )
      .bind("charge-prm")
      .first<{ plan: string }>();
    expect(payment?.plan).toBe("premium");
  });

  it("creates a pending Standard payment for its USD amount without granting the plan", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);
    stubOpenNodeSuccess("charge-standard", "https://checkout.opennode.com/charge-standard");
    const response = await postCharge(cookie, { plan: "standard" });
    expect(response.status).toBe(200);
    const fetchMock = vi.mocked(fetch);
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(requestBody.amount).toBe(env.OPENNODE_BTC_CHARGE_AMOUNT_USD_STANDARD);
    const payment = await env.DB.prepare("SELECT plan, status FROM btc_payments WHERE opennode_charge_id = ?").bind("charge-standard").first<{ plan: string; status: string }>();
    expect(payment).toEqual({ plan: "standard", status: "pending" });
    const account = await env.DB.prepare("SELECT plan FROM accounts WHERE id = ?").bind(accountId).first<{ plan: string }>();
    expect(account?.plan).toBe("free");
  });

  it("sends the plan-specific USD amount and a callback url derived from the request origin", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { id: "charge-xyz", hosted_checkout_url: "https://x.example/xyz" },
        }),
        { status: 201 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await postCharge(cookie, { plan: "premium" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.opennode.com/v1/charges",
      expect.objectContaining({ method: "POST" })
    );
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.amount).toBe(env.OPENNODE_BTC_CHARGE_AMOUNT_USD_PREMIUM);
    expect(requestBody.callback_url).toBe(
      "http://localhost/api/billing/btc/webhook"
    );
    expect(requestBody.success_url).toBe(
      "http://localhost/mypage/billing?checkout=success"
    );
  });

  it("sends the premium USD amount when plan=premium", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { id: "charge-prem", hosted_checkout_url: "https://x.example/prem" },
        }),
        { status: 201 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await postCharge(cookie, { plan: "premium" });

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.amount).toBe(env.OPENNODE_BTC_CHARGE_AMOUNT_USD_PREMIUM);
  });

  it("does not create a btc_payments row when OpenNode fails to create the charge", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 401 }))
    );

    const response = await postCharge(cookie, { plan: "premium" });

    expect(response.status).toBe(502);
    const body = await readJson<{ success: boolean }>(response);
    expect(body.success).toBe(false);

    const { results } = await env.DB.prepare(
      `SELECT * FROM btc_payments`
    ).all();
    expect(results).toHaveLength(0);
  });

  it("returns a generic 500 (without leaking internal error details) on unexpected failure", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);

    forceBindingError = true;

    try {
      const response = await postCharge(cookie, { plan: "premium" });

      expect(response.status).toBe(500);
      const body = await readJson<{ success: boolean; error: string }>(
        response
      );
      expect(body.success).toBe(false);
      expect(body.error).toBe("サーバー内部でエラーが発生しました");
    } finally {
      forceBindingError = false;
    }
  });
});
