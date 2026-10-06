/**
 * Pure helpers shared by scripts/seo-audit.mjs (kept dependency-free for unit tests).
 */

export function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isSkippableHref(href) {
  if (!href || href.startsWith("#")) return true;
  const lower = href.trim().toLowerCase();
  return (
    lower.startsWith("mailto:") ||
    lower.startsWith("tel:") ||
    lower.startsWith("javascript:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("blob:")
  );
}

/**
 * @param {Array<{ level: number, text: string }>} headings
 * @returns {{ h1: "missing"|"multiple"|"ok", h1Count: number, jumps: string[] }}
 */
export function analyzeHeadingStructure(headings) {
  const h1s = headings.filter((h) => h.level === 1);
  let h1 = "ok";
  if (h1s.length === 0) h1 = "missing";
  else if (h1s.length > 1) h1 = "multiple";

  let prev = 0;
  const jumps = [];
  for (const heading of headings) {
    if (prev > 0 && heading.level > prev + 1) {
      jumps.push(`h${prev} → h${heading.level}`);
    }
    prev = heading.level;
  }
  return { h1, h1Count: h1s.length, jumps };
}

/**
 * @param {unknown} data
 * @returns {string[]} problem messages (empty = ok)
 */
export function validateJsonLdNode(data) {
  const problems = [];
  const rootContext = data && typeof data === "object" && !Array.isArray(data) ? data["@context"] : undefined;
  const nodes = Array.isArray(data) ? data : data && typeof data === "object" && data["@graph"] ? data["@graph"] : [data];
  for (const node of nodes) {
    if (!node || typeof node !== "object") {
      problems.push("non-object node");
      continue;
    }
    if (!node["@context"] && !rootContext) problems.push("missing @context");
    if (!node["@type"]) problems.push("missing @type");
  }
  return problems;
}
