import { useSyncExternalStore } from 'react';
import { secureStorage } from '../platform/secureStorage';

// Per-device session token from POST /client/auth/login|register, sent back as the
// x-client-key header on every request (see http.ts). The keychain is async-only, so a
// hydrated in-memory copy backs the synchronous getToken()/getUser() reads; hydrateAuth()
// is awaited once at boot. Ported from BM Pro's lib/auth.js (expo-secure-store → keychain).

const TOKEN_KEY = 'token';
const USER_KEY = 'user';

export type SessionUser = {
  user_id: number;
  email: string;
  display_name: string;
};

let tokenCache = '';
let userCache: SessionUser | null = null;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach(fn => fn());

export async function hydrateAuth() {
  try {
    const [token, userRaw] = await Promise.all([
      secureStorage.get(TOKEN_KEY),
      secureStorage.get(USER_KEY),
    ]);
    tokenCache = token || '';
    userCache = userRaw ? (JSON.parse(userRaw) as SessionUser) : null;
  } catch {
    tokenCache = '';
    userCache = null;
  }
  emit();
}

export const getToken = () => tokenCache;
export const getUser = () => userCache;
export const isSignedIn = () => Boolean(tokenCache);

export function setSession(s: {
  token: string;
  user_id: number;
  email: string;
  display_name?: string;
}) {
  tokenCache = s.token || '';
  userCache = {
    user_id: s.user_id,
    email: s.email,
    display_name: s.display_name || '',
  };
  secureStorage.set(TOKEN_KEY, tokenCache).catch(() => {});
  secureStorage.set(USER_KEY, JSON.stringify(userCache)).catch(() => {});
  emit();
}

export function clearSession() {
  tokenCache = '';
  userCache = null;
  secureStorage.remove(TOKEN_KEY).catch(() => {});
  secureStorage.remove(USER_KEY).catch(() => {});
  emit();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Runs `fn` whenever the session is set or cleared (lib/account.ts clears on sign-out). */
export const onSessionChange = subscribe;

export function useSignedIn() {
  return useSyncExternalStore(subscribe, isSignedIn, isSignedIn);
}

export function useSessionUser() {
  return useSyncExternalStore(subscribe, getUser, getUser);
}
