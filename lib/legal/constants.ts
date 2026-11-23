// 利用規約・プライバシーポリシー・特定商取引法に基づく表記で共有する定数。

// 3ページ共通の最終改定日。内容を実質的に変更したらここを更新する。
export const LEGAL_LAST_UPDATED = "2026年11月23日";

// 事業者情報(特商法の表記・各ポリシーの問い合わせ先で使い回す単一の情報源)。
//
// 本サービスは任意団体「瑞鶴グループ」として運営している。運営者個人の氏名は、
// 特定商取引法上必要な「運営統括責任者」欄(representative)にのみ表示し、
// 利用規約・プライバシーポリシーや特商法の「販売事業者」欄では団体名のみを
// 用いる(OPERATOR_GROUP_LABEL)。所在地・電話番号は特商法の表記に掲載する。
export const OPERATOR = {
  groupName: "瑞鶴グループ",
  representative: "相澤遼",
  address: "神奈川県茅ヶ崎市東海岸南2丁目13-47",
  phone: "070-9508-6574",
  email: "support@anzdrop.com",
  contactFormPath: "/contact",
} as const;

// 団体名のみの表記(運営者個人の氏名を出さない)。利用規約・プライバシーポリシーの
// 主体表記、特商法の「販売事業者」欄など、団体名だけを示したい箇所で使う。
export const OPERATOR_GROUP_LABEL = `任意団体 ${OPERATOR.groupName}`;
