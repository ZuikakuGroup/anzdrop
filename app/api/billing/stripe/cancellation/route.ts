import { getCloudflareContext } from "@opennextjs/cloudflare";
import Stripe from "stripe";
import { verifySession } from "@/lib/account/session";
import { withApiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/validate";
import {
  isActiveSubscriptionStatus,
  toSubscriptionSummary,
} from "@/lib/stripe-subscription";
import {
  CancellationRequestSchema,
  type CancellationResponse,
} from "@/app/api/billing/stripe/cancellation/schema";

// カード契約(自動更新サブスク)の「期間末での解約」と、その取り消し(再開)。
// 即時解約や日割り返金は行わない。cancel_at_period_end を切り替えるだけで、
// 実際のプラン失効は期間末に Stripe が発火する customer.subscription.deleted
// (既存の Webhook 処理)に委ねる。サーバーへ新しい情報は保存しない。
export const POST = withApiHandler(
  "POST /api/billing/stripe/cancellation",
  async (request: Request): Promise<Response> => {
    const { env } = getCloudflareContext();
    const session = await verifySession(request, env);

    if (!session) {
      return Response.json(
        { success: false, error: "ログインが必要です" },
        { status: 401 }
      );
    }

    const parsed = await parseJsonBody(request, CancellationRequestSchema);

    if (!parsed.ok) {
      return parsed.response;
    }

    const account = await env.DB.prepare(
      `SELECT stripe_subscription_id FROM accounts WHERE id = ? LIMIT 1`
    )
      .bind(session.accountId)
      .first<{ stripe_subscription_id: string | null }>();

    if (!account?.stripe_subscription_id) {
      return Response.json(
        { success: false, error: "自動更新のプランに加入していません" },
        { status: 409 }
      );
    }

    const subscriptionId = account.stripe_subscription_id;

    const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
    });

    let subscription: Stripe.Subscription;

    try {
      subscription = await stripe.subscriptions.retrieve(subscriptionId);
    } catch (error) {
      const statusCode =
        error && typeof error === "object" && "statusCode" in error
          ? (error as { statusCode?: unknown }).statusCode
          : undefined;

      // 404 のときだけ、既に存在しない Subscription の追跡を外して 409 を返す。
      // それ以外の一時的な障害は握りつぶさず 500 にして、状態を変えない。
      if (statusCode === 404) {
        await env.DB.prepare(
          `UPDATE accounts SET stripe_subscription_id = NULL
           WHERE id = ? AND stripe_subscription_id = ?`
        )
          .bind(session.accountId, subscriptionId)
          .run();

        return Response.json(
          { success: false, error: "対象のプランが見つかりませんでした" },
          { status: 409 }
        );
      }

      throw error;
    }

    // active / trialing 以外(incomplete・past_due・canceled 等)は
    // 「期間末で解約」という操作の対象にならない。
    if (!isActiveSubscriptionStatus(subscription.status)) {
      return Response.json(
        { success: false, error: "このプランは解約できる状態ではありません" },
        { status: 409 }
      );
    }

    const updated = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: parsed.data.cancelAtPeriodEnd,
    });

    const responseBody: CancellationResponse = {
      success: true,
      subscription: toSubscriptionSummary(updated),
    };

    return Response.json(responseBody);
  }
);
