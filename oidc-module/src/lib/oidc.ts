/**
 * OIDC Authentication Module for Umami Analytics
 *
 * This module adds OpenID Connect (OIDC) authentication support to Umami,
 * allowing users to sign in via external identity providers such as
 * Keycloak, Authentik, Authelia, Google, Azure AD, Okta, etc.
 *
 * Environment variables:
 *   OIDC_ENABLED          - Set to "1" or "true" to enable OIDC login
 *   OIDC_CLIENT_ID        - OAuth2 client ID
 *   OIDC_CLIENT_SECRET    - OAuth2 client secret
 *   OIDC_ISSUER_URL       - OIDC discovery URL (e.g. https://auth.example.com/realms/main)
 *   OIDC_SCOPES           - Space-separated scopes (default: "openid profile email")
 *   OIDC_REDIRECT_URI     - Callback URL (default: auto-detected from APP_URL or request)
 *   OIDC_ROLE_CLAIM       - JWT claim for Umami role mapping (default: "groups")
 *   OIDC_ADMIN_GROUP      - Group/role value that maps to Umami admin (default: "umami-admin")
 *   OIDC_AUTO_CREATE      - Auto-create users on first OIDC login (default: "true")
 *   OIDC_DISPLAY_NAME     - Button label on login page (default: "Single Sign-On")
 */

import debug from 'debug';

const log = debug('umami:oidc');

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

export interface OidcConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  issuerUrl: string;
  scopes: string;
  redirectUri: string;
  roleClaim: string;
  adminGroup: string;
  autoCreate: boolean;
  displayName: string;
}

export function getOidcConfig(): OidcConfig {
  const enabled =
    process.env.OIDC_ENABLED === '1' || process.env.OIDC_ENABLED === 'true';

  return {
    enabled,
    clientId: process.env.OIDC_CLIENT_ID ?? '',
    clientSecret: process.env.OIDC_CLIENT_SECRET ?? '',
    issuerUrl: process.env.OIDC_ISSUER_URL ?? '',
    scopes: process.env.OIDC_SCOPES ?? 'openid profile email',
    redirectUri: process.env.OIDC_REDIRECT_URI ?? '',
    roleClaim: process.env.OIDC_ROLE_CLAIM ?? 'groups',
    adminGroup: process.env.OIDC_ADMIN_GROUP ?? 'umami-admin',
    autoCreate: process.env.OIDC_AUTO_CREATE !== 'false',
    displayName: process.env.OIDC_DISPLAY_NAME ?? 'Single Sign-On',
  };
}

export function isOidcEnabled(): boolean {
  return getOidcConfig().enabled;
}

export function validateOidcConfig(cfg: OidcConfig): string | null {
  if (!cfg.enabled) return null;
  if (!cfg.clientId) return 'OIDC_CLIENT_ID is required';
  if (!cfg.clientSecret) return 'OIDC_CLIENT_SECRET is required';
  if (!cfg.issuerUrl) return 'OIDC_ISSUER_URL is required';
  return null;
}

// ---------------------------------------------------------------------------
// OIDC Discovery & token exchange (manual HTTP – no heavy dependencies)
// ---------------------------------------------------------------------------

interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  issuer: string;
  end_session_endpoint?: string;
}

let _discoveryCache: OidcDiscovery | null = null;
let _discoveryCacheTime = 0;
const DISCOVERY_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch OIDC discovery document from the issuer's well-known endpoint.
 * Results are cached for 5 minutes.
 */
export async function getDiscovery(issuerUrl: string): Promise<OidcDiscovery> {
  const now = Date.now();
  if (_discoveryCache && now - _discoveryCacheTime < DISCOVERY_TTL_MS) {
    return _discoveryCache;
  }

  const wellKnown = `${issuerUrl.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  log('Fetching OIDC discovery from %s', wellKnown);

  const res = await fetch(wellKnown, {
    headers: { Accept: 'application/json' },
    // Prevent caching at the HTTP layer in development
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(
      `OIDC discovery failed: ${res.status} ${res.statusText} from ${wellKnown}`,
    );
  }

  _discoveryCache = (await res.json()) as OidcDiscovery;
  _discoveryCacheTime = now;
  return _discoveryCache;
}

/**
 * Build the authorization URL that the browser will be redirected to.
 */
export async function buildAuthorizationUrl(
  state: string,
  nonce: string,
  redirectUri: string,
): Promise<string> {
  const cfg = getOidcConfig();
  const discovery = await getDiscovery(cfg.issuerUrl);

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    scope: cfg.scopes,
    redirect_uri: redirectUri,
    state,
    nonce,
  });

  return `${discovery.authorization_endpoint}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export interface OidcTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
}

