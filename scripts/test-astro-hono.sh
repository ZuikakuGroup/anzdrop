#!/usr/bin/env bash
set -euo pipefail
# Give each background service its own process group for complete cleanup.
set -m
cd "$(dirname "$0")/.."
case "${E2E_PROJECT:-chromium}" in chromium|firefox|webkit) ;; *) echo 'Invalid E2E_PROJECT'; exit 1 ;; esac
case "${E2E_WORKERS:-2}" in 1|2) ;; *) echo 'Invalid E2E_WORKERS'; exit 1 ;; esac
mkdir -p tmp
# Every invocation owns exactly one disposable storage directory.
state_dir=$(mktemp -d "$PWD/tmp/astro-hono-state.XXXXXX")
export E2E_STATE_DIR="$state_dir"
api_pid=""; ui_pid=""; proxy_pid=""; test_pid=""
cleanup() {
  for child_pid in "$test_pid" "$proxy_pid" "$ui_pid" "$api_pid"; do
    if [ -n "$child_pid" ]; then kill -- "-$child_pid" 2>/dev/null || true; wait "$child_pid" 2>/dev/null || true; fi
  done
  rm -rf -- "$state_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
export CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false
# Cloudflare official public testing keys; these are not production credentials.
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run build:public
node scripts/prepare-local-api-config.mjs
# Dedicated local database: never use --remote for this test.
npx wrangler d1 migrations apply DB --local --config tmp/astro-hono/wrangler.json --persist-to "$state_dir" > tmp/astro-hono-migrations.log 2>&1
npx wrangler dev --config tmp/astro-hono/wrangler.json --port 8791 --inspector-port 9241 --persist-to "$state_dir" \
  --var LOCAL_ADMIN_BYPASS:${E2E_LOCAL_ADMIN_BYPASS:-false} \
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
ready=false
for attempt in $(seq 1 60); do
  admin_ready=true
  if [ "${E2E_LOCAL_ADMIN_BYPASS:-false}" = true ] && [ "$(curl --max-time 3 --silent -o /dev/null -w '%{http_code}' http://localhost:3310/admin)" != "200" ]; then admin_ready=false; fi
  if [ "$admin_ready" = true ] && curl --max-time 3 --silent --fail http://localhost:3310/about > /dev/null && [ "$(curl --max-time 3 --silent -o /dev/null -w '%{http_code}' http://localhost:3310/api/account/me)" = "401" ]; then
    ready=true
    break
  fi
  if ! kill -0 "$api_pid" 2>/dev/null || ! kill -0 "$ui_pid" 2>/dev/null || ! kill -0 "$proxy_pid" 2>/dev/null; then break; fi
  sleep 1
done
if [ "$ready" != true ]; then echo 'Local Astro/Hono preview did not become ready. See tmp/astro-hono-*-preview.log.'; exit 1; fi
PUBLIC_ASTRO_TEST=true E2E_ACCOUNT_AUTH_LOCAL=1 E2E_ASTRO_HONO=1 E2E_BASE_URL=http://localhost:3310 \
  npx playwright test ${E2E_TEST_FILES:-tests/e2e/public-astro.spec.ts tests/e2e/account-security.spec.ts tests/e2e/smoke.spec.ts tests/e2e/astro-hono.spec.ts tests/e2e/support-admin-astro.spec.ts tests/e2e/file-sharing.spec.ts} --project="${E2E_PROJECT:-chromium}" --workers="${E2E_WORKERS:-2}" "$@" &
test_pid=$!
wait "$test_pid"
