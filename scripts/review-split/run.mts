import { readFileSync, appendFileSync } from "node:fs";
import { Github, type Pull } from "./github.mjs";
import { Git } from "./git.mjs";
import { reconcile, type Config } from "./reconcile.mjs";

export function readConfig(filename: string): Config {
  const config: Config = JSON.parse(readFileSync(filename, "utf8"));
  for (const field of ["fileLimit", "maxFiles", "maxSourceBytes", "maxGroups"] as const) {
    if (!Number.isSafeInteger(config[field]) || config[field] < 1) throw new Error(`設定 ${field} が不正です`);
  }
  if (config.fileLimit > config.maxFiles || config.maxFiles > 3000 || config.maxGroups > 100 || !/^[a-z0-9-]+\[bot\]$/.test(config.reviewBot)) throw new Error("自動分割の設定が不正です");
  return config;
}

export async function discover(api: Github, event: { pull_request?: Pull; sha?: string; inputs?: { pr?: string } }): Promise<number[]> {
  const sourceNumber = (pull: Pull) => {
    const match = pull.head.ref.match(/^review-split\/(\d+)\/\d+$/);
    return match ? Number(match[1]) : pull.number;
  };
  if (event.inputs?.pr) {
    const n = Number(event.inputs.pr);
    if (!/^\d+$/.test(event.inputs.pr) || !Number.isSafeInteger(n) || n < 1) throw new Error("PR 番号が不正です");
    return [sourceNumber(await api.pull(n))];
  }
  if (event.pull_request) return [sourceNumber(event.pull_request)];
  const pulls = event.sha && /^[a-f0-9]{40}$/.test(event.sha)
    ? await api.list<Pull>(`/commits/${event.sha}/pulls`)
    : await api.list<Pull>("/pulls?state=open");
  if (pulls.length > 200) throw new Error("同時に評価できる PR 数の上限を超えています");
  return [...new Set(pulls.map(sourceNumber))].sort((a, b) => a - b);
}

// Kept separate from exports so importing helpers in tests has no side effects.
async function main() {
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const token = process.env.GH_TOKEN ?? "";
  if (!token) throw new Error("GH_TOKEN が必要です");
  const api = new Github(repo, token);
  if (process.argv[2] === "discover") {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8"));
    const numbers = await discover(api, event);
    if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT が必要です");
    appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify({ include: numbers.map(pr => ({ pr })) })}\ncount=${numbers.length}\n`);
    return;
  }
  const number = Number(process.env.REVIEW_SPLIT_PR);
  const config = readConfig("config/review-split.json");
  const appToken = process.env.REVIEW_SPLIT_TOKEN;
  const message = await reconcile(api, new Git(process.cwd()), config, number, {
    enabled: process.env.REVIEW_SPLIT_ENABLED === "true",
    writer: appToken ? new Github(repo, appToken) : undefined,
    stateKey: process.env.REVIEW_SPLIT_STATE_KEY,
    appBot: process.env.REVIEW_SPLIT_APP_BOT,
  });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + "\n");
}
if (process.argv[1]?.endsWith("/review-split/run.mjs")) {
  main().catch(() => { console.error("Review split の実行に失敗しました。設定・権限・API 可用性を確認してください。"); process.exitCode = 1; });
}
