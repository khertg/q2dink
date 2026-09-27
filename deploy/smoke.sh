#!/usr/bin/env bash
# Smoke test of a running production stack (Caddy + API + Postgres):
#   bash deploy/smoke.sh http://localhost:8080
# CI starts the stack with DOMAIN=:80 (plain HTTP) and runs this; it also works against a real domain.
# Set EXPECT_COMMIT to a git commit to check the build reports it.
set -u

BASE="${1:-http://localhost:8080}"
BASE="${BASE%/}"
failures=0

pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; failures=$((failures + 1)); }

# Wait for the stack: the API answers through Caddy.
printf 'Waiting for %s ...\n' "$BASE"
for _ in $(seq 1 60); do
  if curl -fsS "$BASE/api/health" >/dev/null 2>&1; then break; fi
  sleep 2
done

health="$(curl -fsS "$BASE/api/health" 2>/dev/null || true)"
if [[ "$health" == *'"ok":true'* && "$health" == *'"version"'* && "$health" == *'"commit"'* ]]; then
  pass "/api/health answers with the build: $health"
else
  fail "/api/health did not answer with ok, version and commit: '$health'"
fi
if [[ -n "${EXPECT_COMMIT:-}" ]]; then
  short="${EXPECT_COMMIT:0:7}"
  if [[ "$health" == *"\"commit\":\"$short\""* ]]; then pass "the API reports commit $short"; else fail "the API does not report commit $short"; fi
fi

headers="$(curl -fsSI "$BASE/" 2>/dev/null | tr -d '\r' | tr 'A-Z' 'a-z')"
for name in content-security-policy strict-transport-security permissions-policy x-content-type-options referrer-policy; do
  if grep -q "^$name:" <<<"$headers"; then pass "the app is served with $name"; else fail "the app is missing the $name header"; fi
done
if grep -q "^content-security-policy:.*frame-ancestors 'none'" <<<"$headers"; then pass "framing is refused"; else fail "the policy does not refuse framing"; fi

index="$(curl -fsS "$BASE/" 2>/dev/null || true)"
if [[ "$index" == *'<div id="root">'* ]]; then pass "/ serves the app"; else fail "/ does not serve the app"; fi
live="$(curl -fsS "$BASE/club/some-club/live" 2>/dev/null || true)"
if [[ "$live" == *'<div id="root">'* ]]; then pass "/club/<name>/live serves the app (client route)"; else fail "/club/<name>/live does not serve the app"; fi
# The older live link, still on printed QR codes.
session="$(curl -fsS "$BASE/club/some-club/live/3f2a9c1e-0b4d-4e8f-9a7b-1c2d3e4f5a6b" 2>/dev/null || true)"
if [[ "$session" == *'<div id="root">'* ]]; then pass "/club/<name>/live/<session> serves the app (one session's board)"; else fail "/club/<name>/live/<session> does not serve the app"; fi
club="$(curl -fsS "$BASE/club/some-club" 2>/dev/null || true)"
if [[ "$club" == *'<div id="root">'* ]]; then pass "/club/<name> serves the app (older live link)"; else fail "/club/<name> does not serve the app"; fi

manifest="$(curl -fsS "$BASE/manifest.webmanifest" 2>/dev/null || true)"
if [[ "$manifest" == *'"Q2Dink"'* ]]; then pass "the web app manifest is served"; else fail "the web app manifest is missing"; fi

worker="$(curl -fsS "$BASE/sw.js" 2>/dev/null || true)"
if [[ "$worker" == *'denylist'* && "$worker" == *'api'* ]]; then
  pass "the service worker leaves /api pages alone"
else
  fail "the service worker has no /api denylist"
fi

script="$(grep -o '/assets/[^"]*\.js' <<<"$index" | head -1)"
if [[ -n "$script" ]] && curl -fsSI "$BASE$script" | tr -d '\r' | tr 'A-Z' 'a-z' | grep -q '^cache-control:.*immutable'; then
  pass "hashed assets are cached for good"
else
  fail "hashed assets are not served as immutable"
fi

# The API must never fall through to the app's index page.
missing="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/nothing-here" 2>/dev/null || true)"
if [[ "$missing" == "404" ]]; then pass "an unknown /api address is a 404, not the app"; else fail "an unknown /api address answered $missing"; fi

if [[ "$failures" -gt 0 ]]; then
  printf '\n%d check(s) failed.\n' "$failures"
  exit 1
fi
printf '\nAll checks passed.\n'
