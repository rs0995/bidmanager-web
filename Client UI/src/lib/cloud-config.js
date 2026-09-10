// Single source of truth for the backend URL baked into the app.
// - Production builds substitute VITE_API_BASE_URL from Client UI/.env.production.
// - Dev builds (and any build without that env var) fall back to the literal.
// Both currently resolve to the same OCI VM host. Imported by api.js and db.js
// so a fresh install can reach the server before the user ever opens Settings.
export const DEFAULT_SERVER_URL = String(
  import.meta.env.VITE_API_BASE_URL || 'https://161.118.170.233.sslip.io',
).trim().replace(/\/+$/, '');
