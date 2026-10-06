#!/usr/bin/env node
/**
 * 過去7日間の GitHub 活動を集計し、Weekly Development Report Issue を
 * 作成または更新する(冪等: 同一タイトルがあれば本文を更新)。
 *
 * 前提: gh CLI が認証済み(GITHUB_TOKEN 等)。
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const REPO = process.env.GITHUB_REPOSITORY;
if (!REPO) {
  console.error("GITHUB_REPOSITORY is required");
  process.exit(1);
}

const LABEL = "weekly-report";
const DAYS = Number(process.env.WEEKLY_REPORT_DAYS || "7");

function gh(args, { json = false } = {}) {
  const stdout = execFileSync("gh", args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!json) {
    return stdout.trim();
  }
  const text = stdout.trim();
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

function ensureLabel() {
  try {
    gh([
      "label",
      "create",
      LABEL,
      "--repo",
      REPO,
      "--description",
      "Automated weekly development reports",
      "--color",
      "0E8A16",
      "--force",
    ]);
  } catch (error) {
    console.warn(
      `label ensure skipped: ${error instanceof Error ? error.message : error}`
    );
  }
}

function searchIssues(query) {
  const result = gh(
    [
      "api",
      "search/issues",
      "--method",
      "GET",
      "-f",
      `q=${query}`,
      "-f",
      "per_page=100",
    ],
    { json: true }
  );
  return {
    total: Number(result?.total_count || 0),
    items: Array.isArray(result?.items) ? result.items : [],
  };
}

function listCommitLines(sinceIso) {
  // --paginate の JSON 連結を避け、sha 行だけを数える。
  const text = gh([
    "api",
    "--paginate",
    `repos/${REPO}/commits?since=${encodeURIComponent(sinceIso)}&per_page=100`,
    "--jq",
    ".[].sha",
  ]);
  if (!text) {
    return [];
  }
  return text.split("\n").filter(Boolean);
}

function listRecentCommitMessages(sinceIso, limit = 15) {
  const text = gh([
    "api",
    `repos/${REPO}/commits?since=${encodeURIComponent(sinceIso)}&per_page=${limit}`,
    "--jq",
    '.[] | "- `\\(.sha[0:7])` \\(.commit.message | split("\\n")[0])"',
  ]);
  return text || "_なし_";
}

function workflowStats(sinceDay) {
  const text = gh([
    "api",
    "--paginate",
    `repos/${REPO}/actions/runs?created=>=${sinceDay}&per_page=100`,
    "--jq",
    '.workflow_runs[] | [.name, (.conclusion // "null")] | @tsv',
  ]);
  /** @type {Record<string, { total: number; success: number; failed: number }>} */
  const stats = {};
  for (const line of text ? text.split("\n") : []) {
    if (!line.trim()) {
      continue;
    }
    const [name, conclusion] = line.split("\t");
    const bucket = (stats[name] ??= { total: 0, success: 0, failed: 0 });
    bucket.total += 1;
    if (conclusion === "success") {
      bucket.success += 1;
    } else if (conclusion === "failure") {
      bucket.failed += 1;
    }
  }
  return stats;
}

function bulletIssues(items, empty = "_なし_") {
  if (!items.length) {
    return empty;
  }
  return items
    .slice(0, 30)
    .map((item) => `- #${item.number} ${item.title}`)
    .join("\n");
}

const end = new Date();
const start = new Date(end.getTime() - DAYS * 24 * 60 * 60 * 1000);
const startIso = start.toISOString();
const startDay = startIso.slice(0, 10);
const endDay = end.toISOString().slice(0, 10);
const title = `Weekly Development Report - ${endDay}`;

console.log(`Collecting activity for ${REPO} from ${startIso} to ${end.toISOString()}`);

const commitShas = listCommitLines(startIso);
const commitMessages = listRecentCommitMessages(startIso);

const prsOpened = searchIssues(`repo:${REPO} is:pr created:>=${startDay}`);
const prsMerged = searchIssues(`repo:${REPO} is:pr is:merged merged:>=${startDay}`);
const issuesOpened = searchIssues(
  `repo:${REPO} is:issue created:>=${startDay} -label:${LABEL}`
);
const issuesClosed = searchIssues(
  `repo:${REPO} is:issue is:closed closed:>=${startDay} -label:${LABEL}`
);

const openedPrItems = prsOpened.items.filter(
  (item) => !item.title?.startsWith("Weekly Development Report")
);
const mergedPrItems = prsMerged.items;
const openedIssueItems = issuesOpened.items.filter(
  (item) => !item.title?.startsWith("Weekly Development Report")
);
const closedIssueItems = issuesClosed.items.filter(
  (item) => !item.title?.startsWith("Weekly Development Report")
);

