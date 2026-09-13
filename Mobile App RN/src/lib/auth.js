import { useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";

// Per-device session token, issued by POST /client/auth/login|register and
// sent back as the x-client-key header on every request (see lib/http.js).
// SecureStore is async-only, so a hydrated in-memory mirror backs the
// synchronous getToken()/getUser() reads the rest of the app relies on
// (hydrateAuth() is awaited once at boot, see lib/bootstrap.js).
//
// useSignedIn() lets src/app/_layout.tsx react to setSession()/clearSession()
// calls made elsewhere (SignInScreen, an AuthError from queryClient.js) --
// without this, isSignedIn() changing would not by itself re-render the
// gate that decides between the sign-in stack and the tab/stack app.
const TOKEN_KEY = "bm.token";
const USER_KEY = "bm.user";

let tokenCache = "";
let userCache = null;

const listeners = new Set();
function emit() {
  listeners.forEach((fn) => fn());
}

export async function hydrateAuth() {
  const [token, userRaw] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY),
    SecureStore.getItemAsync(USER_KEY),
  ]);
  tokenCache = token || "";
  try {
    userCache = userRaw ? JSON.parse(userRaw) : null;
  } catch {
    userCache = null;
  }
}

export function getToken() {
  return tokenCache;
}

export function getUser() {
  return userCache;
}

export function setSession({ token, user_id, email, display_name }) {
  tokenCache = token || "";
  userCache = { user_id, email, display_name: display_name || "" };
  SecureStore.setItemAsync(TOKEN_KEY, tokenCache).catch(() => {});
  SecureStore.setItemAsync(USER_KEY, JSON.stringify(userCache)).catch(() => {});
  emit();
}

export function clearSession() {
  tokenCache = "";
  userCache = null;
  SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  SecureStore.deleteItemAsync(USER_KEY).catch(() => {});
  emit();
}

export function isSignedIn() {
  return Boolean(getToken());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSignedIn() {
  return useSyncExternalStore(subscribe, isSignedIn, isSignedIn);
}
