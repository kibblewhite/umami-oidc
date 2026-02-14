/**
 * OIDC Configuration Endpoint (public)
 *
 * GET /api/auth/oidc/config
 *
 * Returns public OIDC configuration that the login page uses to
 * decide whether to show the SSO button and what label to display.
 * This endpoint does NOT expose secrets.
 *
 * Place this file at: src/app/api/auth/oidc/config/route.ts
 */

import { NextResponse } from 'next/server';
import { getOidcConfig } from '@/lib/oidc';

export async function GET() {
  const cfg = getOidcConfig();

  return NextResponse.json({
    enabled: cfg.enabled,
    displayName: cfg.displayName,
    // The authorize URL the client should redirect to
    authorizeUrl: cfg.enabled ? '/api/auth/oidc/authorize' : null,
  });
}
