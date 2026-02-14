/**
 * OidcLoginButton component
 *
 * Renders an SSO login button on the Umami login page when OIDC is enabled.
 * Fetches the OIDC config from the server and redirects the user to the
 * authorization endpoint when clicked.
 *
 * Place this file at: src/app/login/OidcLoginButton.tsx
 *
 * Then import and add to LoginForm.tsx (see the LoginForm patch below).
 */

'use client';

import { useOidcConfig } from '@/components/hooks/useOidcConfig';

export function OidcLoginButton() {
  const oidcConfig = useOidcConfig();

  if (!oidcConfig.enabled || !oidcConfig.authorizeUrl) {
    return null;
  }

  const handleClick = () => {
    window.location.href = oidcConfig.authorizeUrl!;
  };

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          margin: '16px 0',
          width: '100%',
        }}
      >
        <div style={{ flex: 1, borderTop: '1px solid var(--base400)' }} />
        <span style={{ color: 'var(--base600)', fontSize: '13px' }}>or</span>
        <div style={{ flex: 1, borderTop: '1px solid var(--base400)' }} />
      </div>

      <button
        type="button"
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          width: '100%',
          padding: '10px 16px',
          fontSize: '14px',
          fontWeight: 500,
          color: 'var(--base900)',
          backgroundColor: 'var(--base75)',
          border: '1px solid var(--base400)',
          borderRadius: '4px',
          cursor: 'pointer',
          transition: 'background-color 0.2s',
        }}
        onMouseEnter={e => {
          (e.target as HTMLElement).style.backgroundColor = 'var(--base100)';
        }}
        onMouseLeave={e => {
          (e.target as HTMLElement).style.backgroundColor = 'var(--base75)';
        }}
      >
        {/* Shield/SSO icon */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        Sign in with {oidcConfig.displayName}
      </button>
    </>
  );
}
