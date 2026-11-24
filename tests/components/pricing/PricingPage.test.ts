// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PricingPage from "@/components/pricing/PricingPage";

describe("PricingPage", () => {
  it("各プランの「始める」から既存の利用・購入先に進める", () => {
    document.body.innerHTML = renderToStaticMarkup(createElement(PricingPage));
    const main = document.querySelector("main")!;
    const links = [...main.querySelectorAll("a")];
    expect(links.map((link) => link.textContent?.trim())).toEqual(["始める", "始める", "始める"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/", "/mypage/billing", "/mypage/billing"]);
    document.body.innerHTML = "";
  });
});
