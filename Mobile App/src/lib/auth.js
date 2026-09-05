// Per-device session token, issued by POST /client/auth/login|register and
// sent back as the x-client-key header on every request (see lib/http.js).
// Stored in localStorage so a reload / PWA relaunch stays signed in — see
// the plan's risk note on XSS exposure; mitigated by the token being
// revocable (sign-out calls /client/auth/logout) and this app shipping no
// third-party scripts.
const TOKEN_KEY = 'bm.token';
const USER_KEY = 'bm.user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY)) || null;
  } catch {
    return null;
  }
}

export function setSession({ token, user_id, email, display_name }) {
  localStorage.setItem(TOKEN_KEY, token || '');
  localStorage.setItem(USER_KEY, JSON.stringify({ user_id, email, display_name: display_name || '' }));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isSignedIn() {
  return Boolean(getToken());
}
