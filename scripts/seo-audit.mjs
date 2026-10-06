#!/usr/bin/env node
/**
 * SEO audit for Anzdrop. Expects a production-like server already running.
 *
 * Usage:
 *   SITE_URL=http://127.0.0.1:3000 node scripts/seo-audit.mjs
 *
 * Exit 0 on pass, 1 on hard failures. External link HTTP errors are soft by default.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import {
  analyzeHeadingStructure,
  isHttpUrl,
  isSkippableHref,
  validateJsonLdNode,
} from "./seo-audit-helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const config = JSON.parse(readFileSync(join(root, "config/web-audit.json"), "utf8"));

const baseUrl = (process.env[config.baseUrlEnv] || config.defaultBaseUrl).replace(/\/$/, "");
const pages = (process.env.SEO_AUDIT_PAGES?.split(",").map((p) => p.trim()).filter(Boolean)) || config.pages;
const externalSoft = config.seo?.externalLinkSoftFail !== false;
const maxInternalLinks = config.seo?.maxInternalLinksPerPage ?? 40;

/** @typedef {"PASS"|"FAIL"|"WARN"|"SKIP"} Result */
/** @typedef {{ page: string, check: string, result: Result, details: string, hard?: boolean }} Finding */

/** @type {Finding[]} */
const findings = [];

function add(page, check, result, details, hard = result === "FAIL") {
  findings.push({ page, check, result, details, hard });
}

function resolveUrl(href, pageUrl) {
  try {
    return new URL(href, pageUrl).href;
  } catch {
    return null;
  }
}

function isInternal(url) {
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

async function fetchText(url, { method = "GET" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "AnzdropSeoAudit/1.0" },
    });
    const text = method === "HEAD" ? "" : await response.text();
    return { ok: response.ok, status: response.status, text, finalUrl: response.url };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: "",
      finalUrl: url,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function metaContent(document, selector) {
  const el = document.querySelector(selector);
  return el?.getAttribute("content")?.trim() ?? "";
}

function checkHeadingStructure(document, page) {
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((el) => ({
    level: Number(el.tagName.slice(1)),
    text: (el.textContent || "").trim().slice(0, 80),
  }));
  const analysis = analyzeHeadingStructure(headings);
  if (analysis.h1 === "missing") add(page, "h1", "FAIL", "h1 is missing");
  else if (analysis.h1 === "multiple") add(page, "h1", "FAIL", `multiple h1 elements (${analysis.h1Count})`);
  else {
    const text = headings.find((h) => h.level === 1)?.text || "(empty text)";
    add(page, "h1", "PASS", text);
  }

  if (analysis.jumps.length > 0) {
    add(page, "heading-order", "WARN", `skipped levels: ${analysis.jumps.join("; ")}`, false);
  } else if (headings.length > 0) {
    add(page, "heading-order", "PASS", "no skipped heading levels");
  }
}

