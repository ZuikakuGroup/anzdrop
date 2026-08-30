// 利用規約・プライバシーポリシー・特定商取引法に基づく表記で共有する定数。

// 3ページ共通の最終改定日。内容を実質的に変更したらここを更新する。
export const LEGAL_LAST_UPDATED = "2026年8月30日";

// 事業者情報(特商法の表記・各ポリシーの問い合わせ先で使い回す単一の情報源)。
//
// 本サービスは任意団体「瑞鶴グループ」として運営しているが、任意団体そのものには
// 法人格がないため、特定商取引法上の「販売事業者」としては運営者個人(相澤遼)の
// 氏名を表示する。所在地・電話番号は、消費者からの請求があった場合に遅滞なく
// 開示する方式とする。
export const OPERATOR = {
  sellerName: "相澤遼",
  groupName: "瑞鶴グループ",
  representative: "相澤遼",
  email: "zuikakugroup@gmail.com",
  contactFormPath: "/contact",
} as const;

// 利用規約・プライバシーポリシーの本文で「当方」を定義するときの主体表記。
export const OPERATOR_ENTITY_LABEL = `任意団体「${OPERATOR.groupName}」(運営者: ${OPERATOR.sellerName})`;