const dependabotMerged = mergedPrItems.filter(
  (item) =>
    item.user?.login === "dependabot[bot]" ||
    /^bump /i.test(item.title || "")
);

const stats = workflowStats(startDay);
const pick = (name) => stats[name] || { total: 0, success: 0, failed: 0 };
const ciSummary = pick("CI");
const deploySummary = pick("Deploy to Cloudflare Workers");
const e2eSummary = pick("E2E (post-deploy)");
const linkSummary = pick("Link Check");

const openPrs = gh(
  ["api", `repos/${REPO}/pulls?state=open&per_page=50`],
  { json: true }
);
const openIssues = searchIssues(
  `repo:${REPO} is:issue is:open -label:${LABEL}`
);

const highlights = [];
if (mergedPrItems.length) {
  highlights.push(
    `マージされた PR の主なもの: ${mergedPrItems
      .slice(0, 5)
      .map((item) => `#${item.number}`)
      .join(", ")}`
  );
}
if (dependabotMerged.length) {
  highlights.push(`Dependabot 関連のマージ: ${dependabotMerged.length} 件`);
}
if (deploySummary.failed || e2eSummary.failed || linkSummary.failed) {
  highlights.push("CI/品質系で失敗ランあり(下の CI / Quality を確認)");
}
if (!highlights.length) {
  highlights.push("特記事項なし");
}

const body = `# Weekly Development Report

期間: ${startDay} ～ ${endDay}

## Summary

- Commits: ${commitShas.length}${commitShas.length >= 100 ? " (取得上限付近。実際はそれ以上の可能性あり)" : ""}
- PRs merged: ${prsMerged.total}
- PRs opened: ${prsOpened.total}
- Issues opened: ${issuesOpened.total}
- Issues closed: ${issuesClosed.total}

## Pull Requests

### Merged

${bulletIssues(mergedPrItems)}

### Opened

${bulletIssues(openedPrItems)}

## Issues

### Opened

${bulletIssues(openedIssueItems)}

### Closed

${bulletIssues(closedIssueItems)}

## Commits (recent)

${commitMessages}

## CI / Quality

| Workflow | Runs | Success | Failed |
| --- | ---: | ---: | ---: |
| CI | ${ciSummary.total} | ${ciSummary.success} | ${ciSummary.failed} |
| Deploy to Cloudflare Workers | ${deploySummary.total} | ${deploySummary.success} | ${deploySummary.failed} |
| E2E (post-deploy) | ${e2eSummary.total} | ${e2eSummary.success} | ${e2eSummary.failed} |
| Link Check | ${linkSummary.total} | ${linkSummary.success} | ${linkSummary.failed} |

## Dependabot

- Merged Dependabot / bump PRs: ${dependabotMerged.length}
${bulletIssues(dependabotMerged, "_該当なし_")}

## Highlights

${highlights.map((line) => `- ${line}`).join("\n")}

## Next / Remaining

### Open PRs

${bulletIssues(Array.isArray(openPrs) ? openPrs : [], "_なし_")}

### Open Issues

${bulletIssues(openIssues.items, "_なし_")}

---

_この Issue は GitHub Actions (\`weekly-report.yml\`) により自動生成されています。_
`;

writeFileSync("weekly-report.md", body, "utf8");
ensureLabel();

// Search API は遅延があるため、ラベル付き Issue を REST で列挙してタイトル完全一致を探す。
function findExistingReportIssue(reportTitle) {
  let page = 1;
  while (page <= 10) {
    const batch = gh(
      [
        "api",
        `repos/${REPO}/issues?labels=${encodeURIComponent(LABEL)}&state=all&per_page=100&page=${page}`,
      ],
      { json: true }
    );
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }
    const hit = batch.find(
      (item) => !item.pull_request && item.title === reportTitle
    );
    if (hit) {
      return hit;
    }
    if (batch.length < 100) {
      break;
    }
    page += 1;
  }
  return null;
}

const existingIssue = findExistingReportIssue(title);

if (existingIssue) {
  console.log(`Updating existing issue #${existingIssue.number}`);
  gh([
    "issue",
    "edit",
    String(existingIssue.number),
    "--repo",
    REPO,
    "--body-file",
    "weekly-report.md",
    "--add-label",
    LABEL,
  ]);
  console.log(`Updated #${existingIssue.number}`);
} else {
  console.log("Creating new weekly report issue");
  const url = gh([
    "issue",
    "create",
    "--repo",
    REPO,
    "--title",
    title,
    "--body-file",
    "weekly-report.md",
    "--label",
    LABEL,
  ]);
  console.log(`Created: ${url}`);
}