function checkJsonLd(document, page) {
  const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
  if (scripts.length === 0) {
    add(page, "json-ld", "SKIP", "no JSON-LD on this page", false);
    return;
  }
  let index = 0;
  for (const script of scripts) {
    index += 1;
    const label = scripts.length > 1 ? `json-ld#${index}` : "json-ld";
    const raw = script.textContent || "";
    let data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      add(page, label, "FAIL", `invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const problems = validateJsonLdNode(data);
    if (problems.length > 0) {
      add(page, label, "FAIL", problems.join("; "));
    } else {
      const nodes = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];
      const types = nodes.map((n) => n?.["@type"]).filter(Boolean).join(", ");
      add(page, label, "PASS", `@type=${types || "(present)"}`);
    }
  }
}

async function checkPage(pathname) {
  const pageUrl = new URL(pathname, `${baseUrl}/`).href;
  const { ok, status, text, error } = await fetchText(pageUrl);
  if (!ok) {
    add(pathname, "http", "FAIL", error || `HTTP ${status}`);
    return { links: [] };
  }
  add(pathname, "http", "PASS", `HTTP ${status}`);

  const dom = new JSDOM(text);
  const { document } = dom.window;

  const title = document.querySelector("title")?.textContent?.trim() ?? "";
  if (!document.querySelector("title")) add(pathname, "title", "FAIL", "<title> missing");
  else if (!title) add(pathname, "title", "FAIL", "<title> is empty");
  else add(pathname, "title", "PASS", title.slice(0, 120));

  const description = metaContent(document, 'meta[name="description"]');
  if (!document.querySelector('meta[name="description"]')) {
    add(pathname, "description", "FAIL", "meta description missing");
  } else if (!description) {
    add(pathname, "description", "FAIL", "meta description is empty");
  } else {
    add(pathname, "description", "PASS", description.slice(0, 120));
  }

  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href")?.trim() ?? "";
  if (!canonical) add(pathname, "canonical", "FAIL", "canonical link missing");
  else if (!isHttpUrl(canonical)) add(pathname, "canonical", "FAIL", `invalid canonical URL: ${canonical}`);
  else add(pathname, "canonical", "PASS", canonical);

  const lang = document.documentElement.getAttribute("lang")?.trim() ?? "";
  if (!lang) add(pathname, "html-lang", "FAIL", 'html lang attribute missing');
  else add(pathname, "html-lang", "PASS", lang);

  const viewport = metaContent(document, 'meta[name="viewport"]');
  if (!viewport) add(pathname, "viewport", "FAIL", "viewport meta missing");
  else add(pathname, "viewport", "PASS", viewport);

  const robots = metaContent(document, 'meta[name="robots"]').toLowerCase();
  if (robots.includes("noindex")) {
    add(pathname, "robots-meta", "FAIL", `unexpected noindex: ${robots}`);
  } else {
    add(pathname, "robots-meta", "PASS", robots || "(not set)");
  }

  for (const prop of ["og:title", "og:description", "og:url", "og:image"]) {
    const value = metaContent(document, `meta[property="${prop}"]`);
    if (!value) add(pathname, prop, "FAIL", `${prop} missing`);
    else if ((prop === "og:url" || prop === "og:image") && !isHttpUrl(value)) {
      add(pathname, prop, "FAIL", `invalid URL: ${value}`);
    } else {
      add(pathname, prop, "PASS", value.slice(0, 120));
    }
  }

  const twitterCard = metaContent(document, 'meta[name="twitter:card"]');
  const twitterTitle = metaContent(document, 'meta[name="twitter:title"]') || metaContent(document, 'meta[property="twitter:title"]');
  const twitterDescription =
    metaContent(document, 'meta[name="twitter:description"]') || metaContent(document, 'meta[property="twitter:description"]');
  if (!twitterCard && !twitterTitle && !twitterDescription) {
    add(pathname, "twitter-card", "WARN", "Twitter Card metadata missing (og tags may still be used)", false);
  } else {
    const parts = [
      twitterCard && `card=${twitterCard}`,
      twitterTitle && "title",
      twitterDescription && "description",
    ].filter(Boolean);
    add(pathname, "twitter-card", "PASS", parts.join(", ") || "present");
  }

  checkHeadingStructure(document, pathname);

  const imagesWithoutAlt = [...document.querySelectorAll("img")].filter((img) => !img.hasAttribute("alt"));
  if (imagesWithoutAlt.length > 0) {
    add(pathname, "img-alt", "FAIL", `${imagesWithoutAlt.length} <img> missing alt attribute`);
  } else {
    add(pathname, "img-alt", "PASS", "all <img> have alt attribute (or no images)");
  }

  checkJsonLd(document, pathname);

  const links = [];
  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (isSkippableHref(href)) continue;
    const absolute = resolveUrl(href, pageUrl);
    if (!absolute) {
      add(pathname, "link", "WARN", `unresolvable href: ${href}`, false);
      continue;
    }
    links.push(absolute);
  }
  return { links };
}

async function checkLinks(pathname, links) {
  const internal = [];
  const external = [];
  for (const url of links) {
    if (isInternal(url)) internal.push(url);
    else external.push(url);
  }

  const uniqueInternal = [...new Set(internal)].slice(0, maxInternalLinks);
  const uniqueExternal = [...new Set(external)].slice(0, 20);

  for (const url of uniqueInternal) {
    try {
      let result = await fetchText(url, { method: "HEAD" });
      if (result.status === 405 || result.status === 501) {
        result = await fetchText(url, { method: "GET" });
      }
      if (!result.ok) add(pathname, "internal-link", "FAIL", `${url} → HTTP ${result.status}`);
    } catch (error) {
      add(pathname, "internal-link", "FAIL", `${url} → ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (uniqueInternal.length > 0 && !findings.some((f) => f.page === pathname && f.check === "internal-link" && f.result === "FAIL")) {
    add(pathname, "internal-link", "PASS", `checked ${uniqueInternal.length} unique internal link(s)`);
  } else if (uniqueInternal.length === 0) {
    add(pathname, "internal-link", "SKIP", "no internal links to check", false);
  }

  let externalFails = 0;
  for (const url of uniqueExternal) {
    try {
      let result = await fetchText(url, { method: "HEAD" });
      if (result.status === 405 || result.status === 501) {
        result = await fetchText(url, { method: "GET" });
      }
      if (!result.ok) {
        externalFails += 1;
        add(pathname, "external-link", externalSoft ? "WARN" : "FAIL", `${url} → HTTP ${result.status}`, !externalSoft);
      }
    } catch (error) {
      externalFails += 1;
      add(
        pathname,
        "external-link",
        externalSoft ? "WARN" : "FAIL",
        `${url} → ${error instanceof Error ? error.message : String(error)}`,
        !externalSoft,
      );
    }
  }
  if (uniqueExternal.length > 0 && externalFails === 0) {
    add(pathname, "external-link", "PASS", `checked ${uniqueExternal.length} unique external link(s)`);
  } else if (uniqueExternal.length === 0) {
    add(pathname, "external-link", "SKIP", "no external links to check", false);
  }
}

async function checkRobotsAndSitemap() {
  const robotsUrl = `${baseUrl}/robots.txt`;
  const robots = await fetchText(robotsUrl);
  if (!robots.ok) add("/robots.txt", "fetch", "FAIL", robots.error || `HTTP ${robots.status}`);
  else if (!robots.text.trim()) add("/robots.txt", "fetch", "FAIL", "empty robots.txt");
  else add("/robots.txt", "fetch", "PASS", robots.text.split("\n").slice(0, 3).join(" | ").slice(0, 160));

  const sitemapUrl = `${baseUrl}/sitemap.xml`;
  const sitemap = await fetchText(sitemapUrl);
  if (!sitemap.ok) {
    add("/sitemap.xml", "fetch", "FAIL", sitemap.error || `HTTP ${sitemap.status}`);
    return;
  }
  const sitemapText = sitemap.text;
  add("/sitemap.xml", "fetch", "PASS", `HTTP ${sitemap.status}`);

  let dom;
  try {
    dom = new JSDOM(sitemapText, { contentType: "text/xml" });
  } catch (error) {
    add("/sitemap.xml", "xml", "FAIL", error instanceof Error ? error.message : String(error));
    return;
  }

  const locs = [...dom.window.document.querySelectorAll("url > loc, sitemap > loc")].map((el) => el.textContent?.trim() || "");
  if (locs.length === 0) {
    add("/sitemap.xml", "xml", "FAIL", "no <loc> entries found");
    return;
  }
  add("/sitemap.xml", "xml", "PASS", `${locs.length} URL(s)`);

  const invalid = locs.filter((loc) => !isHttpUrl(loc));
  if (invalid.length > 0) {
    add("/sitemap.xml", "url-format", "FAIL", `invalid URL(s): ${invalid.slice(0, 5).join(", ")}`);
  } else {
    add("/sitemap.xml", "url-format", "PASS", "all loc values are HTTP(S) URLs");
  }

  // Sample major URLs: blog index + up to 4 others that resolve on this origin
  const candidates = locs.filter((loc) => isInternal(loc));
  const sample = [];
  const blog = candidates.find((loc) => new URL(loc).pathname === "/blog");
  if (blog) sample.push(blog);
  for (const loc of candidates) {
    if (sample.length >= 5) break;
    if (!sample.includes(loc)) sample.push(loc);
  }

  let broken = 0;
  for (const url of sample) {
    try {
      const result = await fetchText(url);
      if (!result.ok) {
        broken += 1;
        add("/sitemap.xml", "url-access", "FAIL", `${url} → HTTP ${result.status}`);
      }
    } catch (error) {
      broken += 1;
      add("/sitemap.xml", "url-access", "FAIL", `${url} → ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (sample.length > 0 && broken === 0) {
    add("/sitemap.xml", "url-access", "PASS", `checked ${sample.length} sitemap URL(s)`);
  }
}

function renderMarkdown() {
  const lines = [
    "## SEO Audit",
    "",
    `Base URL: \`${baseUrl}\``,
    "",
    "| Page | Check | Result | Details |",
    "| --- | --- | --- | --- |",
  ];
  for (const f of findings) {
    const details = f.details.replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(`| ${f.page} | ${f.check} | ${f.result} | ${details} |`);
  }
  const fails = findings.filter((f) => f.result === "FAIL" && f.hard !== false).length;
  const warns = findings.filter((f) => f.result === "WARN").length;
  lines.push("", `**Summary:** ${fails} failure(s), ${warns} warning(s), ${findings.length} check(s) total.`);
  return lines.join("\n");
}

async function main() {
  console.log(`SEO audit against ${baseUrl}`);
  console.log(`Pages: ${pages.join(", ")}`);

  await checkRobotsAndSitemap();

  for (const page of pages) {
    const { links } = await checkPage(page);
    await checkLinks(page, links);
  }

  const markdown = renderMarkdown();
  console.log(markdown);

  const outDir = join(root, ".web-audit");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "seo-report.md"), markdown, "utf8");
  writeFileSync(join(outDir, "seo-report.json"), JSON.stringify({ baseUrl, pages, findings }, null, 2), "utf8");

  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, { flag: "a" });
  }

  const hardFails = findings.filter((f) => f.result === "FAIL" && f.hard !== false);
  if (hardFails.length > 0) {
    console.error(`\nSEO audit failed with ${hardFails.length} error(s).`);
    process.exit(1);
  }
  console.log("\nSEO audit passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
