// Wipes locally-cached data (bookmarks/projects/documents/alerts/etc.) so the
// app rebuilds it from scratch — NOT a sign-out and NOT a cloud delete.
// bm.bookmarks/bm.bookmarkedOrgs/bm.projects/bm.checklist are the local half
// of the /client/sync blob (lib/sync.js): clearing them here just means the
// next sync (RequireAuth's mount effect, which always runs) re-pulls them
// from the server, which remains the source of truth. Everything else
// (documents, alerts, org-request/tender-snapshot state) is device-local
// only and simply resets.
const KEEP_KEYS = new Set([
  'bm.token',        // stay signed in
  'bm.user',
  'bm.settings',     // theme / app-lock / reminders preferences, not "cache"
  'bm.appLockCredentialId', // would otherwise silently break app lock
]);

export function clearLocalCache() {
  Object.keys(localStorage)
    .filter((key) => key.startsWith('bm.') && !KEEP_KEYS.has(key))
    .forEach((key) => localStorage.removeItem(key));
}
