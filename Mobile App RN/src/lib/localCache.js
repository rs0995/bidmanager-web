import { getAllKeysRaw, removeRaw } from "./kv.js";

// Wipes locally-cached data (bookmarks/projects/documents/alerts/etc.) so the
// app rebuilds it from scratch. NOT a sign-out and NOT a cloud delete.
// bm.bookmarks/bm.bookmarkedOrgs/bm.projects/bm.checklist are the local half
// of the /client/sync blob (lib/sync.js): clearing them here just means the
// next sync re-pulls them from the server, which remains the source of
// truth. Everything else (documents, alerts, org-request/tender-snapshot
// state) is device-local only and simply resets. Session token/user live in
// expo-secure-store (auth.js), not this kv mirror, so they are untouched by
// definition.
const KEEP_KEYS = new Set([
  "bm.settings", // theme / app-lock / reminders preferences, not "cache"
]);

export function clearLocalCache() {
  getAllKeysRaw()
    .filter((key) => key.startsWith("bm.") && !KEEP_KEYS.has(key))
    .forEach((key) => removeRaw(key));
}
