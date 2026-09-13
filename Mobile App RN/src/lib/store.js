import { useSyncExternalStore } from "react";
import { getRaw, setRaw } from "./kv.js";

// AsyncStorage-backed store (via kv.js in-memory mirror) for the only bits
// of client-owned state the mobile app needs: the bookmarked tender-id set,
// and a couple of local settings (theme, last-sync time, app-lock).
// Everything else (tenders, stats, documents) is fetched live and cached by
// React Query.
//
// getSnapshot passed to useSyncExternalStore MUST return a referentially
// stable value when nothing changed, or React treats every render as a
// store change and infinite-loops. So bookmarks/settings are cached at
// module scope and only replaced (a new Set/object) when a write happens.
const BOOKMARKS_KEY = "bm.bookmarks";
const BOOKMARKED_ORGS_KEY = "bm.bookmarkedOrgs";
const ORG_ID_BY_NAME_KEY = "bm.orgIdByName";
const SETTINGS_KEY = "bm.settings";

const listeners = new Set();
function emit() {
  listeners.forEach((fn) => fn());
}

function readJSON(key, fallback) {
  try {
    const raw = getRaw(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key, value) {
  setRaw(key, JSON.stringify(value));
}

const SETTINGS_DEFAULTS = { theme: "dark", lastSyncAt: null, appLockEnabled: false, deadlineRemindersOn: false };

let bookmarksCache = new Set(readJSON(BOOKMARKS_KEY, []).map(Number));
let bookmarkedOrgsCache = new Set(readJSON(BOOKMARKED_ORGS_KEY, []));
let settingsCache = { ...SETTINGS_DEFAULTS, ...readJSON(SETTINGS_KEY, {}) };
let orgIdByNameCache = readJSON(ORG_ID_BY_NAME_KEY, {});

// Called once after lib/kv.js hydrateKV() resolves (see lib/bootstrap.js) to
// re-read the now-populated mirror and notify subscribers.
export function rehydrateStore() {
  bookmarksCache = new Set(readJSON(BOOKMARKS_KEY, []).map(Number));
  bookmarkedOrgsCache = new Set(readJSON(BOOKMARKED_ORGS_KEY, []));
  settingsCache = { ...SETTINGS_DEFAULTS, ...readJSON(SETTINGS_KEY, {}) };
  orgIdByNameCache = readJSON(ORG_ID_BY_NAME_KEY, {});
  emit();
}

export function getBookmarks() {
  return bookmarksCache;
}

export function isBookmarked(id) {
  return bookmarksCache.has(Number(id));
}

export function setBookmarks(ids) {
  bookmarksCache = new Set([...ids].map(Number));
  writeJSON(BOOKMARKS_KEY, [...bookmarksCache]);
  emit();
}

export function toggleBookmark(id) {
  const key = Number(id);
  const next = new Set(bookmarksCache);
  if (next.has(key)) next.delete(key); else next.add(key);
  bookmarksCache = next;
  writeJSON(BOOKMARKS_KEY, [...bookmarksCache]);
  emit();
  return bookmarksCache.has(key);
}

export function getBookmarkedOrgs() {
  return bookmarkedOrgsCache;
}

export function isOrgBookmarked(name) {
  return bookmarkedOrgsCache.has(name);
}

export function setBookmarkedOrgs(names) {
  bookmarkedOrgsCache = new Set(names);
  writeJSON(BOOKMARKED_ORGS_KEY, [...bookmarkedOrgsCache]);
  emit();
}

export function toggleOrgBookmark(name) {
  const next = new Set(bookmarkedOrgsCache);
  if (next.has(name)) next.delete(name); else next.add(name);
  bookmarkedOrgsCache = next;
  writeJSON(BOOKMARKED_ORGS_KEY, [...bookmarkedOrgsCache]);
  emit();
  return bookmarkedOrgsCache.has(name);
}

export function recordOrgIds(orgs) {
  let changed = false;
  for (const org of orgs || []) {
    const id = Number(org?.id);
    const name = org?.name;
    if (name && Number.isFinite(id) && orgIdByNameCache[name] !== id) {
      orgIdByNameCache[name] = id;
      changed = true;
    }
  }
  if (changed) writeJSON(ORG_ID_BY_NAME_KEY, orgIdByNameCache);
}

export function getOrgIdByName() {
  return orgIdByNameCache;
}

export function getSettings() {
  return settingsCache;
}

export function setSettings(patch) {
  settingsCache = { ...settingsCache, ...patch };
  writeJSON(SETTINGS_KEY, settingsCache);
  emit();
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useBookmarks() {
  return useSyncExternalStore(subscribe, getBookmarks, getBookmarks);
}

export function useBookmarkedOrgs() {
  return useSyncExternalStore(subscribe, getBookmarkedOrgs, getBookmarkedOrgs);
}

export function useSettings() {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}
