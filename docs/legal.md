# 規約・ポリシーページ

利用規約・プライバシーポリシー・特定商取引法に基づく表記の3ページ。いずれも
`/legal/` 配下に配置し、静的なコンテンツページとして提供する。

| パス | コンポーネント | 内容 |
| --- | --- | --- |
| `/legal/terms`(`app/legal/terms/page.tsx`) | `components/legal/TermsPage.tsx` | 利用規約 |
| `/legal/privacy`(`app/legal/privacy/page.tsx`) | `components/legal/PrivacyPage.tsx` | プライバシーポリシー |
| `/legal/tokushoho`(`app/legal/tokushoho/page.tsx`) | `components/legal/TokushohoPage.tsx` | 特定商取引法に基づく表記 |

## 構成

- 3ページ共通の外枠は [`components/legal/LegalLayout.tsx`](../components/legal/LegalLayout.tsx)。ヘッダー・フッター・見出し(`LegalSection` / `LegalParagraph` / `LegalList`)・本文中リンク(`LegalLink`)・最終改定日の表示・ページ間リンクをまとめている。体裁は `components/about/AboutPage.tsx` に合わせている。本文からフォーム等へ誘導するときは、パスをそのまま書かず `LegalLink` でリンクにする。
- 事業者情報と3ページ共通の最終改定日は [`lib/legal/constants.ts`](../lib/legal/constants.ts) の `OPERATOR` / `OPERATOR_GROUP_LABEL` / `LEGAL_LAST_UPDATED` に集約している。3ページとも、これらをハードコードせずここから参照する。
  - 本サービスは任意団体「瑞鶴グループ」として運営している。運営者個人の氏名(`OPERATOR.representative`)を表に出すのは、特定商取引法に基づく表記の「運営統括責任者」欄のみ。特商法の「販売事業者」欄、利用規約 第1条の主体表記、プライバシーポリシーのお問い合わせ先は、いずれも団体名のみ(`OPERATOR_GROUP_LABEL` =「任意団体 瑞鶴グループ」)を使う。
  - 所在地・電話番号は掲載せず、請求があった場合に遅滞なく電子メールで開示する方式にしている。
  - 特商法表記の「連絡先」はメールアドレス(`OPERATOR.email`)のみ。お問い合わせフォーム(`/contact`)への誘導は利用規約・プライバシーポリシー側で行う。
- 一般ユーザーが読むページなので技術用語を避ける。とくにプライバシーポリシーでは暗号方式名・プロトコル名・Cookie名・「ハッシュ」「ソルト」等を使わず、平易な言い換えにする。運用の内部事情(管理画面など)は書かない。
- 「メールアドレスを取得しない」ことを利点として前面に打ち出す表記は法務ページに書かない(将来収集する場合の規約変更を避けるため)。アカウント実装が実際にメールアドレスを使わないこと自体は変わらない。
- プライバシーポリシーの「外部サービス」には、ホスティング等の委託先(Cloudflare / Stripe / OpenNode)に加えて Discord を挙げている。運営チームが通報・お問い合わせへの対応の過程でその内容を Discord 上でも扱うため。
- 特定商取引法に基づく表記の表示項目・本文は [`lib/legal/tokushoho.ts`](../lib/legal/tokushoho.ts) の `buildTokushohoItems()` が組み立てる。販売価格は `lib/plan.ts` の `PLAN_MONTHLY_PRICE_JPY` / `PLAN_LABELS` から生成するため、料金を変更すると表記も自動的に追従する。販売価格に載せるのは有料プラン(Standard・Premium)のみで、無料プランは含めない。カード決済は自動更新サブスクリプション(定期購入契約)であることを「契約期間」「支払時期」「返品・キャンセル」の各項目で明示している。
- `buildTokushohoItems()` の不変条件(必須項目の網羅・本文の非空・価格が `lib/plan.ts` と一致・所在地/電話番号の「請求により開示」方式・定期購入であることの明示・解約条件への言及)は [`tests/lib/legal/tokushoho.test.ts`](../tests/lib/legal/tokushoho.test.ts) で検証している。
- 利用規約 第9条の免責は、軽過失による損害についても賠償責任の全部を免除するのではなく、賠償額の上限を「直近1か月の支払額」に制限する上限型にしている(消費者契約法8条で全部免除条項が無効となるリスクを避けるため)。事業目的での利用のみ、故意・重過失を除き免責としている。

## 導線

- 全ページ共通フッター([`components/brand/SiteFooter.tsx`](../components/brand/SiteFooter.tsx))に3ページへのリンクを常設している。
- 有料プランの申し込み画面(`components/billing/BillingPage.tsx`)では、決済ボタンの直上に選択中プランの定期購入条件の要約(プラン名・月額(税込)・契約期間の定めなし/自動更新・解約方法・日割り返金なし)を表示し、ボタン付近に利用規約・特定商取引法に基づく表記へのリンクを表示する。改正特商法が定期購入契約の申込み最終確認画面に求める表示に対応するもの。この画面側の表示は、サイト内埋め込み決済フォーム(Stripe Payment Element)の導入と合わせて追加する。

## 内容を変更するとき

- 実質的な内容変更を行ったら `LEGAL_LAST_UPDATED` を更新する。
- 事業者情報が変わったら `lib/legal/constants.ts` の `OPERATOR` を更新する(3ページに反映される)。
- 料金・プラン・決済手段・解約条件を変更した場合は、`lib/legal/tokushoho.ts`(特商法表記)と本ドキュメント、および [`docs/accounts.md`](./accounts.md) の整合を確認する。
