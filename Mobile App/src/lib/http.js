import { getToken } from './auth.js';

// One backend, hardcoded — no user-facing "Server URL" setting. Requests are
// always made to a RELATIVE /client/* path: in dev, vite.config.js's proxy
// forwards them to this same host; in a same-origin production deploy the
// reverse proxy in front of the app forwards them too. BACKEND_URL exists
// only as the single source of truth for that proxy target (see
// vite.config.js and README.md) — application code never fetches it directly.
export const BACKEND_URL = 'https://161.118.170.233.sslip.io';

// A rejected/expired/revoked token surfaces as 401/403 from any /client/*
// call. queryClient.js catches this by name and forces a sign-out + redirect
// to /signin, mirroring Client UI/src/main.jsx's handleAuthError.
export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

export async function request(route, { method = 'GET', body, auth = true } = {}) {
  if (!String(route).startsWith('/client/')) {
    throw new Error('Only /client/* API routes are allowed.');
  }
  const token = getToken();
  if (auth && !token) throw new AuthError('Sign in to continue.');

  const headers = { Accept: 'application/json' };
  if (token) headers['x-client-key'] = token;
  const options = { method, headers };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body ?? {});
  }

  const response = await fetch(route, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.detail;
    const message = Array.isArray(detail)
      ? detail.map((d) => d.msg || d.type).join('; ')
      : (detail && typeof detail === 'object' ? detail.message : detail)
        || `Request failed (HTTP ${response.status}).`;
    if (response.status === 401 || response.status === 403) throw new AuthError(message);
    throw new Error(message);
  }
  return payload;
}
