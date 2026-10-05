import {
  getAccountPlanInfo,
  normalizeStoredPlan,
  PLAN_RANK,
  type Plan,
} from "@/lib/plan";

// まだ消費し切っていない Bitcoin 前払いがあるか。admin 付与との区別に使う
// (plan_source 列は持たない方針のため、有効な btc_payments の有無で推論する)。
export async function hasLiveBtcPrepaidPlan(
  env: CloudflareEnv,
  accountId: string,
  nowIso: string = new Date().toISOString()
): Promise<boolean> {
  const row = await env.DB.prepare(
    `
    SELECT 1 AS ok
    FROM btc_payments
    WHERE account_id = ?
      AND status = 'paid'
      AND extends_plan_until IS NOT NULL
      AND extends_plan_until > ?
    LIMIT 1
  `
  )
    .bind(accountId, nowIso)
    .first<{ ok: number }>();

  return row !== null;
}

// 初回支払い未確定のまま失効した Subscription のポインタだけ外す。
// plan / plan_expires_at は触らない(admin 付与を消さないため)。
export async function clearNeverActivatedSubscriptionPointer(
  env: CloudflareEnv,
  match: { subscriptionId: string; accountId?: string }
): Promise<void> {
  if (match.accountId) {
    await env.DB.prepare(
      `
      UPDATE accounts
      SET stripe_subscription_id = NULL
      WHERE id = ? AND stripe_subscription_id = ?
    `
    )
      .bind(match.accountId, match.subscriptionId)
      .run();
    return;
  }

  await env.DB.prepare(
    `
    UPDATE accounts
    SET stripe_subscription_id = NULL
    WHERE stripe_subscription_id = ?
  `
  )
    .bind(match.subscriptionId)
    .run();
}

// カード契約が終端(Webhookの customer.subscription.deleted、または sync が読み取る
// canceled / unpaid)に達したときの「即時ダウングレード」。
// 追跡用の stripe_subscription_id を外し、plan / plan_expires_at を「カードが
// 無くなった後に実際に有効な状態」へ合わせ直す。
//
// カードが終端に達したあと有効期間を支えるのは Bitcoin の「期間チャージ」だけなので、
//   - plan_expires_at: まだ期限が未来にある 'paid' な btc_payments の最も遠い
//     extends_plan_until。無ければ現在時刻(＝即時失効)。
//   - plan: そのまだ有効な 'paid' な btc_payments が支払った最上位のプラン
//     (btc_payments.plan)。無ければ free。
//
// これにより「カードで premium 契約中にカードが dunning → その間に standard を
// Bitcoin で前払い → カード終端」というケースで、standard 分しか支払っていないのに
// premium が残り続けることを防ぐ。カードと Bitcoin を同時には持たせない運用でも、
// 「カード期間末解約 → その後 Bitcoin で前払い → カード期間末に deleted が届く」
// という切り替えの順序では両方の情報が一時的に accounts に載るため、この整理が要る。
//
// なお extends_plan_until には「カードの請求期間末 + Bitcoin の日数」が入っている
// (extendPaidPeriod が既存の期限に積み増すため)。カードのチャージバック・返金で
// 即時失効させたい不正対応では、この「カード期間分」まで残ってしまう。その場合は
// サポートが accounts.plan_expires_at を手で戻す(docs/accounts.md 参照)。
export async function downgradeExpiredCardPlan(
  env: CloudflareEnv,
  match: { subscriptionId: string; accountId?: string }
): Promise<void> {
  const nowIso = new Date().toISOString();

  const accountId =
    match.accountId ??
    (
      await env.DB.prepare(
        `SELECT id FROM accounts WHERE stripe_subscription_id = ? LIMIT 1`
      )
        .bind(match.subscriptionId)
        .first<{ id: string }>()
    )?.id;

  if (!accountId) {
    return;
  }

  // まだ期限が未来にある(＝消費し切っていない) 'paid' な Bitcoin 前払いだけを見る。
  const { results: liveBtcPayments } = await env.DB.prepare(
    `
    SELECT plan, extends_plan_until
    FROM btc_payments
    WHERE account_id = ?
      AND status = 'paid'
      AND extends_plan_until IS NOT NULL
      AND extends_plan_until > ?
  `
  )
    .bind(accountId, nowIso)
    .all<{ plan: string; extends_plan_until: string }>();

  let nextExpiresAt = nowIso;
  let nextPlan: Plan = "free";

  for (const payment of liveBtcPayments) {
    if (payment.extends_plan_until > nextExpiresAt) {
      nextExpiresAt = payment.extends_plan_until;
    }

    const paidPlan = normalizeStoredPlan(payment.plan);

    if (PLAN_RANK[paidPlan] > PLAN_RANK[nextPlan]) {
      nextPlan = paidPlan;
    }
  }

  // WHERE に stripe_subscription_id も含め、id 特定後にアカウントが別の
  // Subscription へ切り替わっていた場合の取り違えを防ぐ(sync と揃える)。
  await env.DB.prepare(
    `
    UPDATE accounts
    SET plan = ?, plan_expires_at = ?, stripe_subscription_id = NULL
    WHERE id = ? AND stripe_subscription_id = ?
  `
  )
    .bind(nextPlan, nextExpiresAt, accountId, match.subscriptionId)
    .run();
}

// 実効有料プランがあり、生きているカード契約も Bitcoin 前払いもない
// (= /admin からの手動付与とみなす)。追加契約を止める判定に使う。
export async function isAdminGrantedPaidPlan(
  env: CloudflareEnv,
  accountId: string,
  options: { hasManageableStripeSubscription: boolean }
): Promise<boolean> {
  if (options.hasManageableStripeSubscription) {
    return false;
  }

  const { plan } = await getAccountPlanInfo(accountId, env);

  if (plan === "free") {
    return false;
  }

  return !(await hasLiveBtcPrepaidPlan(env, accountId));
}
