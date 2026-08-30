import type { StripeSyncResponse } from "@/app/api/billing/stripe/sync/schema";
import type { Plan } from "@/lib/plan";
import type { StripeSubscriptionSummary } from "@/lib/stripe-subscription";

// /mypage(アカウント概要)と /mypage/billing の両方で使う、現在のプラン状態。
// POST /api/billing/stripe/sync の戻りをそのまま持つ(sync は Webhook 不達の
// 保険としてアカウントの Stripe Subscription を取り直し、あわせて画面表示用の
// サブスクリプション要約も返す)。
export type PlanStatus = {
  accountId: string;
  // 実効プラン。plan_expires_at が過去なら sync 側で "free" に倒れている。
  plan: Plan;
  planExpiresAt: string | null;
  subscription: StripeSubscriptionSummary | null;
};

export type PlanStatusResult =
  | { kind: "ok"; status: PlanStatus }
  // 401。呼び出し側で /mypage/login へ誘導する。
  | { kind: "unauthenticated" }
  // それ以外の失敗(サーバーエラー・ネットワーク断・不正なレスポンス)。
  // sync は Stripe 到達失敗でも 500 を返さない設計だが、DB エラー等では
  // 500 がありうる。500 で /mypage/login へ飛ばすとログイン済み判定で
  // 戻されループになるため、ここは「読み込みに失敗しました」表示に留める。
  | { kind: "error" };

export async function loadPlanStatus(): Promise<PlanStatusResult> {
  try {
    const response = await fetch("/api/billing/stripe/sync", {
      method: "POST",
    });

    if (response.status === 401) {
      return { kind: "unauthenticated" };
    }

    if (!response.ok) {
      return { kind: "error" };
    }

    const data = (await response.json()) as StripeSyncResponse;

    if (!data.success) {
      return { kind: "error" };
    }

    return {
      kind: "ok",
      status: {
        accountId: data.accountId,
        plan: data.plan,
        planExpiresAt: data.planExpiresAt,
        subscription: data.subscription,
      },
    };
  } catch {
    return { kind: "error" };
  }
}

// /mypage 下部の「プラン・お支払い」への導線ボタン。/mypage 自体は操作を持たず、
// 実際の解約・再開は /mypage/billing の管理ブロックで行うが、カード契約がある間は
// ボタンの主目的が「支払い」ではなく「契約の管理」になるため、文言を状態に合わせて
// 変える(遷移先は常に /mypage/billing)。
//
// tone は見た目の強調度。カード自動更新中(active)はこのボタンが「解約」の入り口に
// なるので、前進系の CTA と同じブランドカラー塗り(primary)ではなく控えめな
// アウトライン(neutral)にし、/mypage/billing 側の解約ボタンと視覚的に揃える。
// 解約予約中(canceling)は逆にこのボタンが「解約を取り消す=契約を続ける」復帰系の
// 操作で、期限を過ぎると無料に戻ってしまう状態なので、見つけやすい primary にする。
export type BillingCta = {
  label: string;
  tone: "primary" | "neutral";
};

export function describeBillingCta(
  subscriptionState: StripeSubscriptionSummary["state"] | null
): BillingCta {
  if (subscriptionState === "active") {
    return { label: "解約する", tone: "neutral" };
  }

  if (subscriptionState === "canceling") {
    return { label: "解約を取り消す", tone: "primary" };
  }

  return { label: "プラン・お支払いへ", tone: "primary" };
}

// 契約状態の表示用テキスト。/mypage で「現在のプラン」の下に添える。
export type ContractView = {
  stateLabel: string;
  detail: string | null;
  note: string | null;
};

function formatDate(iso: string | null | undefined): string | null {
  return iso ? new Date(iso).toLocaleDateString("ja-JP") : null;
}

export function describeContract(status: PlanStatus): ContractView {
  const { plan, planExpiresAt, subscription } = status;

  // 更新の支払いに失敗して dunning リトライ中。free に判定を先んじて出す。
  // このケースは更新失敗直後に plan_expires_at が過去へ回り実効プランが
  // すぐ free になりうるため、free ブロックの前で拾わないと「宙ぶらりんの
  // 購読を解約できる」ことに気づけなくなる。日付は出さない(支払い済みの
  // 期限は plan_expires_at 側だが、そこも past_due では更新されないため
  // 断定的な表示を避ける)。
  if (subscription?.state === "past_due") {
    return {
      stateLabel: "お支払いの確認中",
      detail: null,
      note: "自動更新の決済に失敗しています。決済が確認できない場合は無料プランへ戻ります。プランを続けない場合は /mypage/billing から自動更新を停止できます。お支払い方法の変更が必要なときはお問い合わせください。",
    };
  }

  // 実効プランが free。有料期限が切れた(Bitcoin 失効・解約後の期限到来)
  // 場合も sync 側で free に倒れているのでここに来る。
  if (plan === "free") {
    return { stateLabel: "無料プラン", detail: null, note: null };
  }

  // カードでの自動更新が有効。
  if (subscription?.state === "active") {
    const date = formatDate(subscription.currentPeriodEnd ?? planExpiresAt);
    return {
      stateLabel: "カードで自動更新中",
      detail: date ? `次回更新日: ${date}` : null,
      note: null,
    };
  }

  // 期間末で終了予定(自動更新は停止済み)。
  if (subscription?.state === "canceling") {
    const date = formatDate(subscription.currentPeriodEnd ?? planExpiresAt);
    return {
      stateLabel: "解約予約中",
      detail: date ? `有効期限: ${date}` : null,
      note: "自動更新は停止済みです。期限を過ぎると無料プランに戻ります。",
    };
  }

  // 有料プランだが Stripe Subscription を持たない = Bitcoin の期間チャージ
  // (または旧 "paid" 移行分)。自動更新はなく、期限が切れると free に戻る。
  const date = formatDate(planExpiresAt);
  return {
    stateLabel: "有効期限あり（自動更新なし）",
    detail: date ? `有効期限: ${date}` : null,
    note: "自動更新はありません。期限が切れる前に更新してください。",
  };
}
