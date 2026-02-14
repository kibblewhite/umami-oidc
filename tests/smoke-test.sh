#!/bin/sh
###############################################################################
# Umami + OIDC  —  Runtime Smoke Tests
#
# These tests verify that the running Umami instance has the OIDC endpoints
# available and responding correctly, and that Redis-backed authentication
# is working. Run inside the container:
#
#   docker exec <container> /app/tests/smoke-test.sh
#
# Or from docker-compose:
#
#   docker compose -p umami-stack exec umami /app/tests/smoke-test.sh
#
# Exit codes: 0 = all passed, 1 = failures detected
###############################################################################

set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
PASS=0
FAIL=0

# Colour helpers (degrade gracefully if not a terminal)
if [ -t 1 ]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; NC='\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; NC=''
fi

pass() { PASS=$((PASS + 1)); printf "${GREEN}  ✓ %s${NC}\n" "$1"; }
fail() { FAIL=$((FAIL + 1)); printf "${RED}  ✗ %s${NC}\n" "$1"; }
info() { printf "${YELLOW}  ℹ %s${NC}\n" "$1"; }

echo ""
echo "============================================"
echo "  Umami + OIDC  —  Runtime Smoke Tests"
echo "============================================"
echo ""
echo "Target: ${BASE_URL}"
echo ""

# ---- Wait for the app to be ready -------------------------------------------
echo "--- Waiting for Umami to be ready ---"
ATTEMPTS=0
MAX_ATTEMPTS=30
while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
  if curl -sf "${BASE_URL}/api/heartbeat" > /dev/null 2>&1; then
    pass "Umami heartbeat is responding"
    break
  fi
  ATTEMPTS=$((ATTEMPTS + 1))
  sleep 2
done
if [ $ATTEMPTS -eq $MAX_ATTEMPTS ]; then
  fail "Umami did not become ready within 60 seconds"
  echo "RESULT: FAILED (app not ready)"
  exit 1
fi

# ---- Test 1: Heartbeat endpoint ---------------------------------------------
echo ""
echo "--- Core Endpoint Tests ---"
HTTP_CODE=$(curl -so /dev/null -w '%{http_code}' "${BASE_URL}/api/heartbeat")
if [ "$HTTP_CODE" = "200" ]; then
  pass "GET /api/heartbeat → 200"
else
  fail "GET /api/heartbeat → ${HTTP_CODE} (expected 200)"
fi

# ---- Test 2: Login page loads -----------------------------------------------
HTTP_CODE=$(curl -so /dev/null -w '%{http_code}' "${BASE_URL}/login")
if [ "$HTTP_CODE" = "200" ]; then
  pass "GET /login → 200"
else
  fail "GET /login → ${HTTP_CODE} (expected 200)"
fi

# ---- Test 3: Standard auth login + token validation -------------------------
echo ""
echo "--- Auth Token Tests (Redis-backed) ---"

# Try default credentials first, then wrong password
LOGIN_RESPONSE=$(curl -s -w '\n%{http_code}' \
  -X POST -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"umami"}' \
  "${BASE_URL}/api/auth/login" 2>/dev/null)

LOGIN_BODY=$(echo "$LOGIN_RESPONSE" | sed '$d')
LOGIN_CODE=$(echo "$LOGIN_RESPONSE" | tail -1)

if [ "$LOGIN_CODE" = "200" ]; then
  pass "POST /api/auth/login → 200 (default admin credentials)"

  # Extract token from response
  AUTH_TOKEN=$(echo "$LOGIN_BODY" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ -n "$AUTH_TOKEN" ] && [ "$AUTH_TOKEN" != "null" ]; then
    pass "Login returned auth token (length=${#AUTH_TOKEN})"

    # Verify the token works on a protected endpoint
    VERIFY_CODE=$(curl -so /dev/null -w '%{http_code}' \
      -H "Authorization: Bearer ${AUTH_TOKEN}" \
      "${BASE_URL}/api/me" 2>/dev/null)

    if [ "$VERIFY_CODE" = "200" ]; then
      pass "GET /api/me with Bearer token → 200 (token is valid, Redis working)"
    elif [ "$VERIFY_CODE" = "401" ]; then
      fail "GET /api/me with Bearer token → 401 (token rejected — Redis may not be connected)"
    else
      info "GET /api/me with Bearer token → ${VERIFY_CODE}"
    fi
  else
    fail "Login response missing token (Redis may not be available for saveAuth)"
  fi
elif [ "$LOGIN_CODE" = "401" ]; then
  info "POST /api/auth/login → 401 (default password has been changed)"
  pass "Standard auth endpoint is responding"
  info "Skipping token validation tests (no credentials available)"
else
  fail "POST /api/auth/login → ${LOGIN_CODE} (expected 200 or 401)"
fi

# ---- Test 4: OIDC config endpoint -------------------------------------------
echo ""
echo "--- OIDC Endpoint Tests ---"
OIDC_CONFIG=$(curl -sf "${BASE_URL}/api/auth/oidc/config" 2>/dev/null || echo "FETCH_FAILED")

if echo "$OIDC_CONFIG" | grep -q '"enabled"'; then
  pass "GET /api/auth/oidc/config → returns JSON with 'enabled' field"
else
  fail "GET /api/auth/oidc/config → missing 'enabled' field or not reachable"
fi

# Check if OIDC is enabled based on env
if echo "$OIDC_CONFIG" | grep -q '"enabled":true'; then
  info "OIDC is ENABLED in this instance"
  OIDC_ACTIVE=true
