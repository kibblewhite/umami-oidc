/**
 * OIDC Team Mapping Module for Umami Analytics
 *
 * Manages automatic team assignment based on OIDC identity provider claims.
 * Rules are stored in Redis and evaluated on each OIDC login.
 *
 * This module is independent of the core OIDC auth module. If it is not
 * installed, OIDC login continues to work — users simply won't be
 * auto-joined to teams.
 *
 * Storage: Redis key `oidc:team:rules` → JSON map of teamId → rules[]
 *
 * Place this file at: src/lib/oidc-teams.ts
 */

import debug from 'debug';
import redis from '@/lib/redis';
import prisma from '@/lib/prisma';
import { TEAM_ROLES } from '@/lib/constants';
import { randomUUID } from 'crypto';

const log = debug('umami:oidc:teams');

const RULES_KEY = 'oidc:team:rules';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamClaimRule {
  id: string;
  claimField: string;
  claimValue: string;
  teamRole: string;
  createdAt: string;
}

export interface TeamRulesMap {
  [teamId: string]: TeamClaimRule[];
}

// ---------------------------------------------------------------------------
// CRUD operations (Redis-backed)
// ---------------------------------------------------------------------------

/**
 * Retrieve all team → rules mappings.
 */
export async function getAllTeamRules(): Promise<TeamRulesMap> {
  if (!redis.enabled) return {};
  try {
    const data = await redis.client.get(RULES_KEY);
    return data ? JSON.parse(data) : {};
  } catch (err) {
    log('Error reading team rules: %O', err);
    return {};
  }
}

/**
 * Get rules for a specific team.
 */
export async function getTeamRules(teamId: string): Promise<TeamClaimRule[]> {
  const all = await getAllTeamRules();
  return all[teamId] || [];
}

/**
 * Add a claim-matching rule to a team.
 */
export async function addTeamRule(
  teamId: string,
  claimField: string,
  claimValue: string,
  teamRole: string = 'team_member',
): Promise<TeamClaimRule> {
  const all = await getAllTeamRules();
  if (!all[teamId]) all[teamId] = [];

  const rule: TeamClaimRule = {
    id: randomUUID(),
    claimField: claimField.trim(),
    claimValue: claimValue.trim(),
    teamRole,
    createdAt: new Date().toISOString(),
  };

  all[teamId].push(rule);
  await redis.client.set(RULES_KEY, JSON.stringify(all));
  log('Added rule %s for team %s: %s=%s', rule.id, teamId, claimField, claimValue);
  return rule;
}

/**
 * Remove a rule by ID from a team.
 */
export async function removeTeamRule(
  teamId: string,
  ruleId: string,
): Promise<boolean> {
  const all = await getAllTeamRules();
  if (!all[teamId]) return false;

  const before = all[teamId].length;
  all[teamId] = all[teamId].filter(r => r.id !== ruleId);

  if (all[teamId].length === 0) {
    delete all[teamId];
  }

  if ((all[teamId]?.length ?? 0) === before) return false;

  await redis.client.set(RULES_KEY, JSON.stringify(all));
  log('Removed rule %s from team %s', ruleId, teamId);
  return true;
}

// ---------------------------------------------------------------------------
// Claim matching & team join (called from OIDC callback)
// ---------------------------------------------------------------------------

/**
 * Process team claim mappings after a successful OIDC login.
 *
 * For each team that has rules, check if the user's OIDC claims match
 * any rule. If so, ensure the user is a member of that team.
 *
 * This function is designed to be called from the OIDC callback via
 * dynamic import — if the module is not installed, the import fails
 * silently and login proceeds without team assignment.
 */
export async function processOidcTeamMappings(
  userId: string,
  userInfo: Record<string, unknown>,
  idTokenClaims: Record<string, unknown>,
): Promise<void> {
  if (!redis.enabled) {
    log('Redis not available, skipping team mappings');
    return;
  }

  const allRules = await getAllTeamRules();
  const teamIds = Object.keys(allRules);

  if (teamIds.length === 0) {
    log('No team rules configured');
    return;
  }

  log('Checking %d teams for claim matches', teamIds.length);

  for (const teamId of teamIds) {
    const rules = allRules[teamId];

    for (const rule of rules) {
      // Look for the claim in both userinfo and id_token
      const claimValue =
        userInfo[rule.claimField] ?? idTokenClaims[rule.claimField];

      if (matchesClaim(claimValue, rule.claimValue)) {
        log(
          'Match: %s=%s → team %s (role: %s)',
          rule.claimField,
          rule.claimValue,
          teamId,
          rule.teamRole,
        );
        await ensureTeamMembership(userId, teamId, rule.teamRole);
        break; // One match per team is sufficient
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if an OIDC claim value matches the expected value.
 * Supports: arrays, exact strings, comma-separated strings.
 */
function matchesClaim(claimValue: unknown, expectedValue: string): boolean {
  if (claimValue == null) return false;

  // Array claim (e.g. groups: ["admin", "analytics"])
  if (Array.isArray(claimValue)) {
    return claimValue.some(v => String(v) === expectedValue);
  }

  // Exact string match
  if (typeof claimValue === 'string') {
    if (claimValue === expectedValue) return true;
    // Comma-separated fallback
    return claimValue
      .split(',')
      .map(s => s.trim())
      .includes(expectedValue);
  }

  // Fallback: coerce to string
  return String(claimValue) === expectedValue;
}

/**
 * Ensure a user is a member of a team. No-op if already a member.
 */
async function ensureTeamMembership(
  userId: string,
  teamId: string,
  role: string,
): Promise<void> {
  try {
    // Check team exists
    const team = await prisma.client.team.findUnique({
      where: { id: teamId },
    });

    if (!team) {
      log('Team %s not found, skipping', teamId);
      return;
    }

    // Check if already a member
    const existing = await prisma.client.teamUser.findFirst({
      where: { userId, teamId },
    });

    if (existing) {
      log('User already in team %s (role: %s)', teamId, existing.role);
      return;
    }

    // Add to team
    await prisma.client.teamUser.create({
      data: {
        id: randomUUID(),
        teamId,
        userId,
        role: role || 'team_member',
      },
    });

    log('Added user %s to team %s with role %s', userId, teamId, role);
  } catch (err) {
    log('Error adding user to team %s: %O', teamId, err);
  }
}
