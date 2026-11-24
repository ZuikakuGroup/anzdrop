// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "@/components/legal/PrivacyPage";

const suppliedPolicy = readFileSync("tests/fixtures/legal/privacy-policy.txt", "utf8");

describe("PrivacyPage", () => {
  it("指定された本文・見出し・箇条書きとリンクを順序どおり表示する", () => {
    document.body.innerHTML = renderToStaticMarkup(createElement(PrivacyPage));
    try {
      const sections = document.querySelectorAll("main section");
      const actual = [...sections].flatMap((section) => [...section.querySelectorAll("h2, h3, p, li")].map((element) => element.textContent));
      const expected = suppliedPolicy.split("\n").filter((line) => line.trim()).map((line) => line.replace(/^#{2,3} |^- /, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"));
      expect(actual).toEqual(expected);
      const links = [...sections].flatMap((section) => [...section.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")]));
      expect(links).toEqual([...suppliedPolicy.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((match) => [match[1], match[2]]));
      expect(document.querySelector("main")?.textContent).toContain("最終改定日: 2026年11月24日");
    } finally {
      document.body.innerHTML = "";
    }
  });
});
