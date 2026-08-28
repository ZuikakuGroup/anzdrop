import { getCloudflareContext } from "@opennextjs/cloudflare";
import Stripe from "stripe";
import { verifySession } from "@/lib/account/session";
import { withApiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/validate";
import {
  CheckoutRequestSchema,
  type CheckoutResponse,
} from "@/app/api/billing/stripe/checkout/schema";

const STRIPE_PRICE_ID_BY_PLAN = {
  standard: "STRIPE_PRICE_ID_STANDARD",
  premium: "STRIPE_PRICE_ID_PREMIUM",
} as const;

export const POST = withApiHandler(
  "POST /api/billing/stripe/checkout",
  async (request: Request): Promise<Response> => {
    const { env } = getCloudflareContext();
    const session = await verifySession(request, env);

    if (!session) {
      return Response.json(
        { success: false, error: "Login required" },
        { status: 401 }
      );
    }

    const parsed = await parseJsonBody(request, CheckoutRequestSchema);

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
        { success: false, error: "Account not found" },
        { status: 404 }
      );
    }

    // CloudflareWorkers上ではNode標準のHTTPクライアントが使えないため、
    // fetchベースのHTTPクライアントを明示的に指定する。
    const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
    });

    const origin = new URL(request.url).origin;

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer: account.stripe_customer_id ?? undefined,
      client_reference_id: session.accountId,
      subscription_data: {
        metadata: { accountId: session.accountId, plan: parsed.data.plan },
      },
      success_url: `${origin}/mypage/billing?checkout=success`,
      cancel_url: `${origin}/mypage/billing?checkout=cancelled`,
    });

    if (!checkoutSession.url) {
      return Response.json(
        { success: false, error: "Failed to create checkout session" },
        { status: 500 }
      );
    }

    const responseBody: CheckoutResponse = {
      success: true,
      url: checkoutSession.url,
    };

    return Response.json(responseBody);
  }
);
