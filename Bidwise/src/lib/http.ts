import { getToken } from './auth';

// One backend, as in BM Pro. React Native has no same-origin proxy, so every request
// is an absolute URL. Kept in one place for when the OCI host name changes.
export const BACKEND_URL = 'https://161.118.170.233.sslip.io';

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** false for sign-in / register, which run before there is a token. */
  auth?: boolean;
  /** Session key to use instead of the current one (sign-out clean-up after it is cleared). */
  key?: string;
};

type ErrorDetail =
  | string
  | { message?: string; reason?: string }
  | { msg?: string; type?: string }[];

export function errorMessage(detail: ErrorDetail | undefined, status: number) {
  if (Array.isArray(detail)) return detail.map(d => d.msg || d.type).join('; ');
  if (detail && typeof detail === 'object' && detail.message)
    return detail.message;
  if (typeof detail === 'string' && detail) return detail;
  return `Request failed (HTTP ${status}).`;
}

export async function request<T = unknown>(
  route: string,
  { method = 'GET', body, auth = true, key }: Options = {},
): Promise<T> {
  if (!String(route).startsWith('/client/')) {
    throw new Error('Only /client/* API routes are allowed.');
  }
  const token = key ?? getToken();
  if (auth && !token) throw new AuthError('Sign in to continue.');

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers['x-client-key'] = token;
  const init: RequestInit = { method, headers };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }

  const response = await fetch(`${BACKEND_URL}${route}`, init);
  const payload = (await response.json().catch(() => null)) as {
    detail?: ErrorDetail;
  } | null;
  if (!response.ok) {
    const message = errorMessage(payload?.detail, response.status);
    // Signed out: no or expired session (401), or a suspended account. Any other 403
    // is a refusal (a section the organisation turned off, an admin-only action) and
    // must not end the session.
    const reason =
      payload?.detail && !Array.isArray(payload.detail)
        ? (payload.detail as { reason?: string }).reason
        : undefined;
    if (
      response.status === 401 ||
      (response.status === 403 && reason === 'suspended')
    )
      throw new AuthError(message);
    throw new Error(message);
  }
  return payload as T;
}
