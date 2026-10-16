import { runCommand } from './run-command.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readLocalWorkerConfig } from './local-worker-config.mjs';

// Use the same public router as production; built Astro has no Vite API proxy.
// Generate disposable local configs without changing deployment configuration.
const root = process.cwd();
const directory = path.join(root, 'tmp/preview');
await mkdir(directory, { recursive: true });
const sources = ['wrangler.router.jsonc', 'apps/public/dist/server/wrangler.json', 'wrangler.api.jsonc'];
const configs = [];
for (const [index, source] of sources.entries()) {
  // Keep APP at its original config location so Wrangler reads root .dev.vars.
  if (index === 2) { configs.push('--config', path.resolve(source)); continue; }
  const config = await readLocalWorkerConfig(source, { stripRoutes: true });
  config.dev = { ...config.dev, ip: '127.0.0.1', port: [3000, 4324, 8788][index], inspector_port: [9250, 9251, 9252][index] };
  if (index === 1) {
    for (const name of ['BLOG_USE_SEED_DATA', 'WEB_AUDIT']) {
      if (process.env[name] === 'true') config.vars[name] = 'true';
    }
  }
  const target = path.join(directory, `${index}.json`);
  await writeFile(target, `${JSON.stringify(config, null, 2)}\n`);
  configs.push('--config', target);
}
const args = process.argv.slice(2).map(arg => arg === '--hostname' ? '--ip' : arg);
runCommand('npx', ['wrangler', 'dev', ...configs, ...args], { stdio: 'inherit' });
