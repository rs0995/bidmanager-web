import { useSyncExternalStore } from 'react';

// Tiny localStorage-backed store for the only bits of client-owned state the
// mobile app needs: the bookmarked tender-id set, and a couple of local
// settings (theme, last-sync time, app-lock). Everything else (tenders,
// stats, documents) is fetched live and cached by React Query — there's no
// reason to carry an IndexedDB local-first cache like the desktop Client UI
// does. There is deliberately no "server URL" setting — the backend is
// hardcoded (see lib/http.js).
//
// getSnapshot passed to useSyncExternalStore MUST return a referentially
// stable value when nothing changed, or React treats every render as a
// store change and infinite-loops. So bookmarks/settings are cached at
// module scope and only replaced (a new Set/object) when a write happens.
const BOOKMARKS_KEY = 'bm.bookmarks';
const BOOKMARKED_ORGS_KEY = 'bm.bookmarkedOrgs';
const SETTINGS_KEY = 'bm.settings';

const listeners = new Set();
function emit() {
  listeners.forEach((fn) => fn());
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

const SETTINGS_DEFAULTS = { theme: 'dark', lastSyncAt: null, appLockEnabled: false, deadlineRemindersOn: false };

let bookmarksCache = new Set(readJSON(BOOKMARKS_KEY, []).map(Number));
let bookmarkedOrgsCache = new Set(readJSON(BOOKMARKED_ORGS_KEY, []));
let settingsCache = { ...SETTINGS_DEFAULTS, ...readJSON(SETTINGS_KEY, {}) };

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

// Bookmarked organizations — keyed by org NAME (a string), matching the
// desktop Client UI's /client/sync field `bookmarkedOrgs` exactly (see
// Client UI/src/lib/api.js pushUserData/pullUserData), so the two are
// interchangeable across devices for the same account.
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
  // Another tab/window changed localStorage directly — refresh our caches
  // from disk before notifying, since a bare 'storage' event carries no
  // React-visible snapshot change on its own.
  const onStorage = (e) => {
    if (e.key === BOOKMARKS_KEY) bookmarksCache = new Set(readJSON(BOOKMARKS_KEY, []).map(Number));
    if (e.key === BOOKMARKED_ORGS_KEY) bookmarkedOrgsCache = new Set(readJSON(BOOKMARKED_ORGS_KEY, []));
    if (e.key === SETTINGS_KEY) settingsCache = { ...SETTINGS_DEFAULTS, ...readJSON(SETTINGS_KEY, {}) };
    fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
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
