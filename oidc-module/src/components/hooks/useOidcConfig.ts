/**
 * useOidcConfig hook
 *
 * Fetches the public OIDC configuration from the server to determine
 * whether to render the SSO login button.
 *
 * Place this file at: src/components/hooks/useOidcConfig.ts
 */

'use client';

import { useEffect, useState } from 'react';

interface OidcClientConfig {
  enabled: boolean;
  displayName: string;
  authorizeUrl: string | null;
}

const DEFAULT_CONFIG: OidcClientConfig = {
  enabled: false,
  displayName: 'Single Sign-On',
  authorizeUrl: null,
};

export function useOidcConfig(): OidcClientConfig {
  const [config, setConfig] = useState<OidcClientConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/auth/oidc/config')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch OIDC config');
        return res.json();
      })
      .then(data => {
        if (!cancelled) {
          setConfig(data);
        }
      })
      .catch(() => {
        // OIDC not available, keep defaults (button hidden)
        if (!cancelled) {
          setConfig(DEFAULT_CONFIG);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}
