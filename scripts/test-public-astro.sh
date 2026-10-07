#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
public_port=${PUBLIC_ASTRO_PORT:-4322}
mkdir -p tmp
npm run build:public
npx wrangler dev --config apps/public/dist/server/wrangler.json --port "$public_port" --var BLOG_USE_SEED_DATA:true --var WEB_AUDIT:true > tmp/public-astro-preview.log 2>&1 &
public_pid=$!
trap 'kill "$public_pid" 2>/dev/null || true; wait "$public_pid" 2>/dev/null || true' EXIT
public_ready=false
for attempt in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:$public_port/about" > /dev/null; then
    public_ready=true
    break
  fi
  if ! kill -0 "$public_pid" 2>/dev/null; then
    cat tmp/public-astro-preview.log
    exit 1
  fi
  sleep 1
done
if [ "$public_ready" != true ]; then
  cat tmp/public-astro-preview.log
  exit 1
fi
PUBLIC_ASTRO_TEST=true E2E_BASE_URL="http://127.0.0.1:$public_port" npx playwright test tests/e2e/public-astro.spec.ts
