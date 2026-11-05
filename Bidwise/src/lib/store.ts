import { useSyncExternalStore } from 'react';
import { readJSON, writeJSON } from './kv';

// Client-owned state that syncs: saved (starred) tender ids, bookmarked organisations,
// and the notification preferences and local settings. Ported from BM Pro's
// lib/store.js. Snapshots are replaced only on write, so useSyncExternalStore sees a
// stable value between changes.

const BOOKMARKS_KEY = 'bw.bookmarks';
const BOOKMARKED_ORGS_KEY = 'bw.bookmarkedOrgs';
const ORG_ID_BY_NAME_KEY = 'bw.orgIdByName';
const SETTINGS_KEY = 'bw.settings';

export const STORE_KEYS = [
  BOOKMARKS_KEY,
  BOOKMARKED_ORGS_KEY,
  ORG_ID_BY_NAME_KEY,
  SETTINGS_KEY,
];

export type Settings = {
  lastSyncAt: string | null;
  appLockEnabled: boolean;
  notifyOrgAlertsOn: boolean;
  notifyTenderAlertsOn: boolean;
  reminderDays: number[];
  /** In-app alert when someone else adds a project (this phone only; never pushed). */
  notifyProjectAlertsOn: boolean;
  /** When the user last changed a notification toggle (ms); 0 = never on this install. */
  notificationPrefsUpdatedAt: number;
};

const SETTINGS_DEFAULTS: Settings = {
  lastSyncAt: null,
  appLockEnabled: false,
  notifyOrgAlertsOn: false,
  notifyTenderAlertsOn: false,
  reminderDays: [],
  notifyProjectAlertsOn: true,
  notificationPrefsUpdatedAt: 0,
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach(fn => fn());

let bookmarks = new Set<number>();
let bookmarkedOrgs = new Set<string>();
let orgIdByName: Record<string, number> = {};
let settings: Settings = SETTINGS_DEFAULTS;

/** Re-reads every value after kv.ts has hydrated (boot, Clear local cache). */
export function rehydrateStore() {
  bookmarks = new Set(readJSON<number[]>(BOOKMARKS_KEY, []).map(Number));
  bookmarkedOrgs = new Set(readJSON<string[]>(BOOKMARKED_ORGS_KEY, []));
  orgIdByName = readJSON<Record<string, number>>(ORG_ID_BY_NAME_KEY, {});
  settings = {
    ...SETTINGS_DEFAULTS,
    ...readJSON<Partial<Settings>>(SETTINGS_KEY, {}),
  };
  emit();
}

export const getBookmarks = () => bookmarks;
export const getBookmarkedOrgs = () => bookmarkedOrgs;
export const getOrgIdByName = () => orgIdByName;
export const getSettings = () => settings;

/** Same members in any order. */
function sameSet<T>(a: Set<T>, b: Set<T>) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export function setBookmarks(ids: Iterable<number>) {
  const next = new Set([...ids].map(Number).filter(Number.isFinite));
  // A sync that changes nothing must not re-render every list row.
  if (sameSet(next, bookmarks)) return;
  bookmarks = next;
  writeJSON(BOOKMARKS_KEY, [...bookmarks]);
  emit();
}

/** Returns true when the tender is now saved. */
export function toggleBookmark(id: number | string): boolean {
  const key = Number(id);
  const next = new Set(bookmarks);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  bookmarks = next;
  writeJSON(BOOKMARKS_KEY, [...bookmarks]);
  emit();
  return bookmarks.has(key);
}

export function setBookmarkedOrgs(names: Iterable<string>) {
  const next = new Set(names);
  if (sameSet(next, bookmarkedOrgs)) return;
  bookmarkedOrgs = next;
  writeJSON(BOOKMARKED_ORGS_KEY, [...bookmarkedOrgs]);
  emit();
}

/** Returns true when the organisation is now bookmarked. */
export function toggleOrgBookmark(name: string): boolean {
  const next = new Set(bookmarkedOrgs);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  bookmarkedOrgs = next;
  writeJSON(BOOKMARKED_ORGS_KEY, [...bookmarkedOrgs]);
  emit();
  return bookmarkedOrgs.has(name);
}

/** Remembers organisation ids by name; the sync blob sends both. */
export function recordOrgIds(orgs: { id: number; name: string }[]) {
  let changed = false;
  const next = { ...orgIdByName };
  for (const o of orgs) {
    if (o?.name && Number.isFinite(o.id) && next[o.name] !== o.id) {
      next[o.name] = o.id;
      changed = true;
    }
  }
  if (changed) {
    orgIdByName = next;
    writeJSON(ORG_ID_BY_NAME_KEY, orgIdByName);
  }
}

export function setSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  writeJSON(SETTINGS_KEY, settings);
  emit();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const useBookmarkIds = () =>
  useSyncExternalStore(subscribe, getBookmarks, getBookmarks);
export const useBookmarkedOrgNames = () =>
  useSyncExternalStore(subscribe, getBookmarkedOrgs, getBookmarkedOrgs);
export const useSettings = () =>
  useSyncExternalStore(subscribe, getSettings, getSettings);
