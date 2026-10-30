#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
repo_root=$PWD
target=${1:-production}
case "$target" in production|staging) ;; *) echo "Invalid deployment target"; exit 1 ;; esac
export CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false
if [ "$target" = staging ]; then
  node scripts/prepare-staging-config.mjs
  export ANZDROP_BUILD_SITE
  ANZDROP_BUILD_SITE=$(node -e 'const fs=require("node:fs"); console.log(JSON.parse(fs.readFileSync(process.env.STAGING_PLAN_FILE || "config/staging.example.json")).origin)')
else
  unset ANZDROP_BUILD_SITE
fi
build_dir=tmp/auditable-build
payload_dir=tmp/auditable-payload
artifact=tmp/anzdrop-deploy.tar
rm -rf "$build_dir" "$payload_dir" tmp/auditable-extracted
rm -f tmp/pre-release-deployments.json tmp/partial-deployment-records.json tmp/deployment-manifest.json "$artifact" "$artifact.sha256"
mkdir -p "$build_dir" "$payload_dir/compiled" "$payload_dir/apps/public/dist"

npm run build:public
app_config=wrangler.jsonc
if [ "$target" = staging ]; then app_config=tmp/staging-config/wrangler.jsonc; fi
npx wrangler deploy --dry-run --outdir "$repo_root/$build_dir/app" --config "$app_config" --var DEPLOYMENT_ENV:"$target"
(
  cd apps/public
  ../../node_modules/.bin/wrangler deploy --dry-run --outdir "$repo_root/$build_dir/public" --config dist/server/wrangler.json
)
npx wrangler deploy --dry-run --outdir "$repo_root/$build_dir/router" --config wrangler.router.jsonc

test -s "$build_dir/app/worker.js"
test -s "$build_dir/public/entry.mjs"
test -s "$build_dir/router/index.js"
cp -a "$build_dir/app" "$build_dir/router" "$build_dir/public" "$payload_dir/compiled/"
cp -a apps/public/dist/client "$payload_dir/apps/public/dist/client"
cp apps/public/wrangler.jsonc "$payload_dir/apps/public/wrangler.jsonc"
cp wrangler.jsonc wrangler.router.jsonc "$payload_dir/"
# Apply exactly the schema migration files covered by the attested archive.
cp -a migrations "$payload_dir/migrations"
node scripts/prepare-production-config.mjs "$payload_dir/wrangler.jsonc" "$payload_dir/apps/public/wrangler.jsonc" "$payload_dir/wrangler.router.jsonc"

if [ "$target" = staging ]; then node scripts/prepare-staging-config.mjs --archive; fi

# Normalize file order/metadata and reject symlinks before attestation.
node scripts/create-deployment-tar.mjs "$payload_dir" "$artifact"
# shasum is available on macOS and GitHub's Linux runners.
digest=$(shasum -a 256 "$artifact" | cut -d ' ' -f 1)
printf '%s  %s\n' "$digest" "$(basename "$artifact")" > "$artifact.sha256"
echo "Deployment artifact SHA-256: sha256:$digest"
