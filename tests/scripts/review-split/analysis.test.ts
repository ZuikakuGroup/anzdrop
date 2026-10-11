import { describe, expect, it } from "vitest";
import { references, reviewState, splitPlan, type Change, type Snapshot } from "@/scripts/review-split/analysis.mjs";

const sha = "a".repeat(40);
const bot = "coderabbitai[bot]";
const signal = (description: string, state = "success") => ({ sha, state, description, trusted: true, date: "2026-10-11" });
const changes = (names: string[]): Change[] => names.map(path => ({ path, status: "M" }));

describe("review coverage", () => {
  it("detects #237's success-labelled skip and does not accept bare success", () => {
    const review = [{ sha, user: bot, state: "COMMENTED" }];
    expect(reviewState(sha, [signal("Review skipped: 282 files exceed the limit of 100")], review, bot)).toBe("省略");
    expect(reviewState(sha, [signal("All good")], [], bot)).toBe("判定不能");
    expect(reviewState(sha, [], review, bot)).toBe("完了を確認");
  });
  it("does not use stale, untrusted, pending or failed evidence as completion", () => {
    const review = [{ sha, user: bot, state: "APPROVED" }];
    expect(reviewState(sha, [signal("", "pending")], review, bot)).toBe("処理中");
    expect(reviewState(sha, [signal("", "failure")], review, bot)).toBe("判定不能");
    expect(reviewState("b".repeat(40), [signal("Review skipped")], review, bot)).toBe("判定不能");
    expect(reviewState(sha, [{ ...signal("Review skipped"), trusted: false }], [], bot)).toBe("判定不能");
    expect(reviewState(sha, [], [{ sha, user: "someone", state: "APPROVED" }], bot)).toBe("判定不能");
  });
});

