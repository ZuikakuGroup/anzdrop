import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

// Called only for disposable local configs. No env files or secret values are read.
export async function readLocalWorkerConfig(source, { stripRoutes = false } = {}) {
  const parsed = ts.parseConfigFileTextToJson(source, await readFile(source, 'utf8'));
  if (parsed.error) throw new Error(`Invalid local Wrangler config: ${source}`);
  const config = parsed.config;
  config.main = path.resolve(path.dirname(path.resolve(source)), config.main);
  delete config.tsconfig;
  delete config.triggers;
  if (stripRoutes) delete config.routes;
  if (config.assets?.directory) config.assets.directory = path.resolve(path.dirname(path.resolve(source)), config.assets.directory);
  for (const database of config.d1_databases ?? []) database.migrations_dir = path.resolve('migrations');
  return config;
}
