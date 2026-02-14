/**
 * OIDC Team Mapping Bridge
 *
 * This small wrapper is called from the OIDC callback to trigger
 * automatic team assignment. It exists as a separate file so that:
 *
 *   1. The base oidc-module can try to import it via dynamic import
 *   2. If the oidc-team-module is NOT installed, the import fails
 *      silently and login continues without team assignment
 *   3. If it IS installed, team claim rules are evaluated
 *
 * Place this file at: src/lib/oidc-team-bridge.ts
 */

import { processOidcTeamMappings } from '@/lib/oidc-teams';

/**
 * Process team assignments based on OIDC claims.
 * Called from the OIDC callback after user creation.
 */
export async function applyTeamMappings(
  userId: string,
  userInfo: Record<string, unknown>,
  idTokenClaims: Record<string, unknown>,
): Promise<void> {
  await processOidcTeamMappings(userId, userInfo, idTokenClaims);
}
