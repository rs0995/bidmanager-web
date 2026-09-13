import * as SecureStore from "expo-secure-store";

// Per-device session token, issued by POST /client/auth/login|register and
// sent back as the x-client-key header on every request (see lib/http.js).
// SecureStore is async-only, so a hydrated in-memory mirror backs the
// synchronous getToken()/getUser() reads the rest of the app relies on
// (hydrateAuth() is awaited once at boot, see lib/bootstrap.js).
const TOKEN_KEY = "bm.token";
const USER_KEY = "bm.user";

let tokenCache = "";
let userCache = null;

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
}

export function clearSession() {
  tokenCache = "";
  userCache = null;
  SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  SecureStore.deleteItemAsync(USER_KEY).catch(() => {});
}

export function isSignedIn() {
  return Boolean(getToken());
}
