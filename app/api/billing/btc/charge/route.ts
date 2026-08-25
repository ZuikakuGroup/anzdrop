import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifySession } from "@/lib/account/session";
import { createCharge } from "@/lib/opennode";

type ChargeResponse =
  | { success: true; hostedCheckoutUrl: string }
  | { success: false; error: string };

export async function POST(request: Request): Promise<Response> {
  try {
    const { env } = getCloudflareContext();
    const session = await verifySession(request, env);

    if (!session) {
      return Response.json(
        { success: false, error: "Login required" },
        { status: 401 }
      );
    }

    const paymentId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const origin = new URL(request.url).origin;

    const charge = await createCharge({
      amountUsd: env.OPENNODE_BTC_CHARGE_AMOUNT_USD,
      orderId: paymentId,
      description: `Anzdrop paid plan (${env.OPENNODE_BTC_DAYS_PER_CHARGE} days)`,
      callbackUrl: `${origin}/api/billing/btc/webhook`,
      successUrl: `${origin}/billing?checkout=success`,
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
        created_at
      )
      VALUES (?, ?, ?, 'pending', ?)
    `
    )
      .bind(paymentId, session.accountId, charge.chargeId, createdAt)
      .run();

    const responseBody: ChargeResponse = {
      success: true,
      hostedCheckoutUrl: charge.hostedCheckoutUrl,
    };

    return Response.json(responseBody);
  } catch (error) {
    const responseBody: ChargeResponse = {
      success: false,
      error: String(error),
    };

    return Response.json(responseBody, { status: 500 });
  }
}
