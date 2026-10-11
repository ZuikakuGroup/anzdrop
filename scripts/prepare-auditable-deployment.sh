#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
build_dir=tmp/auditable-build
payload_dir=tmp/auditable-payload
artifact=tmp/anzdrop-deploy.tar
rm -rf "$build_dir" "$payload_dir" tmp/auditable-extracted
rm -f tmp/deployment-manifest.json "$artifact" "$artifact.sha256"
mkdir -p "$build_dir" "$payload_dir/compiled" "$payload_dir/apps/public/dist"

npm run build:public
npx wrangler deploy --dry-run --outdir "$build_dir/app" --config wrangler.jsonc --var DEPLOYMENT_ENV:production
(
  cd apps/public
  ../../node_modules/.bin/wrangler deploy --dry-run --outdir ../../"$build_dir/public" --config dist/server/wrangler.json
)
npx wrangler deploy --dry-run --outdir "$build_dir/router" --config wrangler.router.jsonc

test -s "$build_dir/app/worker.js"
test -s "$build_dir/public/entry.mjs"
test -s "$build_dir/router/index.js"
cp -a "$build_dir/app" "$build_dir/router" "$build_dir/public" "$payload_dir/compiled/"
cp -a apps/public/dist/client "$payload_dir/apps/public/dist/client"
cp apps/public/wrangler.jsonc "$payload_dir/apps/public/wrangler.jsonc"
cp wrangler.jsonc wrangler.router.jsonc "$payload_dir/"
node scripts/prepare-production-config.mjs "$payload_dir/wrangler.jsonc" "$payload_dir/apps/public/wrangler.jsonc" "$payload_dir/wrangler.router.jsonc"

# Normalize file order/metadata and reject symlinks before attestation.
node scripts/create-deployment-tar.mjs "$payload_dir" "$artifact"
# shasum is available on macOS and GitHub's Linux runners.
digest=$(shasum -a 256 "$artifact" | cut -d ' ' -f 1)
printf '%s  %s\n' "$digest" "$(basename "$artifact")" > "$artifact.sha256"
echo "Deployment artifact SHA-256: sha256:$digest"
