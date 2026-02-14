###############################################################################
# Umami + OIDC  —  Multi-stage Docker build
#
# This Dockerfile:
#   1. Clones umami from GitHub
#   2. Copies in the OIDC module source files
#   3. Copies in the OIDC Team module (optional — removable block)
#   4. Applies the LoginForm.tsx patch + settings nav injection
#   5. Installs dependencies & builds the Next.js application
#   6. Runs build-time unit tests + artefact verification
#   7. Produces a lean production image
#
# Build:
#   docker build -t umami-oidc .
#
# Build with a specific umami version/tag:
#   docker build --build-arg UMAMI_BRANCH=v3.0.3 -t umami-oidc .
#
# Run:
#   docker run -e DATABASE_URL=postgresql://... -e OIDC_ENABLED=true \
#     -e OIDC_CLIENT_ID=... -e OIDC_CLIENT_SECRET=... \
#     -e OIDC_ISSUER_URL=... -p 3000:3000 umami-oidc
###############################################################################

ARG NODE_IMAGE_VERSION="22-alpine"
ARG UMAMI_REPO="https://github.com/umami-software/umami.git"
ARG UMAMI_BRANCH="master"

# =============================================================================
# Stage 1 — Clone & Patch
# =============================================================================
FROM node:${NODE_IMAGE_VERSION} AS source

ARG UMAMI_REPO
ARG UMAMI_BRANCH

RUN apk add --no-cache git

WORKDIR /app

# Clone the Umami repository
RUN git clone --depth 1 --branch ${UMAMI_BRANCH} ${UMAMI_REPO} .

# ---- Inject OIDC module files ------------------------------------------------
# Core libraries
COPY oidc-module/src/lib/oidc.ts        ./src/lib/oidc.ts
COPY oidc-module/src/lib/oidc-user.ts   ./src/lib/oidc-user.ts

# API routes
COPY oidc-module/src/app/api/auth/oidc/authorize/route.ts \
     ./src/app/api/auth/oidc/authorize/route.ts
COPY oidc-module/src/app/api/auth/oidc/callback/route.ts \
     ./src/app/api/auth/oidc/callback/route.ts
COPY oidc-module/src/app/api/auth/oidc/complete/route.ts \
     ./src/app/api/auth/oidc/complete/route.ts
COPY oidc-module/src/app/api/auth/oidc/config/route.ts \
     ./src/app/api/auth/oidc/config/route.ts

# UI components
COPY oidc-module/src/app/login/OidcLoginButton.tsx \
     ./src/app/login/OidcLoginButton.tsx
COPY oidc-module/src/components/hooks/useOidcConfig.ts \
     ./src/components/hooks/useOidcConfig.ts

# ---- Apply the LoginForm.tsx patch -------------------------------------------
# Keep the original for reference, then attempt the patch.
# If patch fails (e.g. upstream changed the file), fall back to the
# complete pre-patched LoginForm.tsx we ship in the OIDC module.
COPY loginform-oidc.patch /tmp/loginform-oidc.patch
COPY oidc-module/src/app/login/LoginForm.tsx /tmp/LoginForm.tsx.patched

RUN cp src/app/login/LoginForm.tsx src/app/login/LoginForm.tsx.orig 2>/dev/null || true && \
    if git apply --check /tmp/loginform-oidc.patch 2>/dev/null; then \
      git apply /tmp/loginform-oidc.patch && \
      echo "PATCH: Applied cleanly"; \
    else \
      echo "PATCH: Did not apply cleanly, using pre-patched LoginForm.tsx"; \
      cp /tmp/LoginForm.tsx.patched ./src/app/login/LoginForm.tsx; \
    fi

# ---- Verify OIDC files are in place -----------------------------------------
RUN echo "=== OIDC file check ===" && \
    test -f src/lib/oidc.ts                             && echo "  OK oidc.ts" && \
    test -f src/lib/oidc-user.ts                        && echo "  OK oidc-user.ts" && \
    test -f src/app/api/auth/oidc/authorize/route.ts    && echo "  OK authorize route" && \
    test -f src/app/api/auth/oidc/callback/route.ts     && echo "  OK callback route" && \
    test -f src/app/api/auth/oidc/complete/route.ts     && echo "  OK complete route" && \
    test -f src/app/api/auth/oidc/config/route.ts       && echo "  OK config route" && \
    test -f src/app/login/OidcLoginButton.tsx            && echo "  OK OidcLoginButton" && \
    test -f src/components/hooks/useOidcConfig.ts        && echo "  OK useOidcConfig hook" && \
    grep -q 'OidcLoginButton' src/app/login/LoginForm.tsx && echo "  OK LoginForm patched" && \
    echo "=== All OIDC files verified ==="

# ---- Inject OIDC Team Module (optional — remove this block to disable) ------
# This module adds automatic team assignment based on OIDC claims.
# It can be safely removed without affecting OIDC login.

# Core libraries
COPY oidc-team-module/src/lib/oidc-teams.ts        ./src/lib/oidc-teams.ts
COPY oidc-team-module/src/lib/oidc-team-bridge.ts   ./src/lib/oidc-team-bridge.ts

# API route
COPY oidc-team-module/src/app/api/auth/oidc/team-rules/route.ts \
     ./src/app/api/auth/oidc/team-rules/route.ts

# Standalone settings page (Next.js auto-routes to /settings/oidc-teams)
COPY oidc-team-module/src/app/\(main\)/settings/oidc-teams/page.tsx \
     ./src/app/\(main\)/settings/oidc-teams/page.tsx

# ---- Apply the SettingsNav.tsx patch (adds "OIDC Teams" to sidebar) --------
COPY settingsnav-oidc-teams.patch /tmp/settingsnav-oidc-teams.patch
COPY oidc-team-module/src/app/\(main\)/settings/SettingsNav.tsx /tmp/SettingsNav.tsx.patched

