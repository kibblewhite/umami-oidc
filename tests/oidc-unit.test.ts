/**
 * OIDC Module Unit Tests
 *
 * Tests all pure functions from the OIDC module that do NOT require
 * a running database, identity provider, or network access.
 *
 * Covers: config parsing, state/nonce generation & verification,
 *         JWT claim parsing, role mapping, and config validation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// We test the pure functions by importing them. Some require 'debug' to be
// available, so we provide a stub via vitest mock.
// ============================================================================

vi.mock('debug', () => ({
  default: () => () => {},  // debug('name') returns a no-op logger
}));

import {
  getOidcConfig,
  isOidcEnabled,
  validateOidcConfig,
  generateState,
  verifyState,
  generateNonce,
  parseIdTokenClaims,
  mapOidcRole,
  type OidcConfig,
  type OidcUserInfo,
} from '../src/lib/oidc';

// ============================================================================
// Helpers
// ============================================================================

const TEST_SECRET = 'super-secret-test-key-for-umami-oidc';

/** Build a minimal fake JWT with the given payload */
function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = Buffer.from('fake-signature').toString('base64url');
  return `${header}.${body}.${sig}`;
}

// ============================================================================
// Tests
// ============================================================================

describe('OIDC Configuration', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getOidcConfig()', () => {
    it('returns defaults when no env vars are set', () => {
      delete process.env.OIDC_ENABLED;
      delete process.env.OIDC_CLIENT_ID;
      delete process.env.OIDC_CLIENT_SECRET;
      delete process.env.OIDC_ISSUER_URL;
      delete process.env.OIDC_SCOPES;
      delete process.env.OIDC_REDIRECT_URI;
      delete process.env.OIDC_ROLE_CLAIM;
      delete process.env.OIDC_ADMIN_GROUP;
      delete process.env.OIDC_AUTO_CREATE;
      delete process.env.OIDC_DISPLAY_NAME;

      const cfg = getOidcConfig();

      expect(cfg.enabled).toBe(false);
      expect(cfg.clientId).toBe('');
      expect(cfg.clientSecret).toBe('');
      expect(cfg.issuerUrl).toBe('');
      expect(cfg.scopes).toBe('openid profile email');
      expect(cfg.redirectUri).toBe('');
      expect(cfg.roleClaim).toBe('groups');
      expect(cfg.adminGroup).toBe('umami-admin');
      expect(cfg.autoCreate).toBe(true);
      expect(cfg.displayName).toBe('Single Sign-On');
    });

    it('reads all env vars correctly', () => {
      process.env.OIDC_ENABLED = 'true';
      process.env.OIDC_CLIENT_ID = 'my-client';
      process.env.OIDC_CLIENT_SECRET = 'my-secret';
      process.env.OIDC_ISSUER_URL = 'https://auth.example.com/realms/main';
      process.env.OIDC_SCOPES = 'openid profile email groups';
      process.env.OIDC_REDIRECT_URI = 'https://umami.example.com/api/auth/oidc/callback';
      process.env.OIDC_ROLE_CLAIM = 'roles';
      process.env.OIDC_ADMIN_GROUP = 'admin-group';
      process.env.OIDC_AUTO_CREATE = 'false';
      process.env.OIDC_DISPLAY_NAME = 'Keycloak';

      const cfg = getOidcConfig();

      expect(cfg.enabled).toBe(true);
      expect(cfg.clientId).toBe('my-client');
      expect(cfg.clientSecret).toBe('my-secret');
      expect(cfg.issuerUrl).toBe('https://auth.example.com/realms/main');
      expect(cfg.scopes).toBe('openid profile email groups');
      expect(cfg.redirectUri).toBe('https://umami.example.com/api/auth/oidc/callback');
      expect(cfg.roleClaim).toBe('roles');
      expect(cfg.adminGroup).toBe('admin-group');
      expect(cfg.autoCreate).toBe(false);
      expect(cfg.displayName).toBe('Keycloak');
    });

    it('treats OIDC_ENABLED="1" as enabled', () => {
      process.env.OIDC_ENABLED = '1';
      expect(getOidcConfig().enabled).toBe(true);
    });

    it('treats OIDC_ENABLED="false" as disabled', () => {
      process.env.OIDC_ENABLED = 'false';
      expect(getOidcConfig().enabled).toBe(false);
    });

    it('treats OIDC_ENABLED="yes" as disabled (strict check)', () => {
      process.env.OIDC_ENABLED = 'yes';
      expect(getOidcConfig().enabled).toBe(false);
    });
  });

  describe('isOidcEnabled()', () => {
    it('returns false when OIDC_ENABLED is not set', () => {
      delete process.env.OIDC_ENABLED;
      expect(isOidcEnabled()).toBe(false);
    });

    it('returns true when OIDC_ENABLED=true', () => {
      process.env.OIDC_ENABLED = 'true';
      expect(isOidcEnabled()).toBe(true);
    });
  });

  describe('validateOidcConfig()', () => {
    it('returns null for disabled config (no validation needed)', () => {
      const cfg: OidcConfig = {
        enabled: false, clientId: '', clientSecret: '', issuerUrl: '',
        scopes: '', redirectUri: '', roleClaim: '', adminGroup: '',
        autoCreate: true, displayName: '',
      };
      expect(validateOidcConfig(cfg)).toBeNull();
    });

    it('returns error when clientId is missing', () => {
      const cfg: OidcConfig = {
        enabled: true, clientId: '', clientSecret: 'secret', issuerUrl: 'https://auth',
        scopes: '', redirectUri: '', roleClaim: '', adminGroup: '',
        autoCreate: true, displayName: '',
      };
      expect(validateOidcConfig(cfg)).toContain('OIDC_CLIENT_ID');
    });

    it('returns error when clientSecret is missing', () => {
      const cfg: OidcConfig = {
        enabled: true, clientId: 'id', clientSecret: '', issuerUrl: 'https://auth',
        scopes: '', redirectUri: '', roleClaim: '', adminGroup: '',
        autoCreate: true, displayName: '',
      };
      expect(validateOidcConfig(cfg)).toContain('OIDC_CLIENT_SECRET');
    });

    it('returns error when issuerUrl is missing', () => {
      const cfg: OidcConfig = {
        enabled: true, clientId: 'id', clientSecret: 'secret', issuerUrl: '',
        scopes: '', redirectUri: '', roleClaim: '', adminGroup: '',
        autoCreate: true, displayName: '',
      };
      expect(validateOidcConfig(cfg)).toContain('OIDC_ISSUER_URL');
    });

    it('returns null when all required fields are present', () => {
      const cfg: OidcConfig = {
        enabled: true, clientId: 'id', clientSecret: 'secret',
        issuerUrl: 'https://auth.example.com',
        scopes: 'openid', redirectUri: '', roleClaim: 'groups',
        adminGroup: 'admin', autoCreate: true, displayName: 'SSO',
      };
      expect(validateOidcConfig(cfg)).toBeNull();
    });
  });
});

