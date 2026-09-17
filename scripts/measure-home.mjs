import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const targetUrl = process.env.SITE_URL ?? "http://127.0.0.1:3000";
const temporaryDirectory = await mkdtemp(join(tmpdir(), "anzdrop-lighthouse-"));
const reportPath = join(temporaryDirectory, "home.json");

try {
  await execFileAsync("npx", [
    "--yes",
    "lighthouse",
    targetUrl,
    "--only-categories=performance",
    "--output=json",
    `--output-path=${reportPath}`,
    "--quiet",
  ]);

  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const metric = (id) => report.audits[id]?.numericValue;
  const milliseconds = (id) => {
    const value = metric(id);
    return value === undefined ? "n/a" : `${Math.round(value)}ms`;
  };

  console.log(`Synthetic home-page metrics: ${targetUrl}`);
  console.log(`TTFB: ${milliseconds("server-response-time")}`);
  console.log(`LCP: ${milliseconds("largest-contentful-paint")}`);
  console.log(`CLS: ${metric("cumulative-layout-shift") ?? "n/a"}`);
  console.log(
    `Initial transfer: ${Math.round((metric("total-byte-weight") ?? 0) / 1024)}KiB`
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
