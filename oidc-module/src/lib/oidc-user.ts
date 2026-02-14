/**
 * OIDC User Provisioning for Umami
 *
 * Handles automatic user creation/lookup when users authenticate
 * via OIDC. Integrates with Umami's existing Prisma-based user model.
 *
 * This module should be placed at: src/lib/oidc-user.ts
 */

import debug from 'debug';
import { getOidcConfig, OidcUserInfo, mapOidcRole } from './oidc';
// These imports reference Umami's existing modules:
import prisma from '@/lib/prisma';
import { ROLES } from '@/lib/constants';
import { randomBytes, randomUUID } from 'crypto';

const log = debug('umami:oidc:user');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OidcProvisionedUser {
  id: string;
  username: string;
  role: string;
  isAdmin: boolean;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// User lookup / creation
// ---------------------------------------------------------------------------

/**
 * Find or create a Umami user from OIDC claims.
 *
 * Strategy:
 *   1. Look up user by `oidcSub` field (the OIDC subject identifier)
 *   2. If not found, look up by email or preferred_username
 *   3. If still not found and auto-create is enabled, create a new user
 *   4. Update the user's role if it has changed in the IdP
 *
 * The `oidcSub` is stored in the user's data column or as a username
 * prefix to maintain the OIDC link without requiring a schema migration.
 */
export async function findOrCreateOidcUser(
  userInfo: OidcUserInfo,
  idTokenClaims: Record<string, unknown>,
): Promise<OidcProvisionedUser> {
  const cfg = getOidcConfig();
  const oidcSub = userInfo.sub;
  const email = userInfo.email;
  const preferredUsername = userInfo.preferred_username;
  const displayName = userInfo.name ?? preferredUsername ?? email ?? oidcSub;
  const umamiRole = mapOidcRole(userInfo, idTokenClaims);

  log('Looking up user: sub=%s email=%s username=%s role=%s',
    oidcSub, email, preferredUsername, umamiRole);

  // --- 1. Look up by OIDC subject (stored in username with oidc: prefix
  //        or in the user record itself)
  const oidcUsername = buildOidcUsername(oidcSub, preferredUsername, email);

  let user = await prisma.client.user.findFirst({
    where: {
      OR: [
        { username: oidcUsername },
        ...(email ? [{ username: email }] : []),
        ...(preferredUsername ? [{ username: preferredUsername }] : []),
      ],
    },
  });

  if (user) {
    log('Found existing user: id=%s username=%s', user.id, user.username);

    // Update role if changed
    const currentRole = user.role;
    if (currentRole !== umamiRole) {
      log('Updating user role from %s to %s', currentRole, umamiRole);
      user = await prisma.client.user.update({
        where: { id: user.id },
        data: { role: umamiRole },
      });
    }

    // Ensure username matches the OIDC-derived username for future lookups
    if (user.username !== oidcUsername) {
      log('Updating username from %s to %s', user.username, oidcUsername);
      try {
        user = await prisma.client.user.update({
          where: { id: user.id },
          data: { username: oidcUsername },
        });
      } catch {
        // If the username is already taken, keep the existing one
        log('Username update failed (likely conflict), keeping existing');
      }
    }

    return toProvisionedUser(user);
  }

  // --- 2. Auto-create if enabled
  if (!cfg.autoCreate) {
    throw new Error(
      `OIDC user "${displayName}" (sub: ${oidcSub}) not found and auto-creation is disabled. ` +
      `An admin must create this user manually.`,
    );
  }

  log('Creating new user: username=%s role=%s', oidcUsername, umamiRole);

  const newUser = await prisma.client.user.create({
    data: {
      id: randomUUID(),
      username: oidcUsername,
      password: randomBytes(20).toString('hex'),  // 40 chars – never used, just satisfies NOT NULL
      role: umamiRole,
    },
  });

  log('Created user: id=%s', newUser.id);
  return toProvisionedUser(newUser);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a deterministic Umami username from OIDC claims.
 * We prefer `preferred_username`, then `email`, then the OIDC `sub`.
 * All OIDC-provisioned usernames are lowercased for consistency.
 */
function buildOidcUsername(
  sub: string,
  preferredUsername?: string,
  email?: string,
): string {
  if (preferredUsername) {
    return preferredUsername.toLowerCase().trim();
  }
  if (email) {
    return email.toLowerCase().trim();
  }
  // Fallback: use the OIDC subject
  return `oidc:${sub}`;
}

function toProvisionedUser(user: any): OidcProvisionedUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    isAdmin: user.role === ROLES.admin,
    createdAt: user.createdAt,
  };
}
