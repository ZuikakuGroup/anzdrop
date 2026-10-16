import { mkdir, writeFile } from 'node:fs/promises';
import { readLocalWorkerConfig } from './local-worker-config.mjs';

// Keep the browser test isolated from developer/prod secrets in root .dev.vars.
const config = await readLocalWorkerConfig('wrangler.jsonc');
config.vars.LOCAL_DEVELOPMENT = "true";
await mkdir('tmp/astro-hono', { recursive: true });
await writeFile('tmp/astro-hono/wrangler.json', `${JSON.stringify(config, null, 2)}\n`);
