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

afterEach(() => {
  vi.unstubAllGlobals();
});

async function postCharge(cookie?: string) {
  const { POST } = await import("@/app/api/billing/btc/charge/route");

  return POST(
    new Request("http://localhost/api/billing/btc/charge", {
      method: "POST",
      headers: cookie ? { cookie } : {},
    })
  );
}

describe("POST /api/billing/btc/charge", () => {
  it("requires login", async () => {
    const response = await postCharge();

    expect(response.status).toBe(401);
  });

  it("creates a pending btc_payments row and returns the hosted checkout url on success", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              id: "charge-abc",
              hosted_checkout_url: "https://checkout.opennode.com/charge-abc",
            },
          }),
          { status: 201 }
        )
      )
    );

    const response = await postCharge(cookie);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      hostedCheckoutUrl: "https://checkout.opennode.com/charge-abc",
    });

    const payment = await env.DB.prepare(
      `SELECT account_id, opennode_charge_id, status, extends_plan_until FROM btc_payments WHERE opennode_charge_id = ?`
    )
      .bind("charge-abc")
      .first<{
        account_id: string;
        opennode_charge_id: string;
        status: string;
        extends_plan_until: string | null;
      }>();

    expect(payment).toEqual({
      account_id: accountId,
      opennode_charge_id: "charge-abc",
      status: "pending",
      // 支払い確定前はまだ延長先を確定させない(webhook側で計算する)。
      extends_plan_until: null,
    });
  });

  it("sends the configured USD amount and a callback url derived from the request origin", async () => {
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

    await postCharge(cookie);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.opennode.com/v1/charges",
      expect.objectContaining({ method: "POST" })
    );
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.amount).toBe(env.OPENNODE_BTC_CHARGE_AMOUNT_USD);
    expect(requestBody.callback_url).toBe(
      "http://localhost/api/billing/btc/webhook"
    );
  });

  it("does not create a btc_payments row when OpenNode fails to create the charge", async () => {
    const { accountId } = await insertTestAccount(env);
    const cookie = await sessionCookieHeader(env, accountId);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 401 }))
    );

    const response = await postCharge(cookie);

    expect(response.status).toBe(502);
    const body = await readJson<{ success: boolean }>(response);
    expect(body.success).toBe(false);

    const { results } = await env.DB.prepare(
      `SELECT * FROM btc_payments`
    ).all();
    expect(results).toHaveLength(0);
  });
});
