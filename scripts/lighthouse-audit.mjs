#!/usr/bin/env node
/**
 * Run Lighthouse CI (collect + assert + filesystem upload) and write a Step Summary.
 * Also compares median scores against config/lighthouse-baseline.json when present.
 *
 * Expects a production-like server already running at SITE_URL.
 *
 * Usage:
 *   SITE_URL=http://127.0.0.1:3000 node scripts/lighthouse-audit.mjs
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const config = JSON.parse(readFileSync(join(root, "config/web-audit.json"), "utf8"));
const baselinePath = join(root, "config/lighthouse-baseline.json");
const outDir = join(root, ".web-audit");
const lhDir = join(outDir, "lighthouse");

const baseUrl = (process.env.SITE_URL || config.defaultBaseUrl).replace(/\/$/, "");
const categories = ["performance", "accessibility", "best-practices", "seo"];
const thresholds = config.lighthouse.thresholds;
const targetThresholds = config.lighthouse.targetThresholds;
const regression = config.lighthouse.regression;

mkdirSync(lhDir, { recursive: true });

console.log(`Lighthouse audit against ${baseUrl}`);
console.log(`Thresholds: ${JSON.stringify(thresholds)}`);
console.log(`Target thresholds (docs): ${JSON.stringify(targetThresholds)}`);

const lhciBin = join(root, "node_modules", ".bin", "lhci");
if (!existsSync(lhciBin)) {
  console.error("@lhci/cli is not installed. Run npm ci / npm install first.");
  process.exit(1);
}

const result = spawnSync(lhciBin, ["autorun", "--config=./lighthouserc.cjs"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

const lhciFailed = result.status !== 0;

/** @type {Record<string, Record<string, number[]>>} */
const scoresByPage = {};

function pathnameFromUrl(url) {
  try {
    const path = new URL(url).pathname;
    return path === "" ? "/" : path;
  } catch {
    return url;
  }
}

function collectFromManifest() {
  const manifestPath = join(lhDir, "manifest.json");
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const entry of manifest) {
    const page = pathnameFromUrl(entry.url || entry.requestedUrl || "");
    if (!scoresByPage[page]) scoresByPage[page] = Object.fromEntries(categories.map((c) => [c, []]));
    const summary = entry.summary || {};
    for (const category of categories) {
      const value = summary[category];
      if (typeof value === "number") scoresByPage[page][category].push(value);
    }
  }
}

function collectFromJsonReports() {
  if (!existsSync(lhDir)) return;
  for (const name of readdirSync(lhDir)) {
    if (!name.endsWith(".json") || name === "manifest.json") continue;
    try {
      const report = JSON.parse(readFileSync(join(lhDir, name), "utf8"));
      if (!report.categories || !report.requestedUrl) continue;
      const page = pathnameFromUrl(report.finalUrl || report.requestedUrl);
      if (!scoresByPage[page]) scoresByPage[page] = Object.fromEntries(categories.map((c) => [c, []]));
      for (const category of categories) {
        const score = report.categories[category]?.score;
        if (typeof score === "number") scoresByPage[page][category].push(score);
      }
    } catch {
      // ignore non-report json
    }
  }
}

collectFromManifest();
if (Object.keys(scoresByPage).length === 0) collectFromJsonReports();

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** @type {Record<string, Record<string, number|null>>} */
const medians = {};
for (const [page, cats] of Object.entries(scoresByPage)) {
  medians[page] = {};
  for (const category of categories) {
    medians[page][category] = median(cats[category] || []);
  }
}

/** @type {string[]} */
const regressionFails = [];
let baseline = { pages: {} };
if (existsSync(baselinePath)) {
  baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
}

for (const [page, cats] of Object.entries(medians)) {
  const base = baseline.pages?.[page];
  if (!base) continue;
  for (const category of categories) {
    const current = cats[category];
    const previous = base[category];
    if (typeof current !== "number" || typeof previous !== "number") continue;
    const allowedDrop = regression[category] ?? 0.05;
    const drop = previous - current;
    if (drop > allowedDrop + 1e-9) {
      regressionFails.push(
        `${page} ${category}: ${Math.round(previous * 100)} → ${Math.round(current * 100)} (drop ${(drop * 100).toFixed(1)} > allowed ${(allowedDrop * 100).toFixed(0)})`,
      );
    }
  }
}

function pct(score) {
  if (typeof score !== "number") return "n/a";
  return String(Math.round(score * 100));
}

const lines = [
  "## Lighthouse",
  "",
  `Base URL: \`${baseUrl}\``,
  "",
  `Runs per URL: **${config.lighthouse.numberOfRuns}** (assert uses median)`,
  "",
  "| Page | Performance | Accessibility | Best Practices | SEO |",
  "| --- | ---: | ---: | ---: | ---: |",
];

const pages = Object.keys(medians).sort();
if (pages.length === 0) {
  lines.push("| _(no scores parsed)_ | - | - | - | - |");
} else {
  for (const page of pages) {
    const c = medians[page];
    lines.push(`| ${page} | ${pct(c.performance)} | ${pct(c.accessibility)} | ${pct(c["best-practices"])} | ${pct(c.seo)} |`);
  }
}

lines.push("", "### Thresholds (current CI floors)", "");
lines.push("| Category | Floor | Target |");
lines.push("| --- | ---: | ---: |");
for (const category of categories) {
  lines.push(`| ${category} | ${pct(thresholds[category])} | ${pct(targetThresholds[category])} |`);
}

if (regressionFails.length > 0) {
  lines.push("", "### Regression failures", "");
  for (const fail of regressionFails) lines.push(`- ${fail}`);
} else if (Object.keys(baseline.pages || {}).length > 0) {
  lines.push("", "Regression check: no excessive drops vs `config/lighthouse-baseline.json`.");
} else {
  lines.push("", "Regression check: baseline empty — thresholds only. After stabilizing scores, fill `config/lighthouse-baseline.json`.");
}

lines.push("", `LHCI exit: ${lhciFailed ? "FAIL" : "PASS"}`);

const markdown = lines.join("\n");
console.log(`\n${markdown}\n`);

writeFileSync(join(outDir, "lighthouse-summary.md"), markdown, "utf8");
writeFileSync(
  join(outDir, "lighthouse-summary.json"),
  JSON.stringify({ baseUrl, thresholds, targetThresholds, medians, regressionFails, lhciFailed }, null, 2),
  "utf8",
);

if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, { flag: "a" });
}

if (lhciFailed || regressionFails.length > 0) {
  process.exit(1);
}
console.log("Lighthouse audit passed.");
