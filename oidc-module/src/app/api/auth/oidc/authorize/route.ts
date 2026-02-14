/**
 * OIDC Authorization Endpoint
 *
 * GET /api/auth/oidc/authorize
 *
 * Initiates the OIDC authorization code flow by redirecting the user
 * to the identity provider's authorization endpoint.
 *
 * Place this file at: src/app/api/auth/oidc/authorize/route.ts
 */

import { NextResponse } from 'next/server';
import {
  getOidcConfig,
  validateOidcConfig,
  buildAuthorizationUrl,
  generateState,
  generateNonce,
} from '@/lib/oidc';
import { secret } from '@/lib/crypto';

export async function GET(request: Request) {
  const cfg = getOidcConfig();

  // Check if OIDC is enabled
  if (!cfg.enabled) {
    return NextResponse.json(
      { error: 'OIDC authentication is not enabled' },
      { status: 404 },
    );
  }

  // Validate configuration
  const validationError = validateOidcConfig(cfg);
  if (validationError) {
    console.error('OIDC configuration error:', validationError);
    return NextResponse.json(
      { error: 'OIDC is misconfigured. Check server logs.' },
      { status: 500 },
    );
  }

  try {
    // Determine the redirect URI
    const redirectUri = getRedirectUri(request, cfg.redirectUri);

    // Generate state and nonce for CSRF protection
    const appSecret = secret();
    const state = generateState(appSecret);
    const nonce = generateNonce();

    // Build the authorization URL
    const authUrl = await buildAuthorizationUrl(state, nonce, redirectUri);

    // Store the state and nonce in cookies so we can verify them on callback
    const response = NextResponse.redirect(authUrl);

    response.cookies.set('oidc_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600, // 10 minutes
    });

    response.cookies.set('oidc_nonce', nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });

    // Store the redirect URI so the callback handler uses the same one
    response.cookies.set('oidc_redirect_uri', redirectUri, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });

    return response;
  } catch (err) {
    console.error('OIDC authorize error:', err);
    return NextResponse.json(
      { error: 'Failed to initiate OIDC login' },
      { status: 500 },
    );
  }
}

/**
 * Determine the redirect URI for the OIDC callback.
 * Priority: explicit env var > APP_URL > request URL origin.
 */
function getRedirectUri(request: Request, configuredUri: string): string {
  if (configuredUri) {
    return configuredUri;
  }

  // Try APP_URL
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    return `${appUrl.replace(/\/+$/, '')}/api/auth/oidc/callback`;
  }

  // Fall back to request origin
  const url = new URL(request.url);
  return `${url.origin}/api/auth/oidc/callback`;
}
