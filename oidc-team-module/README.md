# OIDC Team Mapping Module for Umami

Automatically assign users to Umami teams based on identity provider (IdP) claims.

## Overview

This is an **optional, separate module** that extends the base OIDC authentication module. When installed:

- Admins can configure claim-based rules per team via a dedicated UI
- When users log in via OIDC, their claims are checked against the rules
- Matching users are automatically added to the corresponding teams

**Without this module**, OIDC login works exactly the same — users just aren't auto-joined to teams.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Umami Core (unmodified)                        │
│  ├── Team management (Prisma)                   │
│  ├── /api/teams endpoint                        │
│  └── Settings UI                                │
├─────────────────────────────────────────────────┤
│  OIDC Module (oidc-module/)                     │
│  ├── /api/auth/oidc/callback   ← bridge call    │
│  └── LoginForm patch                            │
├─────────────────────────────────────────────────┤
│  OIDC Team Module (oidc-team-module/) ← THIS    │
│  ├── /settings/oidc-teams      (standalone UI)  │
│  ├── /api/auth/oidc/team-rules (CRUD API)       │
│  ├── oidc-teams.ts             (core logic)     │
│  ├── oidc-team-bridge.ts       (callback hook)  │
│  └── inject-settings-nav.sh    (nav link patch) │
└─────────────────────────────────────────────────┘
```

### Separation of Concerns

| Component | Can run without? | Storage | Patches core? |
|-----------|-----------------|---------|---------------|
| Umami Core | ✅ Always | PostgreSQL | — |
| OIDC Module | ✅ Yes (no SSO) | Redis | LoginForm.tsx only |
| OIDC Team Module | ✅ Yes (no auto-teams) | Redis | Settings nav (optional) |

The **only coupling** between the two modules is a single `try/catch` dynamic import in the OIDC callback:

```typescript
try {
  const { applyTeamMappings } = await import('@/lib/oidc-team-bridge');
  await applyTeamMappings(userId, userInfo, idTokenClaims);
} catch {
  // Team module not installed — silently skip
}
```

## Files

```
oidc-team-module/
├── inject-settings-nav.sh                         # Auto-patches settings nav
├── README.md                                      # This file
└── src/
    ├── lib/
    │   ├── oidc-teams.ts                          # Core: CRUD, claim matching, team join
    │   └── oidc-team-bridge.ts                    # Bridge called from OIDC callback
    ├── app/
    │   ├── (main)/settings/oidc-teams/page.tsx    # Standalone admin UI
    │   └── api/auth/oidc/team-rules/route.ts      # REST API for rules
    └── (no patches to Umami core components)
```

## How It Works

### 1. Admin Configures Rules

Navigate to `/settings/oidc-teams` (or click "OIDC Teams" in settings sidebar if the nav patch was applied).

For each team, add rules like:

| Claim Field | Claim Value | Team Role |
|-------------|-------------|-----------|
| `groups`    | `marketing-analytics` | Member |
| `department`| `Engineering` | Member |
| `roles`     | `analytics-admin` | Owner |

### 2. User Logs In via OIDC

The OIDC callback automatically:

1. Creates/finds the Umami user (base OIDC module)
2. Fetches all team rules from Redis
3. Compares user's IdP claims against each rule
4. Adds the user to matching teams via Prisma

### 3. Claim Matching

The matcher supports multiple claim formats from IdPs:

- **Array claims**: `groups: ["team-a", "team-b"]` — checks if value is in the array
- **String claims**: `department: "Engineering"` — exact match
- **Comma-separated**: `roles: "viewer,editor"` — splits and checks each

## Installation (Docker)

Add these lines to the Dockerfile **after** the OIDC module section:

```dockerfile
# ---- Inject OIDC Team Module (optional) ------------------------------------
COPY oidc-team-module/src/lib/oidc-teams.ts       ./src/lib/oidc-teams.ts
COPY oidc-team-module/src/lib/oidc-team-bridge.ts  ./src/lib/oidc-team-bridge.ts

COPY oidc-team-module/src/app/api/auth/oidc/team-rules/route.ts \
     ./src/app/api/auth/oidc/team-rules/route.ts

COPY oidc-team-module/src/app/\(main\)/settings/oidc-teams/page.tsx \
     ./src/app/\(main\)/settings/oidc-teams/page.tsx

# Attempt to inject a nav link into settings sidebar
COPY oidc-team-module/inject-settings-nav.sh /tmp/inject-settings-nav.sh
RUN chmod +x /tmp/inject-settings-nav.sh && /tmp/inject-settings-nav.sh /app
```

## Requirements

- **Base OIDC Module**: Must be installed first
- **Redis**: Required for storing team rules (`REDIS_URL` env var)
- **Admin access**: Only admins can manage team rules

## API Reference

### GET /api/auth/oidc/team-rules

Returns all teams and their claim rules.

**Response:**
```json
{
  "teams": [
    { "id": "uuid", "name": "Marketing Analytics" }
  ],
  "rules": {
    "uuid": [
      {
        "id": "rule-uuid",
        "claimField": "groups",
        "claimValue": "marketing-analytics",
        "teamRole": "team_member",
        "createdAt": "2025-01-01T00:00:00Z"
      }
    ]
  }
}
```

### POST /api/auth/oidc/team-rules

Add a claim rule to a team.

**Body:**
```json
{
  "teamId": "uuid",
  "claimField": "groups",
  "claimValue": "marketing-analytics",
  "teamRole": "team_member"
}
```

### DELETE /api/auth/oidc/team-rules

Remove a claim rule.

**Body:**
```json
{
  "teamId": "uuid",
  "ruleId": "rule-uuid"
}
```

## Removing This Module

To remove without affecting OIDC login:

1. Delete the `oidc-team-module/` folder
2. Remove the corresponding `COPY` lines from the Dockerfile
3. Rebuild — the `try/catch` in the callback will silently skip

No database changes needed. Redis rules are simply ignored.
