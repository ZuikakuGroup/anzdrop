import { mkdir, readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import { resolve } from 'node:path';

// Keep the browser test isolated from developer/prod secrets in root .dev.vars.
const parsed = ts.parseConfigFileTextToJson('wrangler.api.jsonc', await readFile('wrangler.api.jsonc', 'utf8'));
if (parsed.error) throw new Error('Invalid local API config');
const config = parsed.config;
config.main = resolve('server/worker.ts');
delete config.tsconfig;
for (const binding of config.d1_databases) binding.migrations_dir = resolve('migrations');
await mkdir('tmp/astro-hono', { recursive: true });
await writeFile('tmp/astro-hono/wrangler.json', `${JSON.stringify(config, null, 2)}\n`);