/**
 * Exchange an authorization code for tokens.
 */
export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<OidcTokenResponse> {
  const cfg = getOidcConfig();
  const discovery = await getDiscovery(cfg.issuerUrl);

  log('Exchanging authorization code at %s', discovery.token_endpoint);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });

  const res = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return (await res.json()) as OidcTokenResponse;
}

// ---------------------------------------------------------------------------
// UserInfo
// ---------------------------------------------------------------------------

export interface OidcUserInfo {
  sub: string;
  email?: string;
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  groups?: string[];
  roles?: string[];
  [key: string]: unknown;
}

/**
 * Fetch user information from the OIDC userinfo endpoint.
 */
export async function getUserInfo(accessToken: string): Promise<OidcUserInfo> {
  const cfg = getOidcConfig();
  const discovery = await getDiscovery(cfg.issuerUrl);

  log('Fetching userinfo from %s', discovery.userinfo_endpoint);

  const res = await fetch(discovery.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`UserInfo request failed (${res.status}): ${text}`);
  }

  return (await res.json()) as OidcUserInfo;
}

// ---------------------------------------------------------------------------
// Simple JWT claims parsing (for id_token without full verification –
// verification is implicitly handled by the token exchange over HTTPS
// with the IdP, which is standard in confidential client OIDC flows)
// ---------------------------------------------------------------------------

export function parseIdTokenClaims(idToken: string): Record<string, unknown> {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT structure');
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  } catch (err) {
    log('Failed to parse id_token claims: %O', err);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Role mapping helpers
// ---------------------------------------------------------------------------

/**
 * Determine the Umami role for an OIDC user based on the configured
 * role claim and admin group mapping.
 *
 * Returns 'admin' if the user is in the admin group, otherwise 'user'.
 */
export function mapOidcRole(
  userInfo: OidcUserInfo,
  idTokenClaims: Record<string, unknown>,
): string {
  const cfg = getOidcConfig();
  const claimName = cfg.roleClaim;
  const adminGroup = cfg.adminGroup;

  // Look for the role claim in both userinfo and id_token claims
  const claimValue =
    (userInfo[claimName] as unknown) ?? (idTokenClaims[claimName] as unknown);

  if (!claimValue) {
    log('Role claim "%s" not found, defaulting to "user"', claimName);
    return 'user';
  }

  // Handle array claims (most common: groups)
  if (Array.isArray(claimValue)) {
    if (claimValue.includes(adminGroup)) {
      log('User is in admin group "%s"', adminGroup);
      return 'admin';
    }
    return 'user';
  }

  // Handle string claims
  if (typeof claimValue === 'string') {
    if (claimValue === adminGroup) {
      return 'admin';
    }
    // Comma-separated
    if (claimValue.split(',').map(s => s.trim()).includes(adminGroup)) {
      return 'admin';
    }
    return 'user';
  }

  log('Unexpected role claim type: %s', typeof claimValue);
  return 'user';
}

// ---------------------------------------------------------------------------
// CSRF / state token helpers
// ---------------------------------------------------------------------------

import { randomBytes, createHmac } from 'crypto';

/**
 * Generate a signed state parameter for the OIDC flow.
 * The state encodes a timestamp and nonce, signed with the app secret.
 */
export function generateState(appSecret: string): string {
  const nonce = randomBytes(16).toString('hex');
  const ts = Date.now().toString(36);
  const payload = `${ts}.${nonce}`;
  const sig = createHmac('sha256', appSecret).update(payload).digest('hex').slice(0, 16);
  return `${payload}.${sig}`;
}

/**
 * Verify the state parameter returned from the IdP.
 * Checks the HMAC signature and that the state is not older than maxAgeMs.
 */
export function verifyState(
  state: string,
  appSecret: string,
  maxAgeMs: number = 10 * 60 * 1000, // 10 minutes
): boolean {
  try {
    const parts = state.split('.');
    if (parts.length !== 3) return false;

    const [ts, nonce, sig] = parts;
    const payload = `${ts}.${nonce}`;
    const expectedSig = createHmac('sha256', appSecret)
      .update(payload)
      .digest('hex')
      .slice(0, 16);

    if (sig !== expectedSig) {
      log('State signature mismatch');
      return false;
    }

    // Check age
    const timestamp = parseInt(ts, 36);
    if (Date.now() - timestamp > maxAgeMs) {
      log('State expired (age: %dms)', Date.now() - timestamp);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a nonce value for the OIDC flow.
 */
export function generateNonce(): string {
  return randomBytes(16).toString('hex');
}
