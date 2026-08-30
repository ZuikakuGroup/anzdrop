// 利用規約・プライバシーポリシー・特定商取引法に基づく表記で共有する定数。

// 3ページ共通の最終改定日。内容を実質的に変更したらここを更新する。
export const LEGAL_LAST_UPDATED = "2026年8月30日";

// 事業者情報(特商法の表記・各ポリシーの問い合わせ先で使い回す単一の情報源)。
//
// 本サービスは任意団体「瑞鶴グループ」として運営している。運営者個人の氏名は、
// 特定商取引法上必要な「運営統括責任者」欄(representative)にのみ表示し、
// 利用規約・プライバシーポリシーや特商法の「販売事業者」欄では団体名のみを
// 用いる(OPERATOR_GROUP_LABEL)。所在地・電話番号は、消費者からの請求が
// あった場合に遅滞なく開示する方式とする。
export const OPERATOR = {
  groupName: "瑞鶴グループ",
  representative: "相澤遼",
  email: "zuikakugroup@gmail.com",
  contactFormPath: "/contact",
} as const;

// 団体名のみの表記(運営者個人の氏名を出さない)。利用規約・プライバシーポリシーの
// 主体表記、特商法の「販売事業者」欄など、団体名だけを示したい箇所で使う。
export const OPERATOR_GROUP_LABEL = `任意団体 ${OPERATOR.groupName}`;
