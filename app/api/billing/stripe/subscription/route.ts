import { getCloudflareContext } from "@opennextjs/cloudflare";
import Stripe from "stripe";
import { verifySession } from "@/lib/account/session";
import { withApiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/validate";
import {
  SubscriptionRequestSchema,
  type SubscriptionResponse,
} from "@/app/api/billing/stripe/subscription/schema";

const STRIPE_PRICE_ID_BY_PLAN = {
  standard: "STRIPE_PRICE_ID_STANDARD",
  premium: "STRIPE_PRICE_ID_PREMIUM",
} as const;

export const POST = withApiHandler(
  "POST /api/billing/stripe/subscription",
  async (request: Request): Promise<Response> => {
    const { env } = getCloudflareContext();
    const session = await verifySession(request, env);

    if (!session) {
      return Response.json(
        { success: false, error: "ログインが必要です" },
        { status: 401 }
      );
    }

    const parsed = await parseJsonBody(request, SubscriptionRequestSchema);

    if (!parsed.ok) {
      return parsed.response;
    }

    const priceId = env[STRIPE_PRICE_ID_BY_PLAN[parsed.data.plan]];

    const account = await env.DB.prepare(
      `SELECT stripe_customer_id FROM accounts WHERE id = ? LIMIT 1`
    )
      .bind(session.accountId)
      .first<{ stripe_customer_id: string | null }>();

    if (!account) {
      return Response.json(
        { success: false, error: "アカウントが見つかりません" },
        { status: 404 }
      );
    }

    // CloudflareWorkers上ではNode標準のHTTPクライアントが使えないため、
    // fetchベースのHTTPクライアントを明示的に指定する。
    const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
    });

    // このアプリはメールアドレスを収集しないため、Customerには紐づける
    // 個人情報を渡さない(支払い方法とStripe側の顧客IDだけを保持する)。
    const customerId =
      account.stripe_customer_id ?? (await stripe.customers.create()).id;

    // payment_behavior: "default_incomplete"により、Subscriptionは
    // "incomplete"状態で作成され、クライアント側でPaymentElement経由の
    // 決済確定が完了して初めて"active"へ遷移する。未確定のまま放置された
    // 場合はStripe側が自動的に期限切れにする(サーバー側でのクリーンアップは不要)。
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      payment_settings: {
        payment_method_types: ["card"],
        save_default_payment_method: "on_subscription",
      },
      expand: ["latest_invoice.confirmation_secret"],
      metadata: { accountId: session.accountId, plan: parsed.data.plan },
    });

    // Stripeの新しいAPIバージョンでは、Invoiceは複数の支払い試行(payments)を
    // 持てるようになったため、確定用のclient_secretはpayment_intentではなく
    // confirmation_secretから取得する。confirmation_secretはInvoice自体を
    // expandしても自動では付かず、明示的に"latest_invoice.confirmation_secret"を
    // expandする必要がある。
    const invoice = subscription.latest_invoice;
    const clientSecret =
      typeof invoice === "object" && invoice !== null
        ? invoice.confirmation_secret?.client_secret ?? null
        : null;

    if (!clientSecret) {
      return Response.json(
        { success: false, error: "決済の準備に失敗しました" },
        { status: 500 }
      );
    }

    // customer.subscription.updated Webhookが"active"への遷移をこの
    // stripe_subscription_idで突き合わせて検知できるよう、支払い確定前の
    // この時点で書き込んでおく(plan/plan_expires_atはまだ変更しない)。
    await env.DB.prepare(
      `UPDATE accounts SET stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?`
    )
      .bind(customerId, subscription.id, session.accountId)
      .run();

    const responseBody: SubscriptionResponse = {
      success: true,
      clientSecret,
    };

    return Response.json(responseBody);
  }
);
