import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TermsPage from "@/components/legal/TermsPage";
import PrivacyPage from "@/components/legal/PrivacyPage";
import PricingPage from "@/components/pricing/PricingPage";
import PlanPicker from "@/components/billing/PlanPicker";
import AdminGrantedPlanNotice from "@/components/billing/AdminGrantedPlanNotice";

describe("公開ページの決済表記", () => {
  const pages = [
    ["利用規約", createElement(TermsPage)],
    ["プライバシーポリシー", createElement(PrivacyPage)],
    ["料金表", createElement(PricingPage)],
    ["購入画面", createElement(PlanPicker, {
      selectedPlan: "standard", isLoadingAction: null, error: "",
      onSelectPlan: () => {}, onStartStripe: () => {}, onStartBtc: () => {},
    })],
    ["運営付与プラン", createElement(AdminGrantedPlanNotice, {
      status: { accountId: "test", plan: "premium", planExpiresAt: null,
        subscription: null, adminGranted: true },
    })],
  ] as const;

  for (const [name, page] of pages) {
    it(`${name}に準備中のビットコイン決済を表示せず、既存の購入案内を保つ`, () => {
      const markup = renderToStaticMarkup(page);
      expect(markup).not.toMatch(/ビットコイン|bitcoin|opennode/i);
      expect(markup).toMatch(name === "料金表" ? /Standard|Premium/ : /カード|Stripe/);
    });
  }
});
