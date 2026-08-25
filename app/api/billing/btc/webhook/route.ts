import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyOpenNodeSignature } from "@/lib/opennode";
import { extendPaidPeriod } from "@/lib/plan";

type BtcPaymentRecord = {
  account_id: string;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const { env } = getCloudflareContext();

    // OpenNodeのWebhookはform-urlencodedで届く(JSONではない)。
    const form = await request.formData();
    const chargeId = form.get("id");
    const status = form.get("status");
    const hashedOrder = form.get("hashed_order");

    if (
      typeof chargeId !== "string" ||
      typeof status !== "string" ||
      typeof hashedOrder !== "string"
    ) {
      return Response.json(
        { success: false, error: "Malformed payload" },
        { status: 400 }
      );
    }

    const validSignature = await verifyOpenNodeSignature(
      chargeId,
      hashedOrder,
      env.OPENNODE_API_KEY
    );

    if (!validSignature) {
      return Response.json(
        { success: false, error: "Invalid signature" },
        { status: 400 }
      );
    }

    if (status !== "paid") {
      // processing/underpaid/expired等は無視してよい(paidになった時だけ反映)。
      return Response.json({ success: true });
    }

    // status='pending'のものだけを'paid'にUPDATEすることで、OpenNodeからの
    // 再送(リトライ)による有効期限の二重加算を防ぐ(1回目以降はchanges=0)。
    const updateResult = await env.DB.prepare(
      `
      UPDATE btc_payments
      SET status = 'paid'
      WHERE opennode_charge_id = ? AND status = 'pending'
    `
    )
      .bind(chargeId)
      .run();

    if (updateResult.meta.changes !== 1) {
      return Response.json({ success: true, note: "already processed" });
    }

    const payment = await env.DB.prepare(
      `SELECT account_id FROM btc_payments WHERE opennode_charge_id = ? LIMIT 1`
    )
      .bind(chargeId)
      .first<BtcPaymentRecord>();

    if (!payment) {
      return Response.json({ success: true });
    }

    const account = await env.DB.prepare(
      `SELECT plan_expires_at FROM accounts WHERE id = ? LIMIT 1`
    )
      .bind(payment.account_id)
      .first<{ plan_expires_at: string | null }>();

    const newExpiry = extendPaidPeriod(
      account?.plan_expires_at ?? null,
      env.OPENNODE_BTC_DAYS_PER_CHARGE
    );

    await env.DB.prepare(
      `UPDATE accounts SET plan = 'paid', plan_expires_at = ? WHERE id = ?`
    )
      .bind(newExpiry, payment.account_id)
      .run();

    await env.DB.prepare(
      `UPDATE btc_payments SET extends_plan_until = ? WHERE opennode_charge_id = ?`
    )
      .bind(newExpiry, chargeId)
      .run();

    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
