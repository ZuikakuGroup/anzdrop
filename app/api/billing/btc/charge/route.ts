import { getCloudflareContext } from "@opennextjs/cloudflare";
import Stripe from "stripe";
import { verifySession } from "@/lib/account/session";
import { verifySameOrigin } from "@/lib/access";
import { createCharge } from "@/lib/opennode";
import {
  isAdminGrantedPaidPlan,
  isPurchasablePlan,
  PLAN_LABELS,
} from "@/lib/plan";
import { isManageableSubscriptionStatus } from "@/lib/stripe-subscription";
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

    if (!verifySameOrigin(request, { allowMissing: false })) {
      return Response.json(
        { success: false, error: "不正なオリジンからのリクエストです" },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(request, ChargeRequestSchema);

    if (!parsed.ok) {
      return parsed.response;
    }

    const { plan } = parsed.data;

    // スキーマは standard/premium の両方を型として受けるが、実際に購入導線へ
    // 出しているプランだけを決済対象にする(Standard は提供準備中。Issue #5)。
    if (!isPurchasablePlan(plan)) {
      return Response.json(
        { success: false, error: "このプランは現在購入できません" },
        { status: 400 }
      );
    }

    // /admin 付与中は Bitcoin での追加契約も受け付けない。
    // 生きているカード契約がある場合は admin 付与ではない(期間チャージ可)。
    const account = await env.DB.prepare(
      `SELECT stripe_subscription_id FROM accounts WHERE id = ? LIMIT 1`
    )
      .bind(session.accountId)
      .first<{ stripe_subscription_id: string | null }>();

    let hasManageableStripeSubscription = false;

    if (account?.stripe_subscription_id) {
      try {
        const existing = await new Stripe(env.STRIPE_SECRET_KEY, {
          httpClient: Stripe.createFetchHttpClient(),
        }).subscriptions.retrieve(account.stripe_subscription_id);
        hasManageableStripeSubscription = isManageableSubscriptionStatus(
          existing.status
        );
      } catch (error) {
        // 404 だけ「契約なし」とみなす。レート制限・障害まで握りつぶすと、
        // カード契約中のアカウントを誤って admin 付与扱いにして 409 にする。
        const statusCode =
          error && typeof error === "object" && "statusCode" in error
            ? (error as { statusCode?: unknown }).statusCode
            : undefined;

        if (statusCode !== 404) {
          throw error;
        }
      }
    }

    if (
      await isAdminGrantedPaidPlan(env, session.accountId, {
        hasManageableStripeSubscription,
      })
    ) {
      return Response.json(
        {
          success: false,
          error:
            "運営により付与されたプランの利用中は、追加の契約はできません",
        },
        { status: 409 }
      );
    }

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
