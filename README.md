# Umami + OIDC — Docker Build

Build a ready-to-run Umami Analytics Docker image with OIDC single sign-on baked in.

## What's in the box

```
.
├── Dockerfile                 # Multi-stage build (clone → patch → build → test → production)
├── docker-compose.yml         # Full stack: Umami + PostgreSQL
├── build-and-test.sh          # One-command build + test runner
├── loginform-oidc.patch       # Git patch for LoginForm.tsx
├── oidc-module/               # OIDC source files injected into Umami
│   └── src/
│       ├── lib/
│       │   ├── oidc.ts        # Core OIDC logic
│       │   └── oidc-user.ts   # User provisioning
│       ├── app/
│       │   ├── api/auth/oidc/
│       │   │   ├── authorize/route.ts
│       │   │   ├── callback/route.ts
│       │   │   ├── complete/route.ts
│       │   │   └── config/route.ts
│       │   └── login/
│       │       ├── OidcLoginButton.tsx
│       │       └── LoginForm.tsx      # Pre-patched fallback
│       └── components/hooks/
│           └── useOidcConfig.ts
└── tests/
    ├── oidc-unit.test.ts      # Unit tests (run during build)
    ├── vitest.config.ts       # Vitest configuration
    ├── tsconfig.test.json     # TypeScript config for tests
    └── smoke-test.sh          # Runtime integration tests
```

## Quick start

```bash
# Build + run all tests in one command
chmod +x build-and-test.sh
./build-and-test.sh
```

Or step by step:

```bash
# 1. Build the image (unit tests run automatically during build)
docker build -t umami-oidc .

# 2. Start the stack
docker compose up -d

# 3. Run runtime smoke tests
docker compose exec umami /app/tests/smoke-test.sh
```

## Build arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `UMAMI_REPO` | `https://github.com/umami-software/umami.git` | Git repository to clone |
| `UMAMI_BRANCH` | `master` | Branch or tag to build from |
| `NODE_IMAGE_VERSION` | `22-alpine` | Base Node.js image |
| `BASE_PATH` | *(empty)* | Next.js base path |
| `PRISMA_VERSION` | `6.19.0` | Prisma version for runtime |

```bash
# Pin to a specific Umami release
docker build --build-arg UMAMI_BRANCH=v3.0.3 -t umami-oidc .
```

## Testing

### Build-time tests (automatic)

The Docker build includes a **test stage** that runs automatically. If any test fails, the build aborts. Tests include:

- **30+ unit tests** for OIDC pure functions:
  - Config parsing (env var reading, defaults, validation)
  - CSRF state generation and verification (HMAC signing, expiry, tamper detection)
  - Nonce generation (uniqueness, format)
  - JWT claim parsing (valid tokens, malformed input, nested objects)
  - Role mapping (array claims, string claims, comma-separated, Keycloak paths, custom claim names)
- **Build artefact verification** (server.js exists, static assets present)

### Runtime smoke tests (manual)

After the container is running:

```bash
docker compose exec umami /app/tests/smoke-test.sh
```

These verify:
- Umami heartbeat responds
- Login page loads
- OIDC config endpoint returns correct JSON structure
- OIDC authorize endpoint behaviour (404 when disabled, 302 redirect when enabled)
- OIDC callback rejects bare requests properly
- OIDC complete endpoint is reachable
- Standard username/password auth still works alongside OIDC

### Running tests with OIDC enabled

To test the full OIDC flow, uncomment the OIDC env vars in `docker-compose.yml`, point them at your IdP, then:

```bash
docker compose up -d --build
docker compose exec umami /app/tests/smoke-test.sh
```

The smoke tests automatically detect whether OIDC is enabled and run additional checks (redirect URL validation, CSRF state in parameters, authorization code flow verification).

## Configuration

Set these environment variables in `docker-compose.yml` or at runtime:

```yaml
environment:
  DATABASE_URL: postgresql://umami:umami@db:5432/umami
  APP_SECRET: change-me

  OIDC_ENABLED: "true"
  OIDC_CLIENT_ID: umami
  OIDC_CLIENT_SECRET: your-secret
  OIDC_ISSUER_URL: https://auth.example.com/realms/main
  OIDC_REDIRECT_URI: https://analytics.example.com/api/auth/oidc/callback
  OIDC_ROLE_CLAIM: groups
  OIDC_ADMIN_GROUP: umami-admin
  OIDC_AUTO_CREATE: "true"
  OIDC_DISPLAY_NAME: "Single Sign-On"
```

## How the build works

```
┌─────────────────────────────────────────────────────────┐
│  Stage 1: source                                        │
│  - git clone umami                                      │
│  - COPY OIDC module files into src/                     │
│  - git apply loginform-oidc.patch (fallback if fails)   │
│  - Verify all OIDC files are in place                   │
├─────────────────────────────────────────────────────────┤
│  Stage 2: deps                                          │
│  - pnpm install --frozen-lockfile                       │
├─────────────────────────────────────────────────────────┤
│  Stage 3: builder                                       │
│  - npm run build-docker                                 │
│  - Produces .next/standalone + .next/static             │
├─────────────────────────────────────────────────────────┤
│  Stage 4: test                                          │
│  - Installs vitest                                      │
│  - Runs 30+ unit tests on OIDC pure functions           │
│  - Verifies build artefacts from stage 3                │
│  - BUILD FAILS if any test fails                        │
├─────────────────────────────────────────────────────────┤
│  Stage 5: runner  (final production image)              │
│  - Lean Alpine image with only production artefacts     │
│  - Includes /app/tests/smoke-test.sh for runtime tests  │
│  - HEALTHCHECK on /api/heartbeat                        │
│  - Forces stage 4 (test) to have passed via COPY --from │
└─────────────────────────────────────────────────────────┘
```
