#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

build_dir=tmp/auditable-build
payload_dir=tmp/auditable-payload
artifact=tmp/anzdrop-deploy.tar
rm -rf "$build_dir" "$payload_dir" tmp/auditable-extracted
rm -f tmp/deployment-manifest.json "$artifact" "$artifact.sha256"
mkdir -p "$build_dir" "$payload_dir/compiled" "$payload_dir/apps/home/.open-next" "$payload_dir/.open-next"

# OpenNext builds each Next.js app once. Wrangler's dry run then emits the
# deployable Worker bundles without uploading them.
npx opennextjs-cloudflare build
node scripts/strip-vercel-og.mts
(
  cd apps/home
  ../../node_modules/.bin/opennextjs-cloudflare build --config wrangler.jsonc
  node ../../scripts/strip-vercel-og.mts
)

npx wrangler deploy --dry-run --outdir "$build_dir/app" --config wrangler.jsonc --var DEPLOYMENT_ENV:production
(
  cd apps/home
  ../../node_modules/.bin/wrangler deploy --dry-run --outdir ../../"$build_dir/home" --config wrangler.jsonc --var DEPLOYMENT_ENV:production
)
npx wrangler deploy --dry-run --outdir "$build_dir/router" --config wrangler.router.jsonc

test -s "$build_dir/app/custom-worker.js"
test -s "$build_dir/home/home-worker.js"
test -s "$build_dir/router/index.js"

cp -a "$build_dir/app" "$build_dir/home" "$build_dir/router" "$payload_dir/compiled/"
cp -a .open-next/assets "$payload_dir/.open-next/assets"
cp -a apps/home/.open-next/assets "$payload_dir/apps/home/.open-next/assets"
cp wrangler.jsonc wrangler.router.jsonc "$payload_dir/"
cp apps/home/wrangler.jsonc "$payload_dir/apps/home/"
node scripts/prepare-production-config.mjs \
  "$payload_dir/wrangler.jsonc" "$payload_dir/apps/home/wrangler.jsonc" "$payload_dir/wrangler.router.jsonc"

# Normalize file order and metadata. The archiver also refuses symlinks, which
# could otherwise make deployed bytes depend on paths outside the archive.
python3 scripts/create-deployment-tar.py "$payload_dir" "$artifact"
digest=$(sha256sum "$artifact" | cut -d ' ' -f 1)
printf '%s  %s\n' "$digest" "$(basename "$artifact")" > "$artifact.sha256"
echo "Deployment artifact SHA-256: sha256:$digest"
