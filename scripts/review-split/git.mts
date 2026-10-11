import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Change, Group, Snapshot } from "./analysis.mjs";

export type Entry = { mode: string; oid: string };
const shaPattern = /^[0-9a-f]{40}$/;
export function assertSha(sha: string): string {
  if (!shaPattern.test(sha)) throw new Error("Git SHA が不正です");
  return sha;
}

export class Git {
  constructor(readonly cwd: string) {}
  run(args: string[], input?: string | Buffer, extraEnv: Record<string, string | undefined> = {}): Buffer {
    // No checkout, hooks, smudge filters, submodules or execution of PR files.
    return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: this.cwd, input, maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...extraEnv },
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
  text(args: string[], input?: string | Buffer, env?: Record<string, string | undefined>) { return this.run(args, input, env).toString("utf8").trim(); }
  tree(sha: string): Map<string, Entry> {
    const entries = new Map<string, Entry>();
    for (const line of this.run(["ls-tree", "-r", "-z", assertSha(sha)]).toString("utf8").split("\0").filter(Boolean)) {
      const tab = line.indexOf("\t");
      const [mode, type, oid] = line.slice(0, tab).split(" ");
      if (type !== "blob") throw new Error("サブモジュールを含む変更は自動分割できません");
      const filename = line.slice(tab + 1);
      if (!filename || filename.includes("\n") || filename.includes("\r")) throw new Error("特殊なファイル名は自動分割できません");
      entries.set(filename, { mode, oid });
    }
    return entries;
  }
  snapshot(tree: Map<string, Entry>, maxBytes: number): Snapshot {
    const snapshot: Snapshot = new Map();
    let bytes = 0;
    for (const [name, entry] of tree) {
      let text = "";
      if (/\.(?:[cm]?[jt]sx?|astro|md|jsonc?)$/.test(name)) {
        if (entry.mode !== "100644" && entry.mode !== "100755") throw new Error("解析対象のシンボリックリンクは自動分割できません");
        const size = Number(this.text(["cat-file", "-s", entry.oid]));
        bytes += size;
        if (size > 1024 * 1024 || bytes > maxBytes) throw new Error("ソース解析のサイズ上限を超えています");
        text = this.run(["cat-file", "blob", entry.oid]).toString("utf8");
      }
      snapshot.set(name, text);
    }
    return snapshot;
  }
  changes(base: string, head: string): Change[] {
    const pieces = this.run(["-c", "diff.renames=true", "diff", "--name-status", "-z", "-M", assertSha(base), assertSha(head), "--"]).toString("utf8").split("\0");
    const changes: Change[] = [];
    for (let i = 0; i < pieces.length - 1;) {
      const status = pieces[i++];
      if (status.startsWith("R")) changes.push({ status, previous: pieces[i++], path: pieces[i++] });
      else if (status.startsWith("C")) { i++; changes.push({ status: "A", path: pieces[i++] }); }
      else changes.push({ status, path: pieces[i++] });
    }
    return changes;
  }
  isAncestor(base: string, head: string) {
    try { this.run(["merge-base", "--is-ancestor", assertSha(base), assertSha(head)]); return true; }
    catch (error) {
      if ((error as { status?: number }).status === 1) return false;
      throw error;
    }
  }
  treeId(sha: string) { return this.text(["rev-parse", `${assertSha(sha)}^{tree}`]); }
  parent(sha: string) { return assertSha(this.text(["rev-parse", `${assertSha(sha)}^`])); }
  build(base: string, head: string, changes: Change[], groups: Group[], source: number): string[] {
    const directory = mkdtempSync(path.join(tmpdir(), "anzdrop-split-index-"));
    const env = { GIT_INDEX_FILE: path.join(directory, "index") };
    const target = this.tree(head);
    const changeMap = new Map(changes.map(c => [c.path, c]));
    const seen = new Set<string>();
    let parent = assertSha(base);
    const commits: string[] = [];
    try {
      this.run(["read-tree", parent], undefined, env);
      for (const [i, group] of groups.entries()) {
        const entries: string[] = [];
        for (const name of group.paths) {
          if (seen.has(name) || !changeMap.has(name)) throw new Error("変更ファイルの重複または未知のファイルがあります");
          seen.add(name);
          const change = changeMap.get(name)!;
          if (change.previous) entries.push(`0 ${"0".repeat(40)}\t${change.previous}\0`);
          const entry = target.get(name);
          entries.push(entry ? `${entry.mode} ${entry.oid}\t${name}\0` : `0 ${"0".repeat(40)}\t${name}\0`);
        }
        this.run(["update-index", "-z", "--index-info"], entries.join(""), env);
        const tree = assertSha(this.text(["write-tree"], undefined, env));
        parent = this.commit(tree, parent, head, `Split #${source}: part ${i + 1}/${groups.length}`);
        commits.push(parent);
      }
      if (seen.size !== changes.length || this.treeId(parent) !== this.treeId(head)) throw new Error("分割後の最終 tree が元 HEAD と一致しません");
      return commits;
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  commit(tree: string, parent: string, clock: string, message: string): string {
    const date = `${this.text(["show", "-s", "--format=%ct", assertSha(clock)])} +0000`;
    const env = { GIT_AUTHOR_NAME: "Review Split", GIT_AUTHOR_EMAIL: "review-split@users.noreply.github.com", GIT_COMMITTER_NAME: "Review Split", GIT_COMMITTER_EMAIL: "review-split@users.noreply.github.com", GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
    return assertSha(this.text(["commit-tree", assertSha(tree), "-p", assertSha(parent)], `${message}\n`, env));
  }
  restack(commits: string[], main: string, clock: string, source: number): string[] {
    let parent = assertSha(main);
    return commits.map((old, i) => {
      // Apply only this part's delta, not previously squash-merged ancestors.
      const tree = assertSha(this.text(["merge-tree", "--write-tree", `--merge-base=${this.parent(old)}`, parent, assertSha(old)]));
      parent = this.commit(tree, parent, clock, `Restack #${source}: remaining part ${i + 1}`);
      return parent;
    });
  }
  fetch(repo: string, sha: string) { this.run(["fetch", "--no-tags", `https://github.com/${repo}.git`, assertSha(sha)]); }
  push(repo: string, branch: string, sha: string, expected: string | null, token: string) {
    if (!/^review-split\/\d+\/\d+$/.test(branch)) throw new Error("生成ブランチ以外は更新できません");
    const env = {
      GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
    };
    this.run(["push", `--force-with-lease=refs/heads/${branch}:${expected ? assertSha(expected) : ""}`, `https://github.com/${repo}.git`, `${assertSha(sha)}:refs/heads/${branch}`], undefined, env);
  }
}
