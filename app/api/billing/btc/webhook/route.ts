import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyOpenNodeSignature } from "@/lib/opennode";
import { extendPaidPeriod, getAccountPlanInfo, PLAN_RANK, type Plan } from "@/lib/plan";
import { withApiHandler } from "@/lib/api/handler";

type BtcPaymentRecord = {
  account_id: string;
  plan: Plan;
};

export const POST = withApiHandler(
  "POST /api/billing/btc/webhook",
  async (request: Request): Promise<Response> => {
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
      `SELECT account_id, plan FROM btc_payments WHERE opennode_charge_id = ? LIMIT 1`
    )
      .bind(chargeId)
      .first<BtcPaymentRecord>();

    if (!payment) {
      return Response.json({ success: true });
    }

    const { plan: currentEffectivePlan, planExpiresAt: currentExpiresAt } =
      await getAccountPlanInfo(payment.account_id, env);

    // 既にアクティブな上位プラン(例: premium)を、より安価なプラン
    // (例: standard)の支払いで誤って格下げしない。有効期限はどちらの
    // 場合も延長する(支払った分は無駄にしない)。
    const newPlan =
      PLAN_RANK[currentEffectivePlan] > PLAN_RANK[payment.plan]
        ? currentEffectivePlan
        : payment.plan;

    const newExpiry = extendPaidPeriod(
      currentExpiresAt,
      env.OPENNODE_BTC_DAYS_PER_CHARGE
    );

    await env.DB.prepare(
      `UPDATE accounts SET plan = ?, plan_expires_at = ? WHERE id = ?`
    )
      .bind(newPlan, newExpiry, payment.account_id)
      .run();

    await env.DB.prepare(
      `UPDATE btc_payments SET extends_plan_until = ? WHERE opennode_charge_id = ?`
    )
      .bind(newExpiry, chargeId)
      .run();

    return Response.json({ success: true });
  }
);
