import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Git } from "@/scripts/review-split/git.mjs";

const directories: string[] = [];
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "review-split-test-")); directories.push(directory);
  const git = new Git(directory);
  git.run(["init", "-b", "main"]);
  git.run(["config", "user.name", "Test"]); git.run(["config", "user.email", "test@example.com"]);
  const commit = (message: string) => { git.run(["add", "--all"]); git.run(["commit", "-m", message]); return git.text(["rev-parse", "HEAD"]); };
  return { directory, git, commit };
}
afterEach(() => directories.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));

describe("Git object-only split construction", () => {
  it("preserves additions, deletions, renames, binary bytes and modes without changing the worktree", () => {
    const { git, directory, commit } = fixture();
    writeFileSync(path.join(directory, "old.txt"), "rename me\n".repeat(20));
    writeFileSync(path.join(directory, "deleted.txt"), "old");
    const base = commit("base");
    git.run(["mv", "old.txt", "new.txt"]); rmSync(path.join(directory, "deleted.txt"));
    writeFileSync(path.join(directory, "binary.dat"), Buffer.from([0, 255, 3, 0]));
    writeFileSync(path.join(directory, "script.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const head = commit("source");
    const changes = git.changes(base, head);
    expect(changes.find(c => c.path === "new.txt")?.previous).toBe("old.txt");
    const groups = changes.map(c => ({ paths: [c.path], reasons: [] }));
    const commits = git.build(base, head, changes, groups, 42);
    expect(git.treeId(commits.at(-1)!)).toBe(git.treeId(head));
    expect(git.build(base, head, changes, groups, 42)).toEqual(commits);
    expect(git.text(["rev-parse", "HEAD"])).toBe(head);
    expect(git.text(["status", "--porcelain"])).toBe("");
    expect(() => git.build(base, head, changes, [groups[0], groups[0]], 42)).toThrow(/重複/);
    expect(() => git.build(base, head, changes, [groups[0]], 42)).toThrow(/一致/);
  });
  it("handles copied files despite repository copy-detection settings", () => {
    const { git, directory, commit } = fixture();
    writeFileSync(path.join(directory, "original.txt"), "copy me\n".repeat(20));
    const base = commit("base");
    writeFileSync(path.join(directory, "copy.txt"), "copy me\n".repeat(20));
    writeFileSync(path.join(directory, "z.txt"), "new"); const head = commit("copies");
    git.run(["config", "diff.renames", "copies"]);
    const changes = git.changes(base, head);
    expect(changes).toEqual([{ status: "A", path: "copy.txt" }, { status: "A", path: "z.txt" }]);
    const commits = git.build(base, head, changes, changes.map(c => ({ paths: [c.path], reasons: [] })), 42);
    expect(git.treeId(commits.at(-1)!)).toBe(git.treeId(head));
    expect(git.tree(commits.at(-1)!).has("original.txt")).toBe(true);
  });
  it("restacks only remaining changes after squash and retains unrelated main changes", () => {
    const { git, directory, commit } = fixture();
    writeFileSync(path.join(directory, "base.txt"), "base"); const base = commit("base");
    writeFileSync(path.join(directory, "a.txt"), "a"); writeFileSync(path.join(directory, "b.txt"), "b"); const head = commit("source");
    const commits = git.build(base, head, git.changes(base, head), [{ paths: ["a.txt"], reasons: [] }, { paths: ["b.txt"], reasons: [] }], 42);
    const squash = git.commit(git.treeId(commits[0]), base, head, "squash first part");
    git.run(["checkout", squash]); writeFileSync(path.join(directory, "other.txt"), "unrelated");
    const mainWithOther = commit("unrelated main addition");
    const restacked = git.restack([commits[1]], mainWithOther, mainWithOther, 42);
    expect(git.parent(restacked[0])).toBe(mainWithOther);
    const tree = git.tree(restacked[0]);
    for (const [name, entry] of git.tree(head)) expect(tree.get(name)).toEqual(entry);
    expect(tree.get("other.txt")).toEqual(git.tree(mainWithOther).get("other.txt"));
  });
  it("stops a conflicting restack and rejects untrusted ref syntax", () => {
    const { git, directory, commit } = fixture();
    writeFileSync(path.join(directory, "a.txt"), "base\n"); const base = commit("base");
    writeFileSync(path.join(directory, "a.txt"), "source\n"); const head = commit("source");
    git.run(["checkout", base]); writeFileSync(path.join(directory, "a.txt"), "main\n"); const main = commit("main");
    expect(() => git.restack([head], main, main, 42)).toThrow();
    expect(() => git.tree("--help")).toThrow(/SHA/);
    expect(() => git.push("owner/repo", "main", head, base, "secret")).toThrow(/生成ブランチ/);
  });
});
