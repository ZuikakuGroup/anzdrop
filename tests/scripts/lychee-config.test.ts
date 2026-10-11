import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const config = readFileSync(path.resolve(__dirname, "../../.lychee.toml"), "utf8");
const excludeSection = config.match(/^exclude = \[([\s\S]*?)^\]/m);
if (!excludeSection) throw new Error("Lychee exclude 設定が見つかりません");

// TOML の単引用符文字列はバックスラッシュをそのまま正規表現に渡す。
const exclusions = [...excludeSection[1].matchAll(/^\s*'([^']+)'\s*,?\s*$/gm)]
  .map((match) => new RegExp(match[1]));
const isExcluded = (url: string) => exclusions.some((pattern) => pattern.test(url));

describe("Lychee checks application assets", () => {
  it.each([
    "https://anzdrop.com/_public-astro/page.js",
    "https://anzdrop.com/images/file-sharing.png",
    "https://images.microcms-assets.io/assets/image.png",
  ])("keeps deployed assets checked: %s", url => {
    expect(isExcluded(url)).toBe(false);
  });
  it("still excludes local development origins", () => {
    expect(isExcluded("http://localhost:3000/contact")).toBe(true);
  });
});
