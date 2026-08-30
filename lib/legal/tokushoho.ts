import {
  PLAN_LABELS,
  PLAN_MONTHLY_PRICE_JPY,
  type Plan,
} from "@/lib/plan";
import { OPERATOR } from "@/lib/legal/constants";

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
      ].toLocaleString("ja-JP")}円(消費税込み)`
  );

  return [
    `${PLAN_LABELS.free}: 0円`,
    ...perPlan,
    "ビットコインでのお支払いの場合、上記の日本円価格を基準に、決済時の為替レートで換算した相当額をお支払いいただきます。",
  ];
}

export function buildTokushohoItems(): TokushohoItem[] {
  return [
    {
      label: "販売事業者",
      lines: [`${OPERATOR.sellerName}(任意団体「${OPERATOR.groupName}」として運営)`],
    },
    {
      label: "運営統括責任者",
      lines: [OPERATOR.representative],
    },
    {
      label: "所在地",
      lines: [
        "消費者からのご請求があった場合には、遅滞なく電子メールにて開示します。",
      ],
    },
    {
      label: "電話番号",
      lines: [
        "消費者からのご請求があった場合には、遅滞なく電子メールにて開示します。",
      ],
    },
    {
      label: "連絡先(お問い合わせ)",
      lines: [
        `メールアドレス: ${OPERATOR.email}`,
        `または本サイトのお問い合わせフォーム( ${OPERATOR.contactFormPath} )`,
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
        "ビットコインでお支払いの場合、ブロックチェーンのネットワーク手数料等が別途かかることがあります。",
      ],
    },
    {
      label: "支払方法",
      lines: [
        "クレジットカード(Stripeを通じて決済します)",
        "ビットコイン(OpenNodeを通じて決済します。現在準備中です)",
      ],
    },
    {
      label: "契約期間",
      lines: [
        "クレジットカードによるお支払いは、契約期間の定めのない月額の自動更新契約です。お客様が解約されるまで、1か月ごとに自動的に更新され、その都度料金が発生します。",
        "ビットコインによるお支払いは自動更新されず、購入した期間が経過すると自動的に無料プランに戻ります。",
      ],
    },
    {
      label: "支払時期",
      lines: [
        "クレジットカード: お申し込み時に初回分を決済し、以後は解約されるまで1か月ごとに自動更新で決済します。",
        "ビットコイン: 一定期間分の利用権を都度購入する方式のため、お申し込みのつどお支払いいただきます(自動更新はありません)。",
      ],
    },
    {
      label: "役務の提供時期",
      lines: [
        "決済の確認後、直ちに対象プランをご利用いただけます。",
        "クレジットカードは次回更新日まで、ビットコインは購入した期間分だけプランが有効です。",
      ],
    },
    {
      label: "返品・キャンセル(解約)について",
      lines: [
        "サービスの性質上、決済後の返金・返品はお受けできません。",
        "クレジットカードの自動更新は、ログイン後のマイページの「プラン・お支払い」からいつでも停止できます。停止しても、既にお支払い済みの期間の終了まではプランをご利用いただけます(日割りでの返金は行いません)。期間の終了後は自動的に無料プランに戻ります。",
        "ビットコインでのお支払いは期間購入型のため、購入後のキャンセル・返金はできません。",
        "決済システムの不具合など当方の責めに帰すべき事由による場合は、個別に対応します。",
      ],
    },
    {
      label: "動作環境",
      lines: [
        "JavaScriptおよびWeb Crypto APIに対応した最新版のウェブブラウザ(Google Chrome、Mozilla Firefox、Safari、Microsoft Edge など)。",
        "本サービスはブラウザ上でファイルを暗号化・復号するため、上記に対応していない環境ではご利用いただけません。",
      ],
    },
  ];
}
