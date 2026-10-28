#!/usr/bin/env bash
# End-to-end smoke test for the LLM calculator backend.
# Usage:  ./test.sh
# Assumes: server is running on $BASE (default http://localhost:5000/api)

set -u
BASE="${BASE:-http://localhost:5000/api}"
PASS=0
FAIL=0

# ANSI colors (harmless if your terminal doesn't support them)
G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; N=$'\033[0m'

# ── Helper: assert the HTTP status of a request ─────────────────────
# Usage: assert_status NAME EXPECTED METHOD PATH [JSON_BODY]
assert_status() {
  local name=$1 expected=$2 method=$3 path=$4 body=${5:-}
  local actual
  if [ -n "$body" ]; then
    actual=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "$BASE$path" \
      -H 'Content-Type: application/json' -d "$body")
  else
    actual=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "$BASE$path")
  fi
  if [ "$actual" = "$expected" ]; then
    printf '%s✅ %-42s%s %s\n' "$G" "$name" "$N" "$actual"
    PASS=$((PASS+1))
  else
    printf '%s❌ %-42s%s expected %s, got %s\n' "$R" "$name" "$N" "$expected" "$actual"
    FAIL=$((FAIL+1))
  fi
}

# ── Helper: run a request, check the body contains a substring ─────
assert_contains() {
  local name=$1 method=$2 path=$3 body=$4 needle=$5
  local response
  if [ -n "$body" ]; then
    response=$(curl -s -X "$method" "$BASE$path" \
      -H 'Content-Type: application/json' -d "$body")
  else
    response=$(curl -s -X "$method" "$BASE$path")
  fi
  if echo "$response" | grep -q "$needle"; then
    printf '%s✅ %-42s%s contains %q\n' "$G" "$name" "$N" "$needle"
    PASS=$((PASS+1))
  else
    printf '%s❌ %-42s%s missing %q\n' "$R" "$name" "$N" "$needle"
    echo "   Response: $response"
    FAIL=$((FAIL+1))
  fi
}

echo "${Y}── Health ─────────────────────────────────────${N}"
assert_status "health returns 200"   200 GET  /health
assert_contains "health body has status:ok" GET /health '' '"status":"ok"'

echo ""
echo "${Y}── Happy path ─────────────────────────────────${N}"
assert_status "POST /calculations returns 201" 201 POST /calculations \
  '{"query":"Add 2 and 3, then multiply the result by 3"}'
assert_contains "response has finalAnswer:15" POST /calculations \
  '{"query":"Add 2 and 3, then multiply the result by 3"}' '"finalAnswer":15'
assert_contains "response has usage object" POST /calculations \
  '{"query":"Add 2 and 3, then multiply the result by 3"}' '"totalTokens"'
assert_contains "response has estimatedCost" POST /calculations \
  '{"query":"Add 2 and 3, then multiply the result by 3"}' '"estimatedCost"'

echo ""
echo "${Y}── Validation ─────────────────────────────────${N}"
assert_status "empty query → 400"        400 POST /calculations '{"query":""}'
assert_status "missing query → 400"      400 POST /calculations '{}'
assert_status "extra field → 400"        400 POST /calculations \
  '{"query":"2+2","isAdmin":true}'
assert_status "non-string query → 400"   400 POST /calculations '{"query":123}'

echo ""
echo "${Y}── Non-math / math errors ─────────────────────${N}"
assert_status "non-math query → 422"     422 POST /calculations \
  '{"query":"What is the weather in Mumbai?"}'
assert_status "divide by zero → 422"     422 POST /calculations \
  '{"query":"Divide 10 by 0"}'

echo ""
echo "${Y}── History & usage ────────────────────────────${N}"
assert_status "GET /history returns 200" 200 GET  /calculations/history
assert_contains "history has items array" GET /calculations/history '' '"items"'
assert_contains "history has pagination"  GET /calculations/history '' '"pagination"'
assert_status "GET /usage returns 200"   200 GET  /calculations/usage
assert_contains "usage has totalRequests" GET /calculations/usage '' '"totalRequests"'
assert_contains "usage has totalCost"     GET /calculations/usage '' '"totalCost"'

echo ""
echo "${Y}── Error handling ────────────────────────────${N}"
assert_status "unknown route → 404"      404 GET  /nonexistent
assert_status "bad path → 404"           404 GET  /calculations/nope/nope

echo ""
echo "${Y}── Summary ────────────────────────────────────${N}"
echo "  ${G}Pass: $PASS${N}    ${R}Fail: $FAIL${N}"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
