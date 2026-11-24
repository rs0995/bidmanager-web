import { getToken } from "./auth.js";

// One backend, hardcoded, same as the web Mobile App. Unlike the web app
// (which calls RELATIVE /client/* paths through a same-origin dev/prod
// proxy), React Native has no such proxy, so every request is built as an
// ABSOLUTE URL against BACKEND_URL.
export const BACKEND_URL = "https://161.118.170.233.sslip.io";

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthError";
  }
}

export async function request(route, { method = "GET", body, auth = true } = {}) {
  if (!String(route).startsWith("/client/")) {
    throw new Error("Only /client/* API routes are allowed.");
  }
  const token = getToken();
  if (auth && !token) throw new AuthError("Sign in to continue.");

  const headers = { Accept: "application/json" };
  if (token) headers["x-client-key"] = token;
  const options = { method, headers };
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body ?? {});
  }

  const response = await fetch(`${BACKEND_URL}${route}`, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.detail;
    const message = Array.isArray(detail)
      ? detail.map((d) => d.msg || d.type).join("; ")
      : (detail && typeof detail === "object" ? detail.message : detail)
        || `Request failed (HTTP ${response.status}).`;
    if (response.status === 401 || response.status === 403) throw new AuthError(message);
    throw new Error(message);
  }
  return payload;
}
