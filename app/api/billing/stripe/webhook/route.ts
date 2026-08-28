import { getCloudflareContext } from "@opennextjs/cloudflare";
import Stripe from "stripe";
import { withApiHandler } from "@/lib/api/handler";
import type { Plan } from "@/lib/plan";

function unixSecondsToIso(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

// Stripeの新しいAPIバージョンでは、現在の請求期間の終了時刻は
// Subscription直下ではなく各SubscriptionItemに付く(複数アイテムがそれぞれ
// 別サイクルを持てるようになったため)。このアプリは1サブスクリプションに
// つき1アイテムのみ使うので、先頭アイテムの値をそのまま使う。
function getSubscriptionPeriodEnd(
  subscription: Stripe.Subscription
): number | null {
  return subscription.items.data[0]?.current_period_end ?? null;
}

// SubscriptionのPrice IDから、どのプランかを判定する。metadataではなく実際の
// Price IDを正とすることで、Stripeカスタマーポータル等で後からプランが変更
// された場合にも自動追従できる。未知のPrice IDはnullを返し、呼び出し元で
// 更新をスキップする(意図しないプラン活性化を防ぐ防御的な扱い)。
function planFromSubscription(
  subscription: Stripe.Subscription,
  env: CloudflareEnv
): Plan | null {
  const priceId = subscription.items.data[0]?.price?.id;

  if (priceId === env.STRIPE_PRICE_ID_STANDARD) {
    return "standard";
  }

  if (priceId === env.STRIPE_PRICE_ID_PREMIUM) {
    return "premium";
  }

  return null;
}

// 同一イベントの再送(Stripeはリトライしうる)による二重処理を防ぐ。
// 初めて見るイベントならtrueを返し、以後の処理を進めてよいことを示す。
async function markEventAsProcessedOnce(
  env: CloudflareEnv,
  eventId: string
): Promise<boolean> {
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO stripe_events (id, processed_at) VALUES (?, ?)`
  )
    .bind(eventId, new Date().toISOString())
    .run();

  return result.meta.changes === 1;
}

async function applyEvent(
  event: Stripe.Event,
  stripe: Stripe,
  env: CloudflareEnv
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const accountId = session.client_reference_id;
      const customerId =
        typeof session.customer === "string" ? session.customer : null;
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : null;

      if (!accountId || !customerId || !subscriptionId) {
        break;
      }

      const subscription = await stripe.subscriptions.retrieve(
        subscriptionId
      );
      const periodEnd = getSubscriptionPeriodEnd(subscription);
      const plan = planFromSubscription(subscription, env);

      if (!periodEnd || !plan) {
        break;
      }

      await env.DB.prepare(
        `
        UPDATE accounts
        SET plan = ?,
            plan_expires_at = ?,
            stripe_customer_id = ?,
            stripe_subscription_id = ?
        WHERE id = ?
      `
      )
        .bind(
          plan,
          unixSecondsToIso(periodEnd),
          customerId,
          subscriptionId,
          accountId
        )
        .run();

      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const isActive =
        subscription.status === "active" ||
        subscription.status === "trialing";
      const periodEnd = getSubscriptionPeriodEnd(subscription);
      const plan = planFromSubscription(subscription, env);

      if (isActive && periodEnd && plan) {
        await env.DB.prepare(
          `
          UPDATE accounts
          SET plan = ?, plan_expires_at = ?
          WHERE stripe_subscription_id = ?
        `
        )
          .bind(plan, unixSecondsToIso(periodEnd), subscription.id)
          .run();
      }

      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;

      // 即時ダウングレード。stripe_subscription_idは失効済みなので消しておく。
      await env.DB.prepare(
        `
        UPDATE accounts
        SET plan_expires_at = ?, stripe_subscription_id = NULL
        WHERE stripe_subscription_id = ?
      `
      )
        .bind(new Date().toISOString(), subscription.id)
        .run();

      break;
    }

    default:
      break;
  }
}

export const POST = withApiHandler(
  "POST /api/billing/stripe/webhook",
  async (request: Request): Promise<Response> => {
    const { env } = getCloudflareContext();

    const signature = request.headers.get("stripe-signature");
    const body = await request.text();

    if (!signature || !env.STRIPE_WEBHOOK_SECRET) {
      return Response.json(
        { success: false, error: "署名がありません" },
        { status: 400 }
      );
    }

    const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Cloudflare WorkersにはNodeのcryptoモジュールが無いため、SubtleCrypto経由の
    // 検証(constructEventAsync + createSubtleCryptoProvider)を使う。
    let event: Stripe.Event;

    try {
      event = await stripe.webhooks.constructEventAsync(
        body,
        signature,
        env.STRIPE_WEBHOOK_SECRET,
        undefined,
        Stripe.createSubtleCryptoProvider()
      );
    } catch {
      return Response.json(
        { success: false, error: "署名が正しくありません" },
        { status: 400 }
      );
    }

    if (!(await markEventAsProcessedOnce(env, event.id))) {
      return Response.json({ success: true, note: "duplicate event" });
    }

    try {
      await applyEvent(event, stripe, env);
    } catch (error) {
      // 処理中に失敗した場合は「処理済み」のマークを取り消す。マークした
      // ままにすると、Stripeが同じイベントIDで再送してきても
      // markEventAsProcessedOnceが「重複」と誤判定し、二度とプランが
      // 反映されなくなってしまう(顧客は決済済みなのにアップグレードされない)。
      await env.DB.prepare(`DELETE FROM stripe_events WHERE id = ?`)
        .bind(event.id)
        .run();

      throw error;
    }

    return Response.json({ success: true });
  }
);
