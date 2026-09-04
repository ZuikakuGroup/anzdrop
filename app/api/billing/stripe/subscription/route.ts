import { getCloudflareContext } from "@opennextjs/cloudflare";
import Stripe from "stripe";
import { verifySession } from "@/lib/account/session";
import { withApiHandler } from "@/lib/api/handler";
import { checkRateLimit } from "@/lib/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { isDeadSubscriptionStatus } from "@/lib/stripe-subscription";
import { isPurchasablePlan } from "@/lib/plan";
import {
  SubscriptionRequestSchema,
  type SubscriptionResponse,
} from "@/app/api/billing/stripe/subscription/schema";

const STRIPE_PRICE_ID_BY_PLAN = {
  standard: "STRIPE_PRICE_ID_STANDARD",
  premium: "STRIPE_PRICE_ID_PREMIUM",
} as const;

// Stripe SDKの例外はHTTPステータスを statusCode で持つ。該当リソースが
// 既に存在しない(404)ケースだけを他の失敗(429・5xx・タイムアウト等の
// 一時障害)と区別するために使う。
function getStripeErrorStatusCode(error: unknown): number | undefined {
  if (error && typeof error === "object" && "statusCode" in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    return typeof statusCode === "number" ? statusCode : undefined;
  }
  return undefined;
}

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

    // アカウント単位のレート制限(GitHub issue #81)。sync より重く、Stripe 側に
    // Customer / Subscription という実オブジェクトを作る経路なので、
    // 同じ ACCOUNT_RATE_LIMITER の枠を共有して連打を頭打ちにする。
    const accountLimit = await checkRateLimit(
      env.ACCOUNT_RATE_LIMITER,
      session.accountId,
      "POST /api/billing/stripe/subscription"
    );

    if (!accountLimit.ok) {
      return accountLimit.response;
    }

    const parsed = await parseJsonBody(request, SubscriptionRequestSchema);

    if (!parsed.ok) {
      return parsed.response;
    }

    // スキーマは standard/premium の両方を型として受けるが、実際に購入導線へ
    // 出しているプランだけを決済対象にする(Standard は提供準備中。Issue #5)。
    if (!isPurchasablePlan(parsed.data.plan)) {
      return Response.json(
        { success: false, error: "このプランは現在購入できません" },
        { status: 400 }
      );
    }

    const priceId = env[STRIPE_PRICE_ID_BY_PLAN[parsed.data.plan]];

    const account = await env.DB.prepare(
      `SELECT stripe_customer_id, stripe_subscription_id FROM accounts WHERE id = ? LIMIT 1`
    )
      .bind(session.accountId)
      .first<{
        stripe_customer_id: string | null;
        stripe_subscription_id: string | null;
      }>();

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

    // 既に有効(active/trialing)なSubscriptionを持つ状態で新規作成を許すと、
    // 二重に課金対象のSubscriptionが残ってしまう。この呼び出し自体には
    // プラン変更・アップグレードの機能はまだ無いため、既に有効な場合は
    // ここで止める(プラン変更が必要な場合は別途サポート対応)。
    if (account.stripe_subscription_id) {
      try {
        const existing = await stripe.subscriptions.retrieve(
          account.stripe_subscription_id
        );

        // active/trialing はもちろん、past_due(更新の支払いに失敗して dunning
        // リトライ中)も「まだ生きている Subscription」なので、ここで新規作成を
        // 許すと dunning 回復時に2本が同時に課金対象になる。プラン変更・支払い
        // 方法の更新はまだ self-service では無いためサポート対応に寄せる。
        if (
          existing.status === "active" ||
          existing.status === "trialing" ||
          existing.status === "past_due"
        ) {
          return Response.json(
            {
              success: false,
              error:
                "既に有効なプランのお支払いが設定されています。プランの変更が必要な場合はお問い合わせください。",
            },
            { status: 409 }
          );
        }

        // "incomplete"(初回の支払いが未確定のまま放置されている)と "unpaid"
        // (更新の dunning を尽くしても支払われず終端になったが、Stripe 側では
        // キャンセルされず残っている)は、どちらも新規作成の前に明示的に
        // キャンセルする。前者は古い client_secret が Stripe の自動期限切れ
        // (約23時間後)まで有効なまま残り、古い方で支払いが確定すると2本が
        // 有効化されうる。後者は sync 側も isDeadSubscriptionStatus で終端扱いに
        // して stripe_subscription_id を外すため、ここでキャンセルしないと
        // 追跡できない Subscription が Stripe に残ってしまう(扱いを sync と揃える)。
        if (
          existing.status === "incomplete" ||
          existing.status === "unpaid"
        ) {
          try {
            await stripe.subscriptions.cancel(account.stripe_subscription_id);
          } catch (cancelError) {
            // キャンセルが失敗しても新規作成へ進んでよいのは、旧Subscriptionが
            // もう課金対象になり得ないことを確認できた場合だけ。
            //  - 404: 既にStripe側から消えている。
            //  - retrieve し直して終端ステータス(incomplete_expired 等): retrieve
            //    と cancel の間にStripeの自動失効が走ったレース。cancel は 404 では
            //    なく 400 を返すため、ステータスで判定する。
            // 429・5xx・タイムアウト等の一時障害では、旧 "incomplete" の
            // client_secret(約23時間有効)が生きたまま2本目を作ってしまう
            // おそれがあるため、新規作成へ進まず失敗させる。
            if (getStripeErrorStatusCode(cancelError) !== 404) {
              let stillBillable = true;
              try {
                const recheck = await stripe.subscriptions.retrieve(
                  account.stripe_subscription_id
                );
                stillBillable = !isDeadSubscriptionStatus(recheck.status);
              } catch (recheckError) {
                if (getStripeErrorStatusCode(recheckError) === 404) {
                  stillBillable = false;
                } else {
                  throw recheckError;
                }
              }

              if (stillBillable) {
                throw cancelError;
              }
            }
          }
        }
      } catch (error) {
        // retrieve の失敗、および上のキャンセル処理が再throwした一時障害が
        // ここに来る。404(該当Subscriptionが既に存在しない。削除済み等)の
        // 場合のみ新規作成を妨げない。それ以外(Stripe側の一時的な障害等)まで
        // ここで握りつぶすと、実際には有効なSubscriptionがあるにも
        // かかわらず二重にSubscriptionを作成してしまいかねない。
        if (getStripeErrorStatusCode(error) !== 404) {
          throw error;
        }
      }
    }

    // このアプリはメールアドレスを収集しないため、Customerには紐づける
    // 個人情報を渡さない(支払い方法とStripe側の顧客IDだけを保持する)。
    let customerId = account.stripe_customer_id;

    if (!customerId) {
      customerId = (await stripe.customers.create()).id;

      // subscriptions.create()がこの後失敗しても、作成済みのCustomerが
      // 未記録の孤児にならないよう、ここで一度確定させておく。
      await env.DB.prepare(
        `UPDATE accounts SET stripe_customer_id = ? WHERE id = ?`
      )
        .bind(customerId, session.accountId)
        .run();
    }

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
    // stripe_customer_idは既に確定済みだが、念のため同じUPDATEで再度合わせておく。
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
