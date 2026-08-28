import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifySession } from "@/lib/account/session";
import { createCharge } from "@/lib/opennode";
import { PLAN_LABELS } from "@/lib/plan";
import { withApiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/validate";
import {
  ChargeRequestSchema,
  type ChargeResponse,
} from "@/app/api/billing/btc/charge/schema";

const OPENNODE_BTC_CHARGE_AMOUNT_USD_BY_PLAN = {
  standard: "OPENNODE_BTC_CHARGE_AMOUNT_USD_STANDARD",
  premium: "OPENNODE_BTC_CHARGE_AMOUNT_USD_PREMIUM",
} as const;

export const POST = withApiHandler(
  "POST /api/billing/btc/charge",
  async (request: Request): Promise<Response> => {
    const { env } = getCloudflareContext();
    const session = await verifySession(request, env);

    if (!session) {
      return Response.json(
        { success: false, error: "ログインが必要です" },
        { status: 401 }
      );
    }

    const parsed = await parseJsonBody(request, ChargeRequestSchema);

    if (!parsed.ok) {
      return parsed.response;
    }

    const { plan } = parsed.data;
    const amountUsd =
      env[OPENNODE_BTC_CHARGE_AMOUNT_USD_BY_PLAN[plan]];

    const paymentId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const origin = new URL(request.url).origin;

    const charge = await createCharge({
      amountUsd,
      orderId: paymentId,
      description: `Anzdrop ${PLAN_LABELS[plan]} (${env.OPENNODE_BTC_DAYS_PER_CHARGE} days)`,
      callbackUrl: `${origin}/api/billing/btc/webhook`,
      successUrl: `${origin}/mypage/billing?checkout=success`,
      apiKey: env.OPENNODE_API_KEY,
    });

    if (!charge.success) {
      return Response.json(
        { success: false, error: charge.error },
        { status: 502 }
      );
    }

    // extends_plan_until(実際に延長する有効期限)は、支払いが確定した時点の
    // アカウントの状態(既存の有効期限に上乗せするか等)を見て決めるため、
    // ここではまだ確定させずwebhook側で計算・反映する。
    await env.DB.prepare(
      `
      INSERT INTO btc_payments (
        id,
        account_id,
        opennode_charge_id,
        status,
        plan,
        created_at
      )
      VALUES (?, ?, ?, 'pending', ?, ?)
    `
    )
      .bind(paymentId, session.accountId, charge.chargeId, plan, createdAt)
      .run();

    const responseBody: ChargeResponse = {
      success: true,
      hostedCheckoutUrl: charge.hostedCheckoutUrl,
    };

    return Response.json(responseBody);
  }
);
