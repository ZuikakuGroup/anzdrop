import { createHmac, timingSafeEqual } from "node:crypto";

export type Pull = {
  number: number; title: string; body: string | null; state: string; draft: boolean;
  merged: boolean; mergeable: boolean | null; merge_commit_sha: string | null;
  user: { login: string }; html_url: string; changed_files: number;
  head: { sha: string; ref: string; repo: { full_name: string } | null };
  base: { sha: string; ref: string; repo: { full_name: string } };
  requested_reviewers: { login: string }[]; requested_teams: { slug: string }[];
};
export type Comment = { id: number; body: string; user: { login: string; type: string } };
export type Part = { branch: string; sha: string; previous: string | null; paths: string[]; reasons: string[]; pr?: number; body: string; title: string; previousBody?: string; previousTitle?: string; merged: boolean };
export type State = { version: 1; source: number; base: string; head: string; parts: Part[]; merged: number; operation: "create" | "update" | "restack" | "idle" };
export const STATE_MARKER = "<!-- anzdrop-review-split-state:v1 -->";
export const NOTICE_MARKER = "<!-- anzdrop-review-split-notice:v1 -->";

export class ApiError extends Error {
  constructor(readonly status: number) { super(`GitHub API が HTTP ${status} を返しました`); }
}
export class Github {
  constructor(readonly repo: string, readonly token: string, readonly request: typeof fetch = fetch) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("リポジトリ名が不正です");
  }
  async api<T>(route: string, method = "GET", body?: unknown): Promise<T> {
    if (!route.startsWith("/") || route.startsWith("//")) throw new Error("API パスが不正です");
    const response = await this.request(`https://api.github.com/repos/${this.repo}${route}`, {
      method, headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000), redirect: "error",
    });
    if (!response.ok) throw new ApiError(response.status);
    return response.status === 204 ? undefined as T : await response.json() as T;
  }
  async list<T>(route: string): Promise<T[]> {
    const result: T[] = [];
    for (let page = 1; page <= 100; page++) {
      const rows = await this.api<T[]>(`${route}${route.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      if (!Array.isArray(rows)) throw new Error("GitHub API の一覧応答が不正です");
      result.push(...rows);
      if (rows.length < 100) return result;
    }
    throw new Error("GitHub API の一覧取得が上限を超えました");
  }
  pull(number: number) {
    if (!Number.isSafeInteger(number) || number < 1) throw new Error("PR 番号が不正です");
    return this.api<Pull>(`/pulls/${number}`);
  }
  async ref(branch: string): Promise<string | null> {
    try { return (await this.api<{ object: { sha: string } }>(`/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha; }
    catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
  }
  async removeComment(number: number, marker: string, owner: string): Promise<void> {
    const comments = await this.list<Comment>(`/issues/${number}/comments`);
    for (const comment of comments.filter(c => c.user.login === owner && c.body.startsWith(marker))) {
      await this.api(`/issues/comments/${comment.id}`, "DELETE");
    }
  }
  async comment(number: number, marker: string, body: string, owner: string): Promise<Comment> {
    const comments = await this.list<Comment>(`/issues/${number}/comments`);
    const matches = comments.filter(c => c.user.login === owner && c.body.startsWith(marker));
    if (matches.length > 1) throw new Error("自動化コメントが重複しています");
    const old = matches[0];
    if (old?.body === body) return old;
    return old ? this.api<Comment>(`/issues/comments/${old.id}`, "PATCH", { body }) : this.api<Comment>(`/issues/${number}/comments`, "POST", { body });
  }
}

export function encodeState(state: State, key: string): string {
  if (!key) throw new Error("状態署名鍵が未設定です");
  const data = Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature = createHmac("sha256", key).update(data).digest("hex");
  return `${STATE_MARKER}\n自動分割の操作記録です。手動で編集しないでください。\n\n<!-- ${data}.${signature} -->`;
}
export function decodeState(body: string, key: string, source: number): State {
  const match = body.match(/<!-- ([A-Za-z0-9_-]+)\.([a-f0-9]{64}) -->$/);
  if (!body.startsWith(STATE_MARKER) || !match || !key) throw new Error("操作記録が不正です");
  const expected = createHmac("sha256", key).update(match[1]).digest();
  if (!timingSafeEqual(expected, Buffer.from(match[2], "hex"))) throw new Error("操作記録の署名が一致しません");
  const state: State = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
  if (state.version !== 1 || state.source !== source || !Array.isArray(state.parts) || !Number.isInteger(state.merged) || state.merged < 0 || state.merged > state.parts.length) throw new Error("操作記録の形式が不正です");
  return state;
}

export function canEdit(pull: Pull, part: Part, appBot: string, reviews: { user: { login: string }; state: string }[], comments: Comment[], reviewComments: { user: { login: string; type: string } }[]): boolean {
  return pull.user.login === appBot && pull.state === "open" && pull.draft && !pull.merged
    && pull.head.ref === part.branch && pull.head.sha === part.sha
    && pull.body === part.body && pull.title === part.title
    && pull.requested_reviewers.length === 0 && pull.requested_teams.length === 0
    && reviews.every(r => r.user.login === appBot || r.user.login === "coderabbitai[bot]")
    && [...comments, ...reviewComments].every(c => [appBot, "coderabbitai[bot]", "github-actions[bot]"].includes(c.user.login));
}
