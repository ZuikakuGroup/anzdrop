/**
 * Lighthouse CI config for Anzdrop.
 *
 * Thresholds live in config/web-audit.json (source of truth for docs/scripts).
 * `thresholds` are CI floors; `targetThresholds` document the long-term goals
 * (may diverge if Performance needs a temporary lower floor for runner variance).
 *
 * Server must already be running (collect.startServerCommand is unused so local
 * and CI share the same start/wait pattern).
 */

/* eslint-disable @typescript-eslint/no-require-imports -- LHCI loads CommonJS config */
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const config = JSON.parse(readFileSync(join(__dirname, "config/web-audit.json"), "utf8"));
const baseUrl = (process.env.SITE_URL || config.defaultBaseUrl).replace(/\/$/, "");
const pages = (process.env.LIGHTHOUSE_PAGES?.split(",").map((p) => p.trim()).filter(Boolean)) || config.pages;
const thresholds = config.lighthouse.thresholds;

module.exports = {
  ci: {
    collect: {
      url: pages.map((page) => new URL(page, `${baseUrl}/`).href),
      numberOfRuns: config.lighthouse.numberOfRuns ?? 3,
      settings: {
        // Mobile-ish default is fine for CI; keep chrome flags quiet for Actions.
        chromeFlags: "--no-sandbox --disable-dev-shm-usage --headless=new",
        // CI は http://127.0.0.1 で計測するため HTTPS 系 audit を集計から外す
        // (本番は Cloudflare 終端の HTTPS。カテゴリスコアを歪めない)。
        skipAudits: ["is-on-https", "redirects-http"],
      },
    },
    assert: {
      assertionMethod: "median",
      assertions: {
        "categories:performance": ["error", { minScore: thresholds.performance }],
        "categories:accessibility": ["error", { minScore: thresholds.accessibility }],
        "categories:best-practices": ["error", { minScore: thresholds["best-practices"] }],
        "categories:seo": ["error", { minScore: thresholds.seo }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: ".web-audit/lighthouse",
      reportFilenamePattern: "%%PATHNAME%%-%%DATETIME%%-report.%%EXTENSION%%",
    },
  },
};