describe('CSRF State Management', () => {

  describe('generateState()', () => {
    it('returns a string with three dot-separated parts', () => {
      const state = generateState(TEST_SECRET);
      const parts = state.split('.');
      expect(parts).toHaveLength(3);
    });

    it('generates unique states on each call', () => {
      const s1 = generateState(TEST_SECRET);
      const s2 = generateState(TEST_SECRET);
      expect(s1).not.toBe(s2);
    });

    it('contains a base36 timestamp as first part', () => {
      const state = generateState(TEST_SECRET);
      const ts = state.split('.')[0];
      const decoded = parseInt(ts, 36);
      // Should be within 5 seconds of now
      expect(Math.abs(Date.now() - decoded)).toBeLessThan(5000);
    });
  });

  describe('verifyState()', () => {
    it('verifies a freshly generated state', () => {
      const state = generateState(TEST_SECRET);
      expect(verifyState(state, TEST_SECRET)).toBe(true);
    });

    it('rejects state signed with a different secret', () => {
      const state = generateState(TEST_SECRET);
      expect(verifyState(state, 'wrong-secret')).toBe(false);
    });

    it('rejects malformed state (too few parts)', () => {
      expect(verifyState('just-one-part', TEST_SECRET)).toBe(false);
      expect(verifyState('two.parts', TEST_SECRET)).toBe(false);
    });

    it('rejects tampered state (modified nonce)', () => {
      const state = generateState(TEST_SECRET);
      const [ts, , sig] = state.split('.');
      const tampered = `${ts}.aaaaaaaaaaaaaaaa.${sig}`;
      expect(verifyState(tampered, TEST_SECRET)).toBe(false);
    });

    it('rejects expired state', () => {
      const state = generateState(TEST_SECRET);
      // Verify with -1ms max age — guarantees the state is always expired
      // (using 0 is flaky because generation + verification can happen
      //  within the same millisecond, making Date.now() - timestamp === 0
      //  which does NOT satisfy the > 0 check)
      expect(verifyState(state, TEST_SECRET, -1)).toBe(false);
    });

    it('accepts state within custom max age', () => {
      const state = generateState(TEST_SECRET);
      // 30 seconds should be plenty
      expect(verifyState(state, TEST_SECRET, 30_000)).toBe(true);
    });
  });

  describe('generateNonce()', () => {
    it('returns a 32-character hex string', () => {
      const nonce = generateNonce();
      expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    });

    it('generates unique nonces', () => {
      const n1 = generateNonce();
      const n2 = generateNonce();
      expect(n1).not.toBe(n2);
    });
  });
});

