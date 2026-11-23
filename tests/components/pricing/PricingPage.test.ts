import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import PricingPage from "@/components/pricing/PricingPage";

describe("PricingPage", () => {
  it("各プランの「始める」から既存の利用・購入先に進める", () => {
    const dom = new JSDOM(renderToStaticMarkup(createElement(PricingPage, { showChrome: false })));
    const main = dom.window.document.querySelector("main")!;
    const links = [...main.querySelectorAll("a")];
    expect(links.map((link) => link.textContent?.trim())).toEqual(["始める", "始める", "始める"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/", "/mypage/billing", "/mypage/billing"]);
    dom.window.close();
  });
});
