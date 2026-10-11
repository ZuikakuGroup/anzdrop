import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Git } from "@/scripts/review-split/git.mjs";
import { Github, decodeState, encodeState, STATE_MARKER, NOTICE_MARKER, type State, type Pull, type Comment } from "@/scripts/review-split/github.mjs";
import { reconcile, inspectReview, type Config } from "@/scripts/review-split/reconcile.mjs";
import { discover } from "@/scripts/review-split/run.mjs";

const directories: string[] = [];
const repo = "owner/repo", appBot = "split-app[bot]", key = "test-only-signing-key";
const config: Config = { fileLimit: 2, maxFiles: 3000, maxSourceBytes: 20_000_000, maxGroups: 30, reviewBot: "coderabbitai[bot]" };
type Reviewer = { user: { login: string }; state: string; commit_id: string; body: string };
class Store {
  pulls = new Map<number, Pull>();
  refs = new Map<string, string>();
  comments = new Map<number, Comment[]>();
  reviews = new Map<number, Reviewer[]>();
  writes: { route: string; method: string }[] = [];
  failCreation = false;
  failStatuses = false;
  statuses: unknown[] = [];
  checks: unknown[] = [];
  next = 100;
  afterRead?: (route: string) => void;
}
class FakeApi extends Github {
  constructor(readonly store: Store, readonly bot = "github-actions[bot]") { super(repo, bot); }
  override async api<T>(route: string, method = "GET", body?: unknown): Promise<T> {
    const url = new URL(route, "https://api.example.com");
    const parts = url.pathname.split("/").filter(Boolean);
    const data = body as { title?: string; body?: string; head?: string; base?: string } | undefined;
    if (method !== "GET") this.store.writes.push({ route, method });
    const output = (): unknown => {
      if (parts[0] === "git" && parts[1] === "ref") {
        const sha = this.store.refs.get(decodeURIComponent(parts.slice(3).join("/")));
        if (!sha) throw new Error("missing ref in fixture");
        return { object: { sha } };
      }
      if (parts[0] === "commits") {
        if (parts[2] === "statuses") { if (this.store.failStatuses) throw new Error("private-token-must-not-leak"); return this.store.statuses; }
        if (parts[2] === "check-runs") return { check_runs: this.store.checks, total_count: this.store.checks.length };
        if (parts[2] === "pulls") return [...this.store.pulls.values()];
      }
      if (parts[0] === "pulls") {
        if (parts.length === 1) {
          if (method === "POST") {
            if (this.store.failCreation) { this.store.failCreation = false; throw new Error("simulated interrupted PR creation"); }
            const parent = this.store.pulls.get(1)!;
            const n = this.store.next++;
            const pull: Pull = { ...structuredClone(parent), number: n, title: data!.title!, body: data!.body!, user: { login: this.bot }, draft: true, changed_files: 2, html_url: `https://github.com/${repo}/pull/${n}`, head: { ...parent.head, ref: data!.head!, sha: this.store.refs.get(data!.head!)! }, base: { ...parent.base, ref: data!.base!, sha: this.store.refs.get(data!.base!)! } };
            this.store.pulls.set(n, pull); return pull;
          }
          const head = url.searchParams.get("head")?.split(":")[1];
          return [...this.store.pulls.values()].filter(p => head ? p.head.ref === head : p.state === "open");
        }
        const number = Number(parts[1]);
        if (parts[2] === "reviews") return this.store.reviews.get(number) ?? [];
        if (parts[2] === "comments") return [];
        const pull = this.store.pulls.get(number)!;
        if (method === "PATCH") {
          if (data?.base) pull.base.ref = data.base;
          if (data?.body) pull.body = data.body;
          if (data?.title) pull.title = data.title;
        }
        return structuredClone(pull);
      }
      if (parts[0] === "issues") {
        if (parts[1] === "comments") {
          const comment = [...this.store.comments.values()].flat().find(c => c.id === Number(parts[2]))!;
          if (method === "DELETE") {
            for (const [number, comments] of this.store.comments) this.store.comments.set(number, comments.filter(c => c.id !== comment.id));
            return undefined;
          }
          comment.body = data!.body!; return comment;
        }
        const number = Number(parts[1]);
        const comments = this.store.comments.get(number) ?? [];
        if (method === "POST") {
          const comment: Comment = { id: this.store.next++, body: data!.body!, user: { login: this.bot, type: "Bot" } };
          comments.push(comment); this.store.comments.set(number, comments); return comment;
        }
        return comments;
      }
      throw new Error(`unhandled fixture route: ${route}`);
    };
    // JSON round-trip mimics independent API reads instead of shared references.
    const result = structuredClone(output()) as T;
    if (method === "GET") this.store.afterRead?.(route);
    return result;
  }
  override async ref(branch: string) { return this.store.refs.get(branch) ?? null; }
}
class FakeGit extends Git {
  pushes: string[] = [];
  fetches: string[] = [];
  failBranch?: string;
  afterPush?: () => void;
  constructor(cwd: string, readonly store: Store) { super(cwd); }
  override fetch(_repo: string, sha: string) { this.fetches.push(sha); this.treeId(sha); }
  override push(_repo: string, branch: string, sha: string, expected: string | null) {
    if (this.failBranch === branch) { this.failBranch = undefined; throw new Error("simulated push interruption"); }
    if ((this.store.refs.get(branch) ?? null) !== expected) throw new Error("lease failed");
    this.store.refs.set(branch, sha); this.pushes.push(branch);
    for (const pull of this.store.pulls.values()) if (pull.head.ref === branch) pull.head.sha = sha;
    this.afterPush?.();
  }
}
function fixture(names = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"]) {
  const directory = mkdtempSync(path.join(tmpdir(), "review-split-controller-")); directories.push(directory);
  const store = new Store();
  const git = new FakeGit(directory, store);
  git.run(["init", "-b", "main"]); git.run(["config", "user.name", "Test"]); git.run(["config", "user.email", "test@example.com"]);
  const commit = () => { git.run(["add", "--all"]); git.run(["commit", "-m", "fixture"]); return git.text(["rev-parse", "HEAD"]); };
  writeFileSync(path.join(directory, "base.txt"), "base"); const base = commit();
  names.forEach(n => { mkdirSync(path.dirname(path.join(directory, n)), { recursive: true }); writeFileSync(path.join(directory, n), "source"); }); const head = commit();
  const pull: Pull = { number: 1, title: "Source", body: "source body", state: "open", draft: false, merged: false, mergeable: true, merge_commit_sha: null, changed_files: names.length, user: { login: "human" }, html_url: `https://github.com/${repo}/pull/1`, head: { sha: head, ref: "feature", repo: { full_name: repo } }, base: { sha: base, ref: "main", repo: { full_name: repo } }, requested_reviewers: [], requested_teams: [] };
  store.pulls.set(1, pull); store.refs.set("main", base);
  const reader = new FakeApi(store), writer = new FakeApi(store, appBot);
  const options = { enabled: true, writer, appBot, stateKey: key };
  const state = () => decodeState(store.comments.get(1)!.find(c => c.body.startsWith(STATE_MARKER))!.body, key, 1);
  return { directory, store, git, reader, writer, options, pull, commit, state };
}
afterEach(() => directories.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));