describe('JWT Claim Parsing', () => {

  describe('parseIdTokenClaims()', () => {
    it('decodes a valid JWT payload', () => {
      const token = fakeJwt({
        sub: 'user-123',
        email: 'alice@example.com',
        nonce: 'test-nonce',
        groups: ['admin', 'users'],
      });

      const claims = parseIdTokenClaims(token);

      expect(claims.sub).toBe('user-123');
      expect(claims.email).toBe('alice@example.com');
      expect(claims.nonce).toBe('test-nonce');
      expect(claims.groups).toEqual(['admin', 'users']);
    });

    it('returns empty object for invalid JWT (not 3 parts)', () => {
      expect(parseIdTokenClaims('not-a-jwt')).toEqual({});
      expect(parseIdTokenClaims('only.two')).toEqual({});
    });

    it('returns empty object for corrupt base64 payload', () => {
      expect(parseIdTokenClaims('header.!!!invalid!!!.sig')).toEqual({});
    });

    it('handles JWT with empty payload', () => {
      const token = fakeJwt({});
      expect(parseIdTokenClaims(token)).toEqual({});
    });

    it('handles JWT with nested objects', () => {
      const token = fakeJwt({
        realm_access: { roles: ['admin', 'user'] },
      });
      const claims = parseIdTokenClaims(token);
      expect(claims.realm_access).toEqual({ roles: ['admin', 'user'] });
    });
  });
});

describe('Role Mapping', () => {

  const baseUserInfo: OidcUserInfo = {
    sub: 'user-123',
    email: 'alice@example.com',
    preferred_username: 'alice',
  };

  beforeEach(() => {
    // Set defaults
    process.env.OIDC_ROLE_CLAIM = 'groups';
    process.env.OIDC_ADMIN_GROUP = 'umami-admin';
  });

  afterEach(() => {
    delete process.env.OIDC_ROLE_CLAIM;
    delete process.env.OIDC_ADMIN_GROUP;
  });

  describe('mapOidcRole()', () => {
    it('returns "user" when no role claim is present', () => {
      const role = mapOidcRole(baseUserInfo, {});
      expect(role).toBe('user');
    });

    it('returns "admin" when groups array contains admin group', () => {
      const userInfo: OidcUserInfo = {
        ...baseUserInfo,
        groups: ['users', 'umami-admin'],
      };
      expect(mapOidcRole(userInfo, {})).toBe('admin');
    });

    it('returns "user" when groups array does NOT contain admin group', () => {
      const userInfo: OidcUserInfo = {
        ...baseUserInfo,
        groups: ['users', 'readers'],
      };
      expect(mapOidcRole(userInfo, {})).toBe('user');
    });

    it('checks id_token claims if userinfo lacks the claim', () => {
      const idClaims = { groups: ['umami-admin'] };
      expect(mapOidcRole(baseUserInfo, idClaims)).toBe('admin');
    });

    it('handles string claim (exact match)', () => {
      process.env.OIDC_ROLE_CLAIM = 'role';
      const userInfo: OidcUserInfo = {
        ...baseUserInfo,
        role: 'umami-admin',
      } as any;
      expect(mapOidcRole(userInfo, {})).toBe('admin');
    });

    it('handles comma-separated string claim', () => {
      process.env.OIDC_ROLE_CLAIM = 'role';
      const userInfo: OidcUserInfo = {
        ...baseUserInfo,
        role: 'viewer, umami-admin, editor',
      } as any;
      expect(mapOidcRole(userInfo, {})).toBe('admin');
    });

    it('returns "user" for comma-separated string without admin group', () => {
      process.env.OIDC_ROLE_CLAIM = 'role';
      const userInfo: OidcUserInfo = {
        ...baseUserInfo,
        role: 'viewer, editor',
      } as any;
      expect(mapOidcRole(userInfo, {})).toBe('user');
    });

    it('respects custom OIDC_ROLE_CLAIM and OIDC_ADMIN_GROUP', () => {
      process.env.OIDC_ROLE_CLAIM = 'roles';
      process.env.OIDC_ADMIN_GROUP = 'UmamiAdmin';

      const userInfo: OidcUserInfo = {
        ...baseUserInfo,
        roles: ['BasicUser', 'UmamiAdmin'],
      } as any;
      expect(mapOidcRole(userInfo, {})).toBe('admin');
    });

    it('Keycloak-style: /umami-admin group path', () => {
      process.env.OIDC_ADMIN_GROUP = '/umami-admin';
      const userInfo: OidcUserInfo = {
        ...baseUserInfo,
        groups: ['/users', '/umami-admin'],
      };
      expect(mapOidcRole(userInfo, {})).toBe('admin');
    });

    it('returns "user" for non-string/non-array claim types', () => {
      process.env.OIDC_ROLE_CLAIM = 'custom';
      const userInfo: OidcUserInfo = {
        ...baseUserInfo,
        custom: 42,
      } as any;
      expect(mapOidcRole(userInfo, {})).toBe('user');
    });
  });
});
