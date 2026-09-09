import { describe, expect, it } from "vitest";
import { parseBlogPage } from "@/lib/blog/pagination";

describe("parseBlogPage", () => {
  it.each([
    [undefined, 1],
    [["2"], 1],
    ["", 1],
    ["0", 1],
    ["-1", 1],
    ["1.5", 1],
    ["1abc", 1],
    ["9".repeat(400), 1],
    ["1", 1],
    ["2", 2],
  ])("returns %d for %j", (value, expected) => {
    expect(parseBlogPage(value)).toBe(expected);
  });
});
