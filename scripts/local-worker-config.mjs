import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

// Called only for disposable local configs. No env files or secret values are read.
export async function readLocalWorkerConfig(source, { stripRoutes = false, isolateStorage = false } = {}) {
  const parsed = ts.parseConfigFileTextToJson(source, await readFile(source, 'utf8'));
  if (parsed.error) throw new Error(`Invalid local Wrangler config: ${source}`);
  const config = parsed.config;
  config.main = path.resolve(path.dirname(path.resolve(source)), config.main);
  delete config.tsconfig;
  delete config.triggers;
  if (stripRoutes) delete config.routes;
  if (config.assets?.directory) config.assets.directory = path.resolve(path.dirname(path.resolve(source)), config.assets.directory);
  for (const database of config.d1_databases ?? []) database.migrations_dir = path.resolve('migrations');
  if (isolateStorage) {
    delete config.account_id;
    config.vars = { ...config.vars, SITE_URL: "http://localhost:3310" };
    // A future config must not accidentally enable signed uploads to real R2.
    for (const key of ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "CLOUDFLARE_ACCOUNT_ID"]) delete config.vars[key];
    for (const database of config.d1_databases ?? []) {
      database.remote = false;
      database.database_name = "anzdrop-e2e-local";
      database.database_id = "00000000-0000-0000-0000-000000000001";
      delete database.preview_database_id;
    }
    for (const bucket of config.r2_buckets ?? []) {
      bucket.remote = false;
      bucket.bucket_name = "anzdrop-e2e-local";
      delete bucket.preview_bucket_name;
    }
  }
  return config;
}