describe("PR stack automation", () => {
  it.each([false, true])("does not notify small unknown PRs, including API failure=%s", async fail => {
    const f = fixture(["small.txt"]); f.store.failStatuses = fail;
    await reconcile(f.reader, f.git, config, 1, f.options);
    expect(f.store.writes).toHaveLength(0);
    expect(f.git.pushes).toHaveLength(0);
  });
  it.each(["pending", "success"])("does not notify small PRs with %s review signals", async state => {
    const f = fixture(["small.txt"]);
    f.store.statuses = [{ sha: f.pull.head.sha, context: "CodeRabbit", state, description: "review", creator: { login: config.reviewBot }, created_at: "2026-10-12" }];
    f.store.reviews.set(1, [{ user: { login: config.reviewBot }, state: "COMMENTED", commit_id: f.pull.head.sha, body: "reviewed" }]);
    await reconcile(f.reader, f.git, config, 1, f.options);
    expect(f.store.writes).toHaveLength(0);
  });
  it("still notifies explicit skipped reviews below the size limit", async () => {
    const f = fixture(["small.txt"]);
    f.store.statuses = [{ sha: f.pull.head.sha, context: "CodeRabbit", state: "success", description: "Review skipped", creator: { login: config.reviewBot }, created_at: "2026-10-12" }];
    await reconcile(f.reader, f.git, config, 1, f.options);
    expect(f.store.comments.get(1)?.[0].body).toContain("省略");
    expect(f.git.pushes).toHaveLength(0);
  });
  it.each(["appBot", "stateKey"] as const)("keeps a stop notice when an operation record exists but %s is missing", async missing => {
    const f = fixture(["small.txt"]);
    f.store.comments.set(1, [{ id: 900, body: `${STATE_MARKER} record`, user: { login: appBot, type: "Bot" } }]);
    const options = { ...f.options, [missing]: undefined };
    expect(await reconcile(f.reader, f.git, config, 1, options)).toContain("設定が不足");
    expect(f.store.comments.get(1)?.find(c => c.id === 900)).toBeDefined();
    expect(f.store.writes.some(w => w.method === "DELETE")).toBe(false);
    expect(f.git.pushes).toHaveLength(0);
  });
  it("removes only the automation's old notice on a small PR", async () => {
    const f = fixture(["small.txt"]);
    f.store.comments.set(1, [
      { id: 900, body: `${NOTICE_MARKER} old`, user: { login: "github-actions[bot]", type: "Bot" } },
      { id: 901, body: `${NOTICE_MARKER} human`, user: { login: "human", type: "User" } },
      { id: 902, body: `${STATE_MARKER} record`, user: { login: "github-actions[bot]", type: "Bot" } },
    ]);
    await reconcile(f.reader, f.git, config, 1, f.options);
    expect(f.store.comments.get(1)?.map(c => c.id)).toEqual([901, 902]);
    expect(f.store.writes).toEqual([{ route: "/issues/comments/900", method: "DELETE" }]);
    await reconcile(f.reader, f.git, config, 1, f.options);
    expect(f.store.writes).toHaveLength(1);
  });

  it("creates a draft stack with an exact final tree and reuses it without writes", async () => {
    const f = fixture();
    await reconcile(f.reader, f.git, config, 1, f.options);
    const state = f.state();
    expect(state.parts).toHaveLength(3); expect(state.operation).toBe("idle");
    expect(f.git.treeId(state.parts.at(-1)!.sha)).toBe(f.git.treeId(f.pull.head.sha));
    state.parts.forEach((p, i) => { const created = f.store.pulls.get(p.pr!)!; expect(created.draft).toBe(true); expect(created.base.ref).toBe(i ? state.parts[i - 1].branch : "main"); });
    const original = structuredClone(f.pull); const writes = f.store.writes.length;
    await reconcile(f.reader, f.git, config, 1, f.options);
    expect(f.store.writes).toHaveLength(writes); expect(f.pull).toEqual(original); expect(f.git.pushes).toHaveLength(3);
  });
  it("recovers after a branch push and failed PR creation without duplicate refs or PRs", async () => {
    const f = fixture(); f.store.failCreation = true;
    expect(await reconcile(f.reader, f.git, config, 1, f.options)).toContain("停止");
    expect(f.state().operation).toBe("create"); expect(f.git.pushes).toHaveLength(1);
    const planned = f.state().parts.map(p => p.sha); f.git.fetches = [];
    await reconcile(f.reader, f.git, config, 1, f.options);
    expect(f.state().operation).toBe("idle"); expect(f.store.pulls.size).toBe(4); expect(f.git.pushes).toHaveLength(3);
    expect(f.git.fetches.some(sha => planned.includes(sha))).toBe(false);
  });
  it("updates untouched drafts and preserves a source update byte-for-byte", async () => {
    const f = fixture(); await reconcile(f.reader, f.git, config, 1, f.options);
    const before = f.state(); writeFileSync(path.join(f.directory, "a.txt"), "new source"); f.pull.head.sha = f.commit();
    await reconcile(f.reader, f.git, config, 1, f.options);
    expect(f.state().head).toBe(f.pull.head.sha); expect(f.state().parts.map(p => p.pr)).toEqual(before.parts.map(p => p.pr));
    expect(f.git.treeId(f.state().parts.at(-1)!.sha)).toBe(f.git.treeId(f.pull.head.sha));
  });
  it.each(["branch", "body", "base", "ready", "review", "comment", "third-party-bot"])("stops source updates after human %s changes, before any push", async kind => {
    const f = fixture(); await reconcile(f.reader, f.git, config, 1, f.options);
    const part = f.state().parts[0], generated = f.store.pulls.get(part.pr!)!;
    if (kind === "branch") { generated.head.sha = f.pull.head.sha; f.store.refs.set(part.branch, f.pull.head.sha); }
    if (kind === "body") generated.body += "human edit";
    if (kind === "base") generated.base.ref = "other";
    if (kind === "ready") generated.draft = false;
    if (kind === "review") f.store.reviews.set(generated.number, [{ user: { login: "reviewer" }, state: "COMMENTED", commit_id: part.sha, body: "review" }]);
    if (kind === "comment") f.store.comments.set(generated.number, [{ id: 999, body: "review started", user: { login: "human", type: "User" } }]);
    if (kind === "third-party-bot") f.store.comments.set(generated.number, [{ id: 999, body: "review started", user: { login: "external-app[bot]", type: "Bot" } }]);
    const pushes = f.git.pushes.length;
    writeFileSync(path.join(f.directory, "a.txt"), "updated"); f.pull.head.sha = f.commit();
    expect(await reconcile(f.reader, f.git, config, 1, f.options)).toContain("停止"); expect(f.git.pushes).toHaveLength(pushes);
  });
  it("restacks after squash merge, retargets the next PR, and keeps unrelated main work", async () => {
    const f = fixture(); await reconcile(f.reader, f.git, config, 1, f.options);
    const before = f.state(), first = f.store.pulls.get(before.parts[0].pr!)!;
    const squash = f.git.commit(f.git.treeId(before.parts[0].sha), before.base, before.head, "squash");
    f.git.run(["checkout", squash]); writeFileSync(path.join(f.directory, "unrelated.txt"), "main work"); const main = f.commit();
    f.store.refs.set("main", main); f.pull.base.sha = main;
    first.merged = true; first.state = "closed"; first.merge_commit_sha = squash;
    // GitHub deletes the merged branch and can retarget the next PR itself.
    f.store.refs.delete(before.parts[0].branch);
    f.store.pulls.get(before.parts[1].pr!)!.base.ref = "main";
    await reconcile(f.reader, f.git, config, 1, f.options);
    const state = f.state(); expect(state.merged).toBe(1); expect(state.operation).toBe("idle");
    expect(f.store.pulls.get(state.parts[1].pr!)!.base.ref).toBe("main");
    expect(f.git.parent(state.parts[1].sha)).toBe(main);
    const final = f.git.tree(state.parts.at(-1)!.sha); expect(final.get("unrelated.txt")).toEqual(f.git.tree(main).get("unrelated.txt"));
    for (const [name, entry] of f.git.tree(before.head)) expect(final.get(name)).toEqual(entry);
    const pushes = f.git.pushes.length; await reconcile(f.reader, f.git, config, 1, f.options); expect(f.git.pushes).toHaveLength(pushes);
    writeFileSync(path.join(f.directory, "a.txt"), "late source change"); f.pull.head.sha = f.commit();
    expect(await reconcile(f.reader, f.git, config, 1, f.options)).toContain("取り込み後"); expect(f.git.pushes).toHaveLength(pushes);
  });
  it("refuses downstream merges", async () => {
    const f = fixture(); await reconcile(f.reader, f.git, config, 1, f.options);
    const before = f.state(), second = f.store.pulls.get(before.parts[1].pr!)!;
    second.merged = true; second.state = "closed";
    const pushes = f.git.pushes.length;
    expect(await reconcile(f.reader, f.git, config, 1, f.options)).toContain("停止"); expect(f.git.pushes).toHaveLength(pushes);
  });
  it("stops a restack conflict without pushing any generated ref", async () => {
    const f = fixture(); await reconcile(f.reader, f.git, config, 1, f.options);
    const state = f.state(), first = f.store.pulls.get(state.parts[0].pr!)!;
    const squash = f.git.commit(f.git.treeId(state.parts[0].sha), state.base, state.head, "squash");
    f.git.run(["checkout", squash]); writeFileSync(path.join(f.directory, "c.txt"), "conflicting main addition"); const main = f.commit();
    f.store.refs.set("main", main); f.pull.base.sha = main; first.merged = true; first.state = "closed"; first.merge_commit_sha = squash;
    const refs = new Map(f.store.refs), pushes = f.git.pushes.length;
    expect(await reconcile(f.reader, f.git, config, 1, f.options)).toContain("停止");
    expect(f.git.pushes).toHaveLength(pushes); expect(f.store.refs).toEqual(refs);
  });
  it("recovers after partially publishing a restack", async () => {
    const f = fixture(); await reconcile(f.reader, f.git, config, 1, f.options);
    const state = f.state(), first = f.store.pulls.get(state.parts[0].pr!)!;
    const squash = f.git.commit(f.git.treeId(state.parts[0].sha), state.base, state.head, "squash");
    f.store.refs.set("main", squash); f.pull.base.sha = squash; first.merged = true; first.state = "closed"; first.merge_commit_sha = squash;
    f.git.failBranch = state.parts[2].branch;
    expect(await reconcile(f.reader, f.git, config, 1, f.options)).toContain("停止");
    expect(f.state().operation).toBe("restack");
    const pushes = f.git.pushes.length;
    await reconcile(f.reader, f.git, config, 1, f.options);
    expect(f.state().operation).toBe("idle"); expect(f.git.pushes).toHaveLength(pushes + 1);
    expect(f.git.treeId(f.state().parts.at(-1)!.sha)).toBe(f.git.treeId(state.head));
  });
  it("rechecks human edits made after the initial guard before pushing", async () => {
    const f = fixture(); await reconcile(f.reader, f.git, config, 1, f.options);
    const first = f.store.pulls.get(f.state().parts[0].pr!)!;
    writeFileSync(path.join(f.directory, "a.txt"), "new source"); f.pull.head.sha = f.commit();
    let reads = 0;
    f.store.afterRead = route => {
      if (route.startsWith(`/pulls/${first.number}/reviews`) && ++reads === 2) first.body = "human edit between guard and push";
    };
    const pushes = f.git.pushes.length;
    expect(await reconcile(f.reader, f.git, config, 1, f.options)).toContain("停止");
    expect(f.git.pushes).toHaveLength(pushes); expect(first.body).toBe("human edit between guard and push");
  });
  it("rechecks human edits after push before patching PR metadata", async () => {
    const f = fixture(); await reconcile(f.reader, f.git, config, 1, f.options);
    const first = f.store.pulls.get(f.state().parts[0].pr!)!;
    writeFileSync(path.join(f.directory, "a.txt"), "new source"); f.pull.head.sha = f.commit();
    f.git.afterPush = () => { first.body = "human edit after push"; };
    expect(await reconcile(f.reader, f.git, config, 1, f.options)).toContain("停止");
    expect(first.body).toBe("human edit after push");
  });
  it("stops metadata publication when a generated PR merges immediately after push", async () => {
    const f = fixture(); await reconcile(f.reader, f.git, config, 1, f.options);
    const first = f.store.pulls.get(f.state().parts[0].pr!)!;
    writeFileSync(path.join(f.directory, "a.txt"), "new source"); f.pull.head.sha = f.commit();
    const previousBody = first.body;
    f.git.afterPush = () => { first.merged = true; first.state = "closed"; };
    const result = await reconcile(f.reader, f.git, config, 1, f.options);
    expect(result).toContain("マージ状態が処理中に変わりました");
    expect(first.body).toBe(previousBody); expect(f.state().operation).toBe("update");
  });
  it("analyzes with automation disabled, and does not publish with missing App credentials", async () => {
    for (const enabled of [false, true]) {
      const f = fixture();
      const result = await reconcile(f.reader, f.git, config, 1, { enabled });
      expect(result).toContain(enabled ? "設定が未完了" : "自動作成は無効");
      expect(f.git.pushes).toHaveLength(0); expect(f.store.pulls.size).toBe(1);
      expect(f.store.comments.get(1)!.filter(c => c.body.startsWith(STATE_MARKER))).toHaveLength(0);
    }
  });
  it("refuses fork, conflicts, stale base and workflow changes", async () => {
    for (const kind of ["fork", "conflict", "base", "workflow"]) {
      const f = kind === "workflow" ? fixture([".github/workflows/test.yml", "a.txt", "b.txt"]) : fixture();
      if (kind === "fork") f.pull.head.repo = { full_name: "someone/fork" };
      if (kind === "conflict") f.pull.mergeable = false;
      if (kind === "base") {
        f.git.run(["checkout", f.pull.base.sha]);
        writeFileSync(path.join(f.directory, "unrelated.txt"), "new main"); f.pull.base.sha = f.commit(); f.store.refs.set("main", f.pull.base.sha);
      }
      expect(await reconcile(f.reader, f.git, config, 1, f.options)).toContain("停止"); expect(f.git.pushes).toHaveLength(0);
    }
  });
  it("detects API failure and exact-head review evidence without leaking errors", async () => {
    const f = fixture(); f.store.failStatuses = true;
    expect(await inspectReview(f.reader, f.pull, config.reviewBot)).toContain("判定不能");
    f.store.failStatuses = false; f.store.statuses = [{ context: "CodeRabbit", state: "success", description: "Review skipped: 282 files exceed the limit of 100", creator: null, created_at: "2026-10-11" }];
    expect(await inspectReview(f.reader, f.pull, config.reviewBot)).toBe("省略");
    f.store.statuses = []; f.store.reviews.set(1, [{ user: { login: config.reviewBot }, state: "COMMENTED", commit_id: f.pull.base.sha, body: "old" }]);
    expect(await inspectReview(f.reader, f.pull, config.reviewBot)).toBe("判定不能");
  });
  it("authenticates operation records and ignores forged user markers", async () => {
    const f = fixture();
    const fake: State = { version: 1, source: 1, base: f.pull.base.sha, head: f.pull.head.sha, parts: [], merged: 0, operation: "idle" };
    const encoded = encodeState(fake, key);
    expect(() => decodeState(encoded, "other-key", 1)).toThrow(/署名/);
    expect(() => decodeState(encoded, key, 2)).toThrow(/形式/);
    f.store.comments.set(1, [{ id: 999, body: encoded, user: { login: "human", type: "User" } }]);
    await reconcile(f.reader, f.git, config, 1, f.options);
    expect(f.store.pulls.size).toBe(4);
    expect(f.store.comments.get(1)!.filter(c => c.body.startsWith(NOTICE_MARKER))).toHaveLength(1);
  });
  it("maps generated PR events back to the source and rejects malformed dispatch inputs", async () => {
    const f = fixture(); await reconcile(f.reader, f.git, config, 1, f.options);
    const generated = f.store.pulls.get(f.state().parts[0].pr!)!;
    expect(await discover(f.reader, { pull_request: generated })).toEqual([1]);
    expect(await discover(f.reader, {})).toEqual([1]);
    await expect(discover(f.reader, { inputs: { pr: "1; malicious-command" } })).rejects.toThrow(/番号/);
    expect(await reconcile(f.reader, f.git, config, generated.number, f.options)).toContain("再分割しません");
  });
});
