import { describe, it, expect } from "vitest";
import { buildTokushohoItems } from "@/lib/legal/tokushoho";
import { PLAN_MONTHLY_PRICE_JPY, PLAN_LABELS } from "@/lib/plan";
import { OPERATOR } from "@/lib/legal/constants";

describe("buildTokushohoItems", () => {
  const items = buildTokushohoItems();
  const byLabel = (label: string) => {
    const item = items.find((entry) => entry.label === label);
    if (!item) {
      throw new Error(`表示項目「${label}」が見当たりません`);
    }
    return item.lines.join("\n");
  };

  it("特商法(第11条)で通信販売に求められる表示項目をすべて含む", () => {
    // 事業者名・責任者・連絡先・価格・付随費用・支払方法・支払時期・提供時期・
    // 返品(解約)条件は、いずれも欠けると表記として不備になる。
    for (const label of [
      "販売事業者",
      "運営統括責任者",
      "所在地",
      "電話番号",
      "連絡先",
      "販売価格",
      "商品代金以外の必要料金",
      "支払方法",
      "契約期間",
      "支払時期",
      "役務の提供時期",
      "返品・キャンセル(解約)について",
      "動作環境",
    ]) {
      expect(items.map((entry) => entry.label)).toContain(label);
    }

    // すべての項目に本文がある(ラベルだけで中身が空、を防ぐ)。
    for (const item of items) {
      expect(item.lines.length).toBeGreaterThan(0);
      for (const line of item.lines) {
        expect(line.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("事業者情報は lib/legal/constants の単一の情報源と一致する", () => {
    // 販売事業者は団体名のみを表示する。運営者個人の氏名(sellerName)は
    // 販売事業者欄には出さず、運営統括責任者欄にのみ記載する。
    expect(byLabel("販売事業者")).toBe(`任意団体 ${OPERATOR.groupName}`);
    expect(byLabel("運営統括責任者")).toBe(OPERATOR.representative);
    // 連絡先はメールアドレスのみ(お問い合わせフォームへの誘導は入れない)。
    expect(byLabel("連絡先")).toBe(`メールアドレス: ${OPERATOR.email}`);
  });

  it("所在地・電話番号は「請求により遅滞なく開示」方式で記載する", () => {
    for (const label of ["所在地", "電話番号"]) {
      expect(byLabel(label)).toContain("請求");
      expect(byLabel(label)).toContain("開示");
    }
  });

  it("定期購入(自動更新)であることを契約期間・支払時期で明示する", () => {
    const term = `${byLabel("契約期間")}\n${byLabel("支払時期")}`;
    expect(term).toContain("自動更新");
    expect(term).toMatch(/契約期間の定めのない|契約期間の定めはなく/);
  });

  it("販売価格の表記が実際に請求される月額(lib/plan.ts)と一致する", () => {
    const priceText = byLabel("販売価格");

    for (const plan of ["standard", "premium"] as const) {
      const yen = PLAN_MONTHLY_PRICE_JPY[plan].toLocaleString("ja-JP");
      // 「Standardプラン: 月額 250円」のように、プラン名と実価格が対で載っている。
      expect(priceText).toMatch(
        new RegExp(`${PLAN_LABELS[plan]}[^\\n]*${yen}円`)
      );
    }

    // 販売価格の表記は有料プランのみを対象とし、無料プランは含めない。
    expect(priceText).not.toContain(PLAN_LABELS.free);
    // 消費税の扱いは「(税込)」で表記し、旧表記「消費税込み」は使わない。
    expect(priceText).toContain("(税込)");
    expect(priceText).not.toContain("消費税込み");
  });

  it("解約条件として、自動更新の停止方法と日割り返金がないことに触れている", () => {
    const cancelText = byLabel("返品・キャンセル(解約)について");
    expect(cancelText).toContain("マイページ");
    expect(cancelText).toContain("日割り");
  });
});
