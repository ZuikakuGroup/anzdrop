// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PricingPage from "@/components/pricing/PricingPage";

describe("PricingPage", () => {
  it("displays the approved size and retention limits with unchanged monthly prices", () => {
    document.body.innerHTML = renderToStaticMarkup(createElement(PricingPage));
    try {
      const cards = [...document.querySelectorAll("main h2")].map((heading) => heading.parentElement!);
      for (const [index, [size, days, price]] of [["100GB", "30日", "¥0"], ["300GB", "60日", "¥250"], ["500GB", "100日", "¥450"]].entries()) {
        expect(cards[index].textContent).toContain(size);
        expect(cards[index].textContent).toContain(days);
        expect(cards[index].textContent).toContain(price);
      }
    } finally {
      document.body.innerHTML = "";
    }
  });

  it("各プランの「始める」から既存の利用・購入先に進める", () => {
    document.body.innerHTML = renderToStaticMarkup(createElement(PricingPage));
    const main = document.querySelector("main")!;
    const links = [...main.querySelectorAll("a")];
    expect(links.map((link) => link.textContent?.trim())).toEqual(["始める", "始める", "始める"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/", "/mypage/billing", "/mypage/billing"]);
    document.body.innerHTML = "";
  });
});
