import { readFile, writeFile } from "node:fs/promises";
import ts from "typescript";

const files = process.argv.slice(2);
if (files.length !== 3) throw new Error("Expected app, public, and router Wrangler configs");

const app = ts.parseConfigFileTextToJson(files[0], await readFile(files[0], "utf8"));
if (app.error || !/^[0-9a-f]{32}$/.test(app.config?.account_id)) {
  throw new Error("Invalid account ID in app Wrangler config");
}

for (const [index, file] of files.entries()) {
  const parsed = ts.parseConfigFileTextToJson(file, await readFile(file, "utf8"));
  if (parsed.error || !parsed.config?.name) throw new Error(`Invalid Wrangler config: ${file}`);
  parsed.config.account_id = app.config.account_id;
  if (index === 1) {
    parsed.config.main = "../../compiled/public/entry.mjs";
    parsed.config.no_bundle = true;
    parsed.config.find_additional_modules = true;
    parsed.config.rules = [{ type: "ESModule", globs: ["**/*.mjs"], fallthrough: true }];
  }
  if (index < 2) parsed.config.vars = { ...parsed.config.vars, DEPLOYMENT_ENV: "production" };
  await writeFile(file, `${JSON.stringify(parsed.config, null, 2)}\n`);
}
