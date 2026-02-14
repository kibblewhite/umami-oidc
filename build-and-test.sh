#!/usr/bin/env bash
###############################################################################
# build-and-test.sh  —  Build the Umami + OIDC image and run all tests
#
# Usage:
#   ./build-and-test.sh                 # build + unit tests + smoke tests
#   ./build-and-test.sh --build-only    # just build (unit tests run in build)
#   ./build-and-test.sh --smoke-only    # just smoke tests (image must exist)
###############################################################################

set -euo pipefail

IMAGE_NAME="umami-oidc"
COMPOSE_FILE="docker-compose.yml"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { printf "${CYAN}[build]${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}[pass]${NC}  %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC}  %s\n" "$*"; }
err()  { printf "${RED}[fail]${NC}  %s\n" "$*"; }

MODE="${1:-full}"

# =========================================================================
# Step 1: Build the image (unit tests run inside the build)
# =========================================================================
if [ "$MODE" != "--smoke-only" ]; then
  log "Building Docker image '${IMAGE_NAME}' ..."
  log "  (Unit tests run during build — build fails if tests fail)"
  echo ""

  if docker build -t "${IMAGE_NAME}" .; then
    ok "Docker image built successfully"
    echo ""
  else
    err "Docker build FAILED (check output above for test failures)"
    exit 1
  fi

  if [ "$MODE" = "--build-only" ]; then
    log "Build-only mode — skipping smoke tests"
    echo ""
    ok "Done. Run smoke tests later with: $0 --smoke-only"
    exit 0
  fi
fi

# =========================================================================
# Step 2: Start the stack with docker-compose
# =========================================================================
log "Starting Umami + PostgreSQL + Redis via docker-compose ..."
docker compose -f "${COMPOSE_FILE}" down -v 2>/dev/null || true
docker compose -f "${COMPOSE_FILE}" up -d --build

log "Waiting for Umami to become healthy ..."
ATTEMPTS=0
MAX=40
while [ $ATTEMPTS -lt $MAX ]; do
  STATUS=$(docker compose -f "${COMPOSE_FILE}" ps --format json 2>/dev/null \
    | grep -o '"Health":"[^"]*"' | head -1 || echo "")
  if echo "$STATUS" | grep -q "healthy"; then
    ok "Umami is healthy"
    break
  fi
  ATTEMPTS=$((ATTEMPTS + 1))
  printf "."
  sleep 3
done
echo ""

if [ $ATTEMPTS -eq $MAX ]; then
  err "Umami did not become healthy within 120 seconds"
  log "Container logs:"
  docker compose -f "${COMPOSE_FILE}" logs umami --tail=50
  docker compose -f "${COMPOSE_FILE}" down -v
  exit 1
fi

# =========================================================================
# Step 3: Run the runtime smoke tests inside the container
# =========================================================================
log "Running runtime smoke tests ..."
echo ""

if docker compose -f "${COMPOSE_FILE}" exec -T umami /app/tests/smoke-test.sh; then
  ok "All smoke tests passed"
else
  err "Smoke tests FAILED"
  docker compose -f "${COMPOSE_FILE}" logs umami --tail=30
  docker compose -f "${COMPOSE_FILE}" down -v
  exit 1
fi

# =========================================================================
# Step 4: Cleanup
# =========================================================================
echo ""
log "Tearing down test stack ..."
docker compose -f "${COMPOSE_FILE}" down -v

echo ""
echo "============================================"
ok "All tests passed!"
echo "============================================"
echo ""
echo "To run in production:"
echo "  docker compose up -d"
echo ""
echo "Remember to set your OIDC environment variables"
echo "in docker-compose.yml before deploying."
