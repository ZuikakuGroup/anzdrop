// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TermsPage from "@/components/legal/TermsPage";

const suppliedTerms = readFileSync("tests/fixtures/legal/terms.txt", "utf8");

describe("TermsPage", () => {
  it("指定の全14条の本文・条項順序・リンクを表示する", () => {
    document.body.innerHTML = renderToStaticMarkup(createElement(TermsPage));
    try {
      const sections = [...document.querySelectorAll("main section")];
      const actual = sections.flatMap((section) => [...section.querySelectorAll("h2, p, li")].map((element) => element.textContent?.trim()));
      const expected = suppliedTerms.split("\n").filter((line) => line.trim()).map((line) => line.replace(/^## |^\d+\. |^- /, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"));
      expect(sections).toHaveLength(14);
      expect(actual).toEqual(expected);
      expect(sections.map((section) => section.querySelector("ol")?.children.length ?? 0)).toEqual([2, 3, 3, 3, 3, 0, 4, 2, 6, 2, 0, 2, 2, 0]);
      expect(sections[5].querySelectorAll("ul > li")).toHaveLength(10);
      const links = sections.flatMap((section) => [...section.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")]));
      expect(links).toEqual([...suppliedTerms.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((match) => [match[1], match[2]]));
    } finally {
      document.body.innerHTML = "";
    }
  });
});
