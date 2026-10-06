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

describe("Lychee image endpoint exclusion", () => {
  it.each([
    "https://anzdrop.com/_next/image",
    "https://anzdrop.com/_next/image?url=%2Fimages%2Ffile-sharing.png&w=640&q=75",
    "http://anzdrop.com/_next/image?url=https%3A%2F%2Fimages.microcms-assets.io%2Fimage.png",
  ])("excludes the optimization endpoint: %s", (url) => {
    expect(isExcluded(url)).toBe(true);
  });

  it.each([
    "https://anzdrop.com/_next/image-preview",
    "https://anzdrop.com/_next/images",
    "https://anzdrop.com/_next/image/other.png",
    "https://anzdrop.com/images/file-sharing.png",
    "https://images.microcms-assets.io/assets/image.png",
    "https://anzdrop.com/other/_next/image?url=image.png",
  ])("keeps other paths and source images checked: %s", (url) => {
    expect(isExcluded(url)).toBe(false);
  });
});
