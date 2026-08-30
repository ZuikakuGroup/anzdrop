import { getCloudflareContext } from "@opennextjs/cloudflare";
import Stripe from "stripe";
import { verifySession } from "@/lib/account/session";
import { withApiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/validate";
import {
  isManageableSubscriptionStatus,
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

      // 404(Stripe 側に該当 Subscription が無い)。retrieve の 404 は契約の
      // 削除だけでなく、テスト/ライブモードの取り違え・API キーや Stripe
      // アカウントの不一致・破損 ID でも起きる。ここで stripe_subscription_id を
      // 外すと、本物の削除だった場合に後続の署名検証済み
      // customer.subscription.deleted が契約 ID でアカウントを引けず、実際の
      // 失効が反映されなくなる。accounts は一切変更せず 409 だけ返す。
      if (statusCode === 404) {
        return Response.json(
          { success: false, error: "対象のプランが見つかりませんでした" },
          { status: 409 }
        );
      }

      // それ以外の一時的な障害は握りつぶさず 500 にして、状態を変えない。
      throw error;
    }

    // active / trialing に加えて past_due(更新の支払いに失敗して dunning
    // リトライ中)も「期間末で解約」の対象にする。past_due で解約できないと、
    // Stripe のリトライがあとから成功したときに、解約意思に反して次期分の
    // 請求が確定してしまう。自動更新を止める操作は課金を増やさないため安全。
    // incomplete(初回未確定)・canceled 等は対象外
    // (isManageableSubscriptionStatus = active/trialing/past_due)。
    if (!isManageableSubscriptionStatus(subscription.status)) {
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
