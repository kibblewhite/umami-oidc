/**
 * OIDC Complete Endpoint
 *
 * GET /api/auth/oidc/complete
 *
 * Serves an HTML interstitial page that:
 *   1. Reads the OIDC auth token from the `oidc_auth_token` cookie
 *   2. Stores it in localStorage as `umami.auth` (JSON.stringify'd to match
 *      Umami's native login format — the React app does JSON.parse when reading)
 *   3. Cleans up the temporary cookie
 *   4. Redirects to the dashboard
 *
 * Place this file at: src/app/api/auth/oidc/complete/route.ts
 */

import { NextResponse } from 'next/server';

export async function GET() {
  // Serve an HTML page that transfers the token from cookie → localStorage.
  // We use inline JS because localStorage is only available in the browser.
  const html = `<!DOCTYPE html>
<html>
<head><title>Completing login…</title></head>
<body>
<p>Completing login…</p>
<script>
(function() {
  try {
    // Read the oidc_auth_token cookie set by the callback endpoint
    var match = document.cookie.match(/(?:^|;\\s*)oidc_auth_token=([^;]*)/);
    var token = match ? decodeURIComponent(match[1]) : null;

    if (token) {
      // CRITICAL: Umami's React app reads localStorage with JSON.parse(),
      // so we must store the token wrapped in JSON.stringify() — i.e. as a
      // quoted string: '"<token>"'
      // Without this, JSON.parse('<raw-token>') throws SyntaxError and the
      // app sends "Authorization: Bearer null", causing 401 on /api/auth/verify.
      localStorage.setItem('umami.auth', JSON.stringify(token));

      // Clean up the temporary cookie
      document.cookie = 'oidc_auth_token=; path=/; max-age=0';

      console.log('[OIDC complete] Token stored in localStorage (length=' + token.length + ')');
    } else {
      console.error('[OIDC complete] No oidc_auth_token cookie found');
    }
  } catch (e) {
    console.error('[OIDC complete] Error:', e);
  }

  // Navigate to dashboard (full page load so React re-initialises)
  window.location.replace('/');
})();
</script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
