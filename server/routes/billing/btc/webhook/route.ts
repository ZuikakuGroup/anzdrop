import { getWorkerRuntime } from "@/server/runtime";
import { verifyOpenNodeSignature } from "@/lib/opennode";
import { extendPaidPeriod, effectivePlan, normalizeStoredPlan, PLAN_RANK, type Plan } from "@/lib/plan";
import { withApiHandler } from "@/lib/api/handler";
import { readBodyWithinLimit } from "@/lib/api/body";

type BtcPaymentRecord = {
  id: string;
  account_id: string;
  plan: Plan;
  status: string;
};

export const POST = withApiHandler(
  "POST /api/billing/btc/webhook",
  async (request: Request): Promise<Response> => {
    const { env } = getWorkerRuntime();

    // OpenNodeのWebhookはform-urlencodedで届く(JSONではない)。
    const rawBody = await readBodyWithinLimit(request, 64 * 1024);
    if (!rawBody) {
      return Response.json(
        { success: false, error: "リクエストサイズが上限を超えています" },
        { status: 413 }
      );
    }
    const form = new URLSearchParams(new TextDecoder().decode(rawBody));
    const chargeId = form.get("id");
    const status = form.get("status");
    const hashedOrder = form.get("hashed_order");

    if (
      typeof chargeId !== "string" ||
      typeof status !== "string" ||
      typeof hashedOrder !== "string"
    ) {
      return Response.json(
        { success: false, error: "リクエストの形式が不正です" },
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
        { success: false, error: "署名が正しくありません" },
        { status: 400 }
      );
    }

    if (status !== "paid") {
      // processing/underpaid/expired等は無視してよい(paidになった時だけ反映)。
      return Response.json({ success: true });
    }

    // 既存列だけで決済と付与を同一トランザクションにする。アカウントの
    // 読取後に別決済や管理更新が入った場合は、最新値を読み直して再計算する。
    for (let attempt = 0; attempt < 5; attempt++) {
      const payment = await env.DB.prepare(
        `SELECT id, account_id, plan, status FROM btc_payments WHERE opennode_charge_id = ? LIMIT 1`
      ).bind(chargeId).first<BtcPaymentRecord>();
      if (!payment || payment.status !== "pending") {
        return Response.json({ success: true, note: "already processed" });
      }
      const account = await env.DB.prepare(
        `SELECT plan, plan_expires_at FROM accounts WHERE id = ? LIMIT 1`
      ).bind(payment.account_id).first<{ plan: string; plan_expires_at: string | null }>();
      if (!account) return Response.json({ success: true });
      const currentPlan = effectivePlan(normalizeStoredPlan(account.plan), account.plan_expires_at);
      const newPlan = PLAN_RANK[currentPlan] > PLAN_RANK[payment.plan] ? currentPlan : payment.plan;
      const newExpiry = extendPaidPeriod(account.plan_expires_at, env.OPENNODE_BTC_DAYS_PER_CHARGE);
      const results = await env.DB.batch([
        env.DB.prepare(`UPDATE accounts SET plan = ?, plan_expires_at = ?
          WHERE id = ? AND plan = ? AND plan_expires_at IS ?
            AND EXISTS (SELECT 1 FROM btc_payments WHERE id = ? AND status = 'pending')`)
          .bind(newPlan, newExpiry, payment.account_id, account.plan, account.plan_expires_at, payment.id),
        // changes()は直前のUPDATEの更新行数。競合時に0行なら決済も確定しない。
        env.DB.prepare(`UPDATE btc_payments SET status = 'paid', extends_plan_until = ?
          WHERE id = ? AND status = 'pending' AND changes() = 1`)
          .bind(newExpiry, payment.id),
      ]);
      if (results[0].meta.changes === 1) return Response.json({ success: true });
    }
    // 高競合時も処理済みにはせず、Webhookの再送で再試行する。
    throw new Error("Bitcoin settlement conflicted repeatedly");
  }
);
