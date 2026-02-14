/**
 * OIDC Callback Endpoint
 *
 * GET /api/auth/oidc/callback
 *
 * Handles the callback from the identity provider after the user has
 * authenticated. Exchanges the authorization code for tokens, resolves
 * the user, creates an Umami session, and redirects to the dashboard.
 *
 * Token strategy:
 *   - With Redis:    saveAuth() → Redis-backed session token (preferred)
 *   - Without Redis: createSecureToken({ userId }) → direct JWT fallback
 *
 * Both paths produce an encrypted token that checkAuth() can validate.
 * Redis is strongly recommended — without it, saveAuth tokens cannot be
 * validated on subsequent requests.
 *
 * Place this file at: src/app/api/auth/oidc/callback/route.ts
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getOidcConfig,
  verifyState,
  exchangeCode,
  getUserInfo,
  parseIdTokenClaims,
} from '@/lib/oidc';
import { findOrCreateOidcUser } from '@/lib/oidc-user';
import { saveAuth } from '@/lib/auth';
import { secret } from '@/lib/crypto';
import { createSecureToken } from '@/lib/jwt';
import redis from '@/lib/redis';

export async function GET(request: Request) {
  const cfg = getOidcConfig();
  const baseUrl = getExternalBaseUrl(request);

  console.log('[OIDC callback] baseUrl=%s', baseUrl);

  if (!cfg.enabled) {
    return NextResponse.redirect(new URL('/login', baseUrl));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  // Handle IdP errors
  if (error) {
    console.error('[OIDC callback] IdP error:', error, errorDescription);
    const loginUrl = new URL('/login', baseUrl);
    loginUrl.searchParams.set('error', `OIDC: ${errorDescription || error}`);
    return NextResponse.redirect(loginUrl);
  }

  // Validate required parameters
  if (!code || !state) {
    console.error('[OIDC callback] Missing code or state');
    const loginUrl = new URL('/login', baseUrl);
    loginUrl.searchParams.set('error', 'Invalid OIDC callback: missing code or state');
    return NextResponse.redirect(loginUrl);
  }

  try {
    const cookieStore = await cookies();

    // --- 1. Verify CSRF state ---
    const savedState = cookieStore.get('oidc_state')?.value;
    const savedNonce = cookieStore.get('oidc_nonce')?.value;
    const savedRedirectUri = cookieStore.get('oidc_redirect_uri')?.value;

    console.log('[OIDC callback] state match=%s, has nonce=%s, has redirectUri=%s',
      state === savedState, !!savedNonce, !!savedRedirectUri);

    if (!savedState || state !== savedState) {
      throw new Error('OIDC state mismatch – possible CSRF attack');
    }

    // Verify state signature and expiry
    const appSecret = secret();
    if (!verifyState(state, appSecret)) {
      throw new Error('OIDC state verification failed (expired or tampered)');
    }

    // --- 2. Determine the redirect URI (must match what was sent) ---
    const redirectUri = savedRedirectUri || `${baseUrl}/api/auth/oidc/callback`;
    console.log('[OIDC callback] redirectUri=%s', redirectUri);

    // --- 3. Exchange authorization code for tokens ---
    const tokens = await exchangeCode(code, redirectUri);
    console.log('[OIDC callback] token exchange OK, has id_token=%s, has access_token=%s',
      !!tokens.id_token, !!tokens.access_token);

    // --- 4. Verify nonce in id_token ---
    const idTokenClaims = parseIdTokenClaims(tokens.id_token);
    if (savedNonce && idTokenClaims.nonce && idTokenClaims.nonce !== savedNonce) {
      throw new Error('OIDC nonce mismatch');
    }

    // --- 5. Get user information ---
    const userInfo = await getUserInfo(tokens.access_token);
    console.log('[OIDC callback] userInfo: sub=%s, email=%s, preferred_username=%s',
      userInfo.sub, userInfo.email, userInfo.preferred_username);

    // --- 6. Find or create Umami user ---
    const umamiUser = await findOrCreateOidcUser(userInfo, idTokenClaims);
    console.log('[OIDC callback] Umami user: id=%s, username=%s, role=%s, isAdmin=%s',
      umamiUser.id, umamiUser.username, umamiUser.role, umamiUser.isAdmin);

    // --- 6b. Process team mappings (optional — requires oidc-team-module) ---
    // Uses dynamic import so it fails silently if the team module is not installed.
    // This is the ONLY coupling point between oidc-module and oidc-team-module.
    try {
      const { applyTeamMappings } = await import('@/lib/oidc-team-bridge');
      await applyTeamMappings(umamiUser.id, userInfo as Record<string, unknown>, idTokenClaims);
      console.log('[OIDC callback] team mappings processed');
    } catch {
      // Team module not installed — this is expected and fine
    }

    // --- 7. Create Umami auth token ---
    let token: string;

    if (redis.enabled) {
      // Redis-backed session: saveAuth stores user data in Redis and returns
      // an encrypted JWT containing only the auth key. checkAuth can look up
      // the key in Redis to resolve the user. This is Umami's preferred path.
      console.log('[OIDC callback] Redis is available, using saveAuth');
      token = await saveAuth({
        userId: umamiUser.id,
        role: umamiUser.role,
        isAdmin: umamiUser.isAdmin,
      });
    } else {
      // Fallback: create a direct JWT with userId embedded. checkAuth can
      // decrypt and fetch the user from the database directly.
      console.warn('[OIDC callback] Redis NOT available — using direct JWT fallback');
      token = createSecureToken({ userId: umamiUser.id }, appSecret);
    }
    console.log('[OIDC callback] auth token created, length=%d, redis=%s', token.length, redis.enabled);

    // --- 8. Set cookies and redirect to complete page ---
    const completeUrl = new URL('/api/auth/oidc/complete', baseUrl);
    const response = NextResponse.redirect(completeUrl);

    // Clear OIDC-specific cookies
    response.cookies.delete('oidc_state');
    response.cookies.delete('oidc_nonce');
    response.cookies.delete('oidc_redirect_uri');

    // Set the standard Umami auth cookie for server-side / middleware auth.
    // This is how Next.js middleware and SSR pages authenticate requests.
    response.cookies.set('umami.auth', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 86400, // 24 hours (matches Umami default)
    });

    // Also pass the token via a JS-readable cookie so the /complete page
    // can store it in localStorage (where the Umami client reads it for
    // Authorization: Bearer headers on API calls).
    response.cookies.set('oidc_auth_token', token, {
      httpOnly: false, // needs to be readable by client JS
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60, // 1 minute – just long enough for the redirect
    });

    console.log('[OIDC callback] cookies set, redirecting to %s', completeUrl.toString());
    return response;
  } catch (err: any) {
    console.error('[OIDC callback] error:', err);
    const loginUrl = new URL('/login', baseUrl);
    loginUrl.searchParams.set(
      'error',
      err.message || 'OIDC authentication failed',
    );
    return NextResponse.redirect(loginUrl);
  }
}

/**
 * Resolve the external base URL visible to the user's browser.
 *
 * Priority:
 *   1. APP_URL env var (explicit, most reliable)
 *   2. X-Forwarded-Proto + X-Forwarded-Host headers (reverse proxy)
 *   3. Host header with X-Forwarded-Proto
 *   4. request.url (fallback — only correct without a reverse proxy)
 */
function getExternalBaseUrl(request: Request): string {
  // 1. Explicit APP_URL
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    return appUrl.replace(/\/+$/, '');
  }

  // 2. Reverse proxy headers
  const headers = request.headers;
  const forwardedHost = headers.get('x-forwarded-host');
  const forwardedProto = headers.get('x-forwarded-proto') || 'https';

  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  // 3. Host header
  const host = headers.get('host');
  if (host && !host.startsWith('0.0.0.0') && !host.startsWith('127.0.0.1')) {
    return `${forwardedProto}://${host}`;
  }

  // 4. Fallback to request URL
  const url = new URL(request.url);
  return url.origin;
}