RUN cp src/app/\(main\)/settings/SettingsNav.tsx src/app/\(main\)/settings/SettingsNav.tsx.orig 2>/dev/null || true && \
    if git apply --check /tmp/settingsnav-oidc-teams.patch 2>/dev/null; then \
      git apply /tmp/settingsnav-oidc-teams.patch && \
      echo "PATCH: SettingsNav applied cleanly"; \
    else \
      echo "PATCH: SettingsNav did not apply cleanly, using pre-patched version"; \
      cp /tmp/SettingsNav.tsx.patched ./src/app/\(main\)/settings/SettingsNav.tsx; \
    fi

# Verify team module files
RUN echo "=== OIDC Team Module file check ===" && \
    test -f src/lib/oidc-teams.ts                          && echo "  OK oidc-teams.ts" && \
    test -f src/lib/oidc-team-bridge.ts                    && echo "  OK oidc-team-bridge.ts" && \
    test -f src/app/api/auth/oidc/team-rules/route.ts      && echo "  OK team-rules route" && \
    test -f "src/app/(main)/settings/oidc-teams/page.tsx"  && echo "  OK oidc-teams page" && \
    grep -q 'oidc-teams' "src/app/(main)/settings/SettingsNav.tsx" && echo "  OK SettingsNav patched" && \
    echo "=== OIDC Team Module verified ==="

# =============================================================================
# Stage 2 — Install dependencies
# =============================================================================
FROM node:${NODE_IMAGE_VERSION} AS deps

RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY --from=source /app/package.json /app/pnpm-lock.yaml ./
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

# =============================================================================
# Stage 3 — Build the Next.js application
# =============================================================================
FROM node:${NODE_IMAGE_VERSION} AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=source /app .

# Docker middleware (upstream convention)
COPY --from=source /app/docker/middleware.ts ./src

ARG BASE_PATH
ENV BASE_PATH=$BASE_PATH
ENV NEXT_TELEMETRY_DISABLED=1
# Dummy DATABASE_URL so Prisma generates the client at build time
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/dummy"

# Diagnostic: show what crypto.ts and jwt.ts export so OIDC imports match
RUN echo "=== Umami export audit ===" && \
    echo "--- src/lib/crypto.ts exports ---" && \
    grep -E '^export ' src/lib/crypto.ts 2>/dev/null || echo "(file not found)" && \
    echo "--- src/lib/jwt.ts exports ---" && \
    grep -E '^export ' src/lib/jwt.ts 2>/dev/null || echo "(file not found)" && \
    echo "--- src/lib/auth.ts imports ---" && \
    grep -E '^import ' src/lib/auth.ts 2>/dev/null || echo "(file not found)" && \
    echo "==========================="

RUN npm run build-docker

# =============================================================================
# Stage 4 — Build-time tests
#
# Runs unit tests on pure OIDC functions and verifies build artefacts.
# If any test fails, the Docker build is aborted.
# =============================================================================
FROM node:${NODE_IMAGE_VERSION} AS test

WORKDIR /test

RUN npm install -g pnpm

# Install test dependencies (vitest + debug which oidc.ts imports)
RUN pnpm add vitest debug && \
    pnpm add -D @types/node

# Copy OIDC source files to test against
COPY --from=source /app/src/lib/oidc.ts      ./src/lib/oidc.ts
COPY --from=source /app/src/lib/oidc-user.ts ./src/lib/oidc-user.ts

# Copy test files
COPY tests/oidc-unit.test.ts  ./tests/oidc-unit.test.ts
COPY tests/vitest.config.ts   ./vitest.config.ts
COPY tests/tsconfig.test.json ./tsconfig.json

# Run unit tests
RUN echo "=== Running OIDC unit tests ===" && \
    npx vitest run --config vitest.config.ts --reporter=verbose 2>&1 && \
    echo "=== Unit tests PASSED ==="

# Verify build artefacts from the builder stage
COPY --from=builder /app/.next/standalone/server.js /verify/server.js
COPY --from=builder /app/.next/static               /verify/static

RUN echo "" && \
    echo "=== Build artefact verification ===" && \
    test -f /verify/server.js              && echo "  OK server.js exists" && \
    test -d /verify/static                 && echo "  OK .next/static exists" && \
    echo "=== All checks passed ==="

# =============================================================================
# Stage 5 — Production image
# =============================================================================
FROM node:${NODE_IMAGE_VERSION} AS runner

WORKDIR /app

ARG PRISMA_VERSION="6.19.0"
ARG NODE_OPTIONS

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=$NODE_OPTIONS

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    apk add --no-cache curl && \
    npm install -g pnpm

# Script dependencies (matches upstream Dockerfile)
RUN pnpm --allow-build='@prisma/engines' add npm-run-all dotenv chalk semver \
    prisma@${PRISMA_VERSION} \
    @prisma/adapter-pg@${PRISMA_VERSION}

# Copy build artefacts
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/generated ./generated

# Next.js standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Runtime smoke-test script
COPY --chown=nextjs:nodejs tests/smoke-test.sh /app/tests/smoke-test.sh
RUN chmod +x /app/tests/smoke-test.sh

# Force the test stage to have run (creates a build dependency on it).
# Without this line Docker may skip the test stage entirely.
COPY --from=test /verify/server.js /tmp/.build-verified
RUN rm -f /tmp/.build-verified

USER nextjs

EXPOSE 3000

ENV HOSTNAME=0.0.0.0
ENV PORT=3000

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:3000/api/heartbeat || exit 1

CMD ["pnpm", "start-docker"]