describe("dependency grouping", () => {
  it("packs independent changes deterministically at the 100/101 boundary", () => {
    const names = Array.from({ length: 101 }, (_, i) => `assets/${String(i).padStart(3, "0")}.txt`);
    const snapshot: Snapshot = new Map(names.map(n => [n, "data"]));
    expect(splitPlan(changes(names), snapshot, snapshot, 100).groups.map(g => g.paths.length)).toEqual([100, 1]);
    expect(splitPlan(changes(names.slice(0, 100)), snapshot, snapshot, 100).stop).toMatch(/1グループ/);
    expect(splitPlan(changes(names.reverse()), snapshot, snapshot, 100)).toEqual(splitPlan(changes([...names].reverse()), snapshot, snapshot, 100));
  });
  it("keeps cyclic imports, alias exports, implementation and tests together", () => {
    const files: Snapshot = new Map([
      ["lib/a.ts", 'export { b } from "@/lib/b";'],
      ["lib/b.ts", 'import { a } from "./a.js"; export const b = a;'],
      ["tests/lib/a.test.ts", 'import { a } from "@/lib/a";'],
      ["independent.txt", "hello"],
    ]);
    const plan = splitPlan(changes([...files.keys()]), files, files, 3);
    expect(plan.stop).toBeUndefined();
    expect(plan.groups.find(g => g.paths.includes("lib/a.ts"))?.paths).toEqual(["lib/a.ts", "lib/b.ts", "tests/lib/a.test.ts"]);
  });
  it("analyzes old imports when removing a module and joins unchanged shared callers", () => {
    const before: Snapshot = new Map([["a.ts", "export const a = 1"], ["b.ts", "export const b = 1"], ["caller.ts", 'import "./a"; import "./b";'], ["other.txt", "data"]]);
    const after = new Map(before); after.delete("a.ts");
    const plan = splitPlan([{ path: "a.ts", status: "D" }, ...changes(["b.ts", "other.txt"])], before, after, 2);
    expect(plan.groups.some(g => g.paths.includes("a.ts") && g.paths.includes("b.ts"))).toBe(true);
  });
  it("handles Astro frontmatter and script imports without parsing markup as TypeScript", () => {
    expect(references("page.astro", '---\nimport A from "@/a";\n---\n<A/><script>import("./b.ts");</script>')).toEqual({ imports: ["@/a", "./b.ts"], dynamic: false });
  });
  it("includes upper-case and mixed-case Astro script dependencies", () => {
    expect(references("page.astro", '<SCRIPT>import "./a";</SCRIPT><Script>export { b } from "./b";</sCrIpT \t>')).toEqual({ imports: ["./a", "./b"], dynamic: false });
  });
  it.each(["</script >", "</script\t\n bar>", '</SCRIPT foo="bar">', "</script/>"])("reads dependencies before a browser-accepted end tag: %s", ending => {
    expect(references("page.astro", `<script>import "./first";${ending}<script>import "./second";</script>`)).toEqual({ imports: ["./first", "./second"], dynamic: false });
  });
  it.each(["scripture", "script-x", "script:foo"])("does not mistake %s for a script end tag", tag => {
    expect(references("page.astro", `<script>const x = "</${tag}>"; import "./dependency";</script>`)).toEqual({ imports: ["./dependency"], dynamic: false });
  });
  it("preserves literal replacement characters in alias paths", () => {
    const files: Snapshot = new Map([
      ["tsconfig.json", '{"compilerOptions":{"paths":{"~/*":["src/*"]}}}'],
      ["caller.ts", 'import "~/$&";'], ["src/$&.ts", "export {};"], ["other.txt", "x"],
    ]);
    const plan = splitPlan(changes(["caller.ts", "src/$&.ts", "other.txt"]), files, files, 2);
    expect(plan.stop).toBeUndefined();
    expect(plan.groups.some(g => g.paths.includes("caller.ts") && g.paths.includes("src/$&.ts"))).toBe(true);
  });
  it("keeps config/lockfile updates and unresolved dynamic dependencies conservative", () => {
    for (const [name, content] of [["package.json", "{}"], ["caller.ts", "import(variable)"], ["caller.ts", 'import "./missing";'], ["caller.ts", 'const plugins = import.meta.glob("./plugins/*.ts")']]) {
      const files = new Map([[name, content], ["a.txt", "x"], ["b.txt", "x"]]);
      expect(splitPlan(changes([...files.keys()]), files, files, 2).stop).toMatch(/超え/);
    }
  });
  it("recognizes unresolved custom aliases as local dependencies", () => {
    const files = new Map([["tsconfig.json", '{"compilerOptions":{"paths":{"~/*":["src/*"]}}}'], ["caller.ts", 'import "~/missing";'], ["a.txt", "x"], ["b.txt", "x"]]);
    expect(splitPlan(changes(["caller.ts", "a.txt", "b.txt"]), files, files, 2).stop).toMatch(/超え/);
  });
  it("keeps dependency reasons local to their groups", () => {
    const files: Snapshot = new Map([
      ["a.ts", 'import "./b";'], ["b.ts", "export {};"],
      ["docs/c.md", "[source](../c.ts)"], ["c.ts", "export {};"], ["z.txt", "x"],
    ]);
    const plan = splitPlan(changes([...files.keys()]), files, files, 2);
    expect(plan.groups.find(g => g.paths.includes("a.ts"))?.reasons).toEqual(["変更された参照元・参照先を同時に適用"]);
    expect(plan.groups.find(g => g.paths.includes("c.ts"))?.reasons).toEqual(["ドキュメントの参照先と同時に適用"]);
    expect(plan.groups.find(g => g.paths.includes("z.txt"))?.reasons).toEqual([]);
  });
  it("keeps a rename indivisible and charges both paths", () => {
    const plan = splitPlan([{ path: "new.txt", previous: "old.txt", status: "R100" }, ...changes(["other.txt"])], new Map([["old.txt", "x"]]), new Map([["new.txt", "x"], ["other.txt", "y"]]), 1);
    expect(plan.stop).toMatch(/超え/);
  });
  it("groups relative documentation links with the changed target", () => {
    const files = new Map([["docs/a.md", "[source](../lib/a.ts#L1)"], ["lib/a.ts", "export const a = 1;"], ["other.txt", "x"]]);
    expect(splitPlan(changes([...files.keys()]), files, files, 2).groups.some(g => g.paths.includes("docs/a.md") && g.paths.includes("lib/a.ts"))).toBe(true);
  });
});