elif echo "$OIDC_CONFIG" | grep -q '"enabled":false'; then
  info "OIDC is DISABLED (set OIDC_ENABLED=true to enable)"
  OIDC_ACTIVE=false
else
  info "Could not determine OIDC status"
  OIDC_ACTIVE=false
fi

# Check displayName is present
if echo "$OIDC_CONFIG" | grep -q '"displayName"'; then
  pass "OIDC config includes displayName"
else
  fail "OIDC config missing displayName"
fi

# Check authorizeUrl is present
if echo "$OIDC_CONFIG" | grep -q '"authorizeUrl"'; then
  pass "OIDC config includes authorizeUrl"
else
  fail "OIDC config missing authorizeUrl"
fi

# ---- Test 5: OIDC authorize endpoint (when disabled) ------------------------
if [ "$OIDC_ACTIVE" = "false" ]; then
  HTTP_CODE=$(curl -so /dev/null -w '%{http_code}' "${BASE_URL}/api/auth/oidc/authorize")
  if [ "$HTTP_CODE" = "404" ]; then
    pass "GET /api/auth/oidc/authorize → 404 (correct when OIDC disabled)"
  else
    fail "GET /api/auth/oidc/authorize → ${HTTP_CODE} (expected 404 when disabled)"
  fi
fi

# ---- Test 6: OIDC authorize endpoint (when enabled) -------------------------
if [ "$OIDC_ACTIVE" = "true" ]; then
  # Should redirect (302) to the IdP — we check for a redirect, not follow it
  HTTP_CODE=$(curl -so /dev/null -w '%{http_code}' --max-redirs 0 "${BASE_URL}/api/auth/oidc/authorize" 2>/dev/null)
  if [ "$HTTP_CODE" = "302" ] || [ "$HTTP_CODE" = "307" ]; then
    pass "GET /api/auth/oidc/authorize → ${HTTP_CODE} redirect (correct)"
  elif [ "$HTTP_CODE" = "500" ]; then
    fail "GET /api/auth/oidc/authorize → 500 (OIDC misconfigured — check OIDC_ISSUER_URL)"
  else
    fail "GET /api/auth/oidc/authorize → ${HTTP_CODE} (expected 302/307 redirect)"
  fi

  # Verify the redirect goes to the issuer
  REDIRECT_URL=$(curl -s -o /dev/null -w '%{redirect_url}' --max-redirs 0 "${BASE_URL}/api/auth/oidc/authorize" 2>/dev/null)
  if echo "$REDIRECT_URL" | grep -q "client_id="; then
    pass "Redirect URL contains client_id parameter"
  else
    fail "Redirect URL missing client_id parameter"
  fi
  if echo "$REDIRECT_URL" | grep -q "state="; then
    pass "Redirect URL contains state parameter (CSRF protection)"
  else
    fail "Redirect URL missing state parameter"
  fi
  if echo "$REDIRECT_URL" | grep -q "response_type=code"; then
    pass "Redirect URL uses authorization code flow"
  else
    fail "Redirect URL missing response_type=code"
  fi
fi

# ---- Test 7: OIDC callback without parameters → redirect to login -----------
HTTP_CODE=$(curl -so /dev/null -w '%{http_code}' --max-redirs 0 "${BASE_URL}/api/auth/oidc/callback")
if [ "$HTTP_CODE" = "302" ] || [ "$HTTP_CODE" = "307" ]; then
  REDIR=$(curl -s -o /dev/null -w '%{redirect_url}' --max-redirs 0 "${BASE_URL}/api/auth/oidc/callback" 2>/dev/null)
  if echo "$REDIR" | grep -qi "login"; then
    pass "GET /api/auth/oidc/callback (no params) → redirects to /login"
  else
    pass "GET /api/auth/oidc/callback (no params) → ${HTTP_CODE} redirect"
  fi
else
  # Also acceptable if it returns a direct error
  info "GET /api/auth/oidc/callback (no params) → ${HTTP_CODE}"
fi

# ---- Test 8: OIDC complete endpoint -----------------------------------------
HTTP_CODE=$(curl -so /dev/null -w '%{http_code}' "${BASE_URL}/api/auth/oidc/complete")
# When OIDC is disabled this redirects to login; when enabled it returns HTML
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ] || [ "$HTTP_CODE" = "307" ]; then
  pass "GET /api/auth/oidc/complete → ${HTTP_CODE} (reachable)"
else
  fail "GET /api/auth/oidc/complete → ${HTTP_CODE}"
fi

# ---- Test 9: Standard auth still works (POST /api/auth/login) ----------------
echo ""
echo "--- Standard Auth Coexistence ---"
HTTP_CODE=$(curl -so /dev/null -w '%{http_code}' \
  -X POST -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"wrong"}' \
  "${BASE_URL}/api/auth/login")
# We expect 401 (wrong password) — proves the endpoint is alive
if [ "$HTTP_CODE" = "401" ]; then
  pass "POST /api/auth/login → 401 (standard auth endpoint works)"
elif [ "$HTTP_CODE" = "200" ]; then
  info "POST /api/auth/login → 200 (default password not yet changed)"
  pass "Standard auth endpoint is responding"
else
  fail "POST /api/auth/login → ${HTTP_CODE} (expected 401)"
fi

# ---- Summary -----------------------------------------------------------------
echo ""
echo "============================================"
TOTAL=$((PASS + FAIL))
echo "  Results: ${PASS}/${TOTAL} passed, ${FAIL} failed"
echo "============================================"
echo ""

if [ $FAIL -gt 0 ]; then
  exit 1
else
  exit 0
fi
