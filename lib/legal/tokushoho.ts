import {
  PLAN_LABELS,
  PLAN_MONTHLY_PRICE_JPY,
  type Plan,
} from "@/lib/plan";
import { OPERATOR, OPERATOR_GROUP_LABEL } from "@/lib/legal/constants";

// 特定商取引法第11条に基づく通信販売の表示。表示項目と本文を1か所にまとめ、
// 価格などプランに依存する値は lib/plan.ts の単一の情報源から組み立てる
// (料金表と表記がずれないようにするため)。
export type TokushohoItem = {
  label: string;
  // 段落として表示する。複数要素は改行区切り。
  lines: string[];
};

const PAID_PLANS: Exclude<Plan, "free">[] = ["standard", "premium"];

function priceLines(): string[] {
  const perPlan = PAID_PLANS.map(
    (plan) =>
      `${PLAN_LABELS[plan]}: 月額 ${PLAN_MONTHLY_PRICE_JPY[
        plan
      ].toLocaleString("ja-JP")}円(税込)`
  );

  return perPlan;
}

export function buildTokushohoItems(): TokushohoItem[] {
  return [
    {
      label: "販売事業者",
      lines: [OPERATOR_GROUP_LABEL],
    },
    {
      label: "運営統括責任者",
      lines: [OPERATOR.representative],
    },
    {
      label: "所在地",
      lines: [OPERATOR.address],
    },
    {
      label: "電話番号",
      lines: [OPERATOR.phone],
    },
    {
      label: "連絡先",
      lines: [
        OPERATOR.email,
      ],
    },
    {
      label: "販売価格",
      lines: priceLines(),
    },
    {
      label: "商品代金以外の必要料金",
      lines: [
        "本サービスの利用・購入手続きに必要なインターネット接続料金、通信料金等はお客様のご負担となります。",
      ],
    },
    {
      label: "支払方法",
      lines: [
        "クレジットカード(Stripeを通じて決済します)",
      ],
    },
    {
      label: "契約期間",
      lines: [
        "クレジットカードによるお支払いは、契約期間の定めのない月額の自動更新契約です。お客様が解約されるまで、1か月ごとに自動的に更新され、その都度料金が発生します。",
      ],
    },
    {
      label: "支払時期",
      lines: [
        "クレジットカード：お申し込み時に初回分を決済し、以後は解約されるまで1か月ごとに自動更新で決済します。",
      ],
    },
    {
      label: "役務の提供時期",
      lines: [
        "決済の確認後、直ちに対象プランをご利用いただけます。",
        "次回更新日までプランが有効です。",
      ],
    },
    {
      label: "返品・キャンセル(解約)について",
      lines: [
        "サービスの性質上、決済後の返金・返品はお受けできません。",
        "クレジットカードの自動更新は、ログイン後のマイページの「プラン・お支払い」からいつでも停止できます。停止しても、既にお支払い済みの期間の終了まではプランをご利用いただけます(日割りでの返金は行いません)。期間の終了後は自動的に無料プランに戻ります。",
        "決済システムの不具合など当方の責めに帰すべき事由による場合は、個別に対応します。",
      ],
    },
    {
      label: "動作環境",
      lines: [
        "JavaScriptおよびWeb Crypto APIに対応した最新版のウェブブラウザ。",
        "本サービスはブラウザ上でファイルを暗号化・復号するため、上記に対応していない環境ではご利用いただけません。",
      ],
    },
  ];
}
