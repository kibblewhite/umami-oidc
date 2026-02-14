/**
 * OIDC Team Rules API
 *
 * GET    /api/auth/oidc/team-rules  → List all teams with their claim rules
 * POST   /api/auth/oidc/team-rules  → Add a claim rule to a team
 * DELETE /api/auth/oidc/team-rules  → Remove a claim rule
 *
 * All operations require admin authentication.
 * Rules are stored in Redis, not the database.
 *
 * Place this file at: src/app/api/auth/oidc/team-rules/route.ts
 */

import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import redis from '@/lib/redis';
import {
  getAllTeamRules,
  addTeamRule,
  removeTeamRule,
} from '@/lib/oidc-teams';

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function requireAdmin(request: Request) {
  let auth: any;

  try {
    auth = await (checkAuth as any)(request);
  } catch {
    return null;
  }

  if (!auth?.user?.isAdmin) return null;
  return auth.user;
}

// ---------------------------------------------------------------------------
// GET — List all teams with their claim rules
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const user = await requireAdmin(request);
  if (!user) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  if (!redis.enabled) {
    return NextResponse.json(
      { error: 'Redis is required for OIDC team mappings' },
      { status: 503 },
    );
  }

  try {
    // Fetch all teams from the database
    const teams = await prisma.client.team.findMany({
      select: { id: true, name: true, createdAt: true },
      orderBy: { name: 'asc' },
    });

    // Fetch all rules from Redis
    const rules = await getAllTeamRules();

    return NextResponse.json({ teams, rules });
  } catch (err: any) {
    console.error('[OIDC team-rules] GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Add a claim rule to a team
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const user = await requireAdmin(request);
  if (!user) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  if (!redis.enabled) {
    return NextResponse.json(
      { error: 'Redis is required for OIDC team mappings' },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const { teamId, claimField, claimValue, teamRole } = body;

    if (!teamId || !claimField || !claimValue) {
      return NextResponse.json(
        { error: 'teamId, claimField, and claimValue are required' },
        { status: 400 },
      );
    }

    // Verify the team exists
    const team = await prisma.client.team.findUnique({
      where: { id: teamId },
    });

    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }

    const rule = await addTeamRule(
      teamId,
      claimField,
      claimValue,
      teamRole || 'team_member',
    );

    return NextResponse.json({ rule }, { status: 201 });
  } catch (err: any) {
    console.error('[OIDC team-rules] POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — Remove a claim rule
// ---------------------------------------------------------------------------

export async function DELETE(request: Request) {
  const user = await requireAdmin(request);
  if (!user) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  if (!redis.enabled) {
    return NextResponse.json(
      { error: 'Redis is required for OIDC team mappings' },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const { teamId, ruleId } = body;

    if (!teamId || !ruleId) {
      return NextResponse.json(
        { error: 'teamId and ruleId are required' },
        { status: 400 },
      );
    }

    const removed = await removeTeamRule(teamId, ruleId);

    if (!removed) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[OIDC team-rules] DELETE error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
