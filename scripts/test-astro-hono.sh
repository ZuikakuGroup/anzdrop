#!/usr/bin/env bash
set -euo pipefail
# Give each background service its own process group for complete cleanup.
set -m
cd "$(dirname "$0")/.."
mkdir -p tmp
# Cloudflare official public testing keys; these are not production credentials.
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run build:public
node scripts/prepare-local-api-config.mjs
export CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false
# Dedicated local database: never use --remote for this test.
npx wrangler d1 migrations apply DB --local --config tmp/astro-hono/wrangler.json --persist-to tmp/astro-hono-state > tmp/astro-hono-migrations.log 2>&1
npx wrangler dev --config tmp/astro-hono/wrangler.json --port 8791 --inspector-port 9241 --persist-to tmp/astro-hono-state \
  --var ACCOUNT_AUTH_LOCAL_ORIGIN:http://localhost:3310 \
  --var TURNSTILE_SECRET_KEY:1x0000000000000000000000000000000AA \
  --var ANALYTICS_SECRET:local-test-analytics-secret-only-not-production \
  --var SESSION_SECRET:local-test-session-secret-only-not-production \
  --var ACCOUNT_AUTH_ENCRYPTION_KEY:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA \
  > tmp/astro-hono-api-preview.log 2>&1 &
api_pid=$!
npx wrangler dev --config apps/public/dist/server/wrangler.json --port 4324 --inspector-port 9242 --var BLOG_USE_SEED_DATA:true --var WEB_AUDIT:true > tmp/astro-hono-ui-preview.log 2>&1 &
ui_pid=$!
node scripts/local-app-proxy.mjs > tmp/astro-hono-proxy.log 2>&1 &
proxy_pid=$!
trap 'kill -- "-$api_pid" "-$ui_pid" "-$proxy_pid" 2>/dev/null || true; wait "$api_pid" "$ui_pid" "$proxy_pid" 2>/dev/null || true' EXIT
ready=false
for attempt in $(seq 1 60); do
  if curl --max-time 3 --silent --fail http://localhost:3310/about > /dev/null && [ "$(curl --max-time 3 --silent -o /dev/null -w '%{http_code}' http://localhost:3310/api/account/me)" = "401" ]; then
    ready=true
    break
  fi
  if ! kill -0 "$api_pid" 2>/dev/null || ! kill -0 "$ui_pid" 2>/dev/null || ! kill -0 "$proxy_pid" 2>/dev/null; then break; fi
  sleep 1
done
if [ "$ready" != true ]; then echo 'Local Astro/Hono preview did not become ready. See tmp/astro-hono-*-preview.log.'; exit 1; fi
PUBLIC_ASTRO_TEST=true E2E_ACCOUNT_AUTH_LOCAL=1 E2E_ASTRO_HONO=1 E2E_BASE_URL=http://localhost:3310 \
  npx playwright test tests/e2e/public-astro.spec.ts tests/e2e/account-security.spec.ts tests/e2e/smoke.spec.ts tests/e2e/astro-hono.spec.ts --workers=2
