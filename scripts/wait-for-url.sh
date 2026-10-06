#!/usr/bin/env bash
# デプロイ直後の URL が安定して HTTP 2xx/3xx を返すまで待つ。
# 用法: wait-for-url.sh <url> [timeout_seconds] [interval_seconds]
set -euo pipefail

URL="${1:?url required}"
TIMEOUT_SECONDS="${2:-180}"
INTERVAL_SECONDS="${3:-5}"
DEADLINE=$((SECONDS + TIMEOUT_SECONDS))

echo "Waiting for ${URL} (timeout=${TIMEOUT_SECONDS}s, interval=${INTERVAL_SECONDS}s)"

while (( SECONDS < DEADLINE )); do
  # -L: リダイレクト追跡。本文は捨ててステータスだけ見る。
  STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -L --max-time 20 "$URL" || true)"
  echo "  $(date -u +%H:%M:%S) status=${STATUS:-000}"
  if [[ "$STATUS" =~ ^[23][0-9][0-9]$ ]]; then
    echo "Ready: ${URL} -> ${STATUS}"
    exit 0
  fi
  sleep "$INTERVAL_SECONDS"
done

echo "Timed out waiting for ${URL}" >&2
exit 1
