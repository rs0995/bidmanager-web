import { useSyncExternalStore } from "react";
import { getRaw, setRaw } from "./kv.js";
import { getSettings, isBookmarked, isOrgBookmarked } from "./store.js";
import { notifyAlert, setBadgeCount } from "./notifications.js";
import { api } from "./api.js";
import { canonTenderId } from "./tenderKey.js";

// Tells the server the device's real unread count so api_server.py's push
// pass (which otherwise just increments its own counter by 1 per push) has
// an accurate baseline to climb from, instead of drifting upward forever
// once something here has actually been read. Best-effort, same as
// setBadgeCount itself -- a failed sync just means the next push's badge
// number is off by a bit until the next successful one.
function syncBadgeToServer(count) {
  api.syncBadge(count).catch(() => {});
}

// Locally-derived alert feed (no server push infrastructure in scope).
// Entries are appended by real local events: a sync pass noticing a
// bookmarked/project tender closing-date change or new tenders appearing
// (see sync.js), a checklist reaching 100% (see projects.js), and a
// periodic local closing-date reminder check (see closingReminders.js).
const ALERTS_KEY = "bm.alerts";
const MAX_ALERTS = 100;

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

let alertsCache = readJSON(ALERTS_KEY, []);
let nextId = 1 + alertsCache.reduce((m, a) => Math.max(m, a.id), 0);

export function rehydrateAlerts() {
  alertsCache = readJSON(ALERTS_KEY, []);
  nextId = 1 + alertsCache.reduce((m, a) => Math.max(m, a.id), 0);
  emit();
  setBadgeCount(unreadCount());
  syncBadgeToServer(unreadCount());
}

export function getAlerts() {
  return alertsCache;
}

export function getAlert(id) {
  return alertsCache.find((a) => a.id === Number(id)) || null;
}

// A bulk "N new tenders added under <org>" alert carries the tender ids the
// server reported as new, so the alert can open a screen showing exactly
// those tenders (there is no server filter for "tenders first seen after X").
// Capped so a huge first sync can't bloat the persisted alert list.
const MAX_NEW_TENDER_IDS = 300;

// tenderKey / newTenderKeys are canonical portal tender ids (lib/tenderKey.js)
// and are what an alert opens by. tenderId is the row id at the time, kept
// only as a hint; alerts saved by older builds carry just tenderId /
// newTenderIds (row ids) and still open through those.
export function addAlert({ kind, message, tenderId, tenderKey, orgName, newTenderKeys }) {
  const entry = {
    id: nextId++, kind, message, at: new Date().toISOString(), read: false,
    tenderId: tenderId ?? null, tenderKey: canonTenderId(tenderKey) || null, orgName: orgName ?? null,
  };
  const keys = (newTenderKeys || []).map(canonTenderId).filter(Boolean);
  if (keys.length > 0) {
    entry.newTenderKeys = keys.slice(0, MAX_NEW_TENDER_IDS);
  }
  alertsCache = [entry, ...alertsCache].slice(0, MAX_ALERTS);
  writeJSON(ALERTS_KEY, alertsCache);
  emit();
  // Whether this alert also surfaces as an on-device notification depends on
  // which of the three independent options (Push notifications screen) cover
  // it -- org-bookmark alerts, tender-bookmark alerts, or closing reminders
  // (kind "closing", which decided to fire on its own and always notifies
  // here as long as OS permission is granted -- see closingReminders.js).
  const settings = getSettings();
  // kind "new" (bulk or single) is always about tenders appearing under a
  // bookmarked org -- gate on the org, not the tender, even when a single
  // new-tender alert also carries a tenderId.
  // "new", "closing", "status", "prebid" and now "download" (see
  // api_server.py's _push_download_complete, pushed straight from the job
  // that requested it, no settings gating needed since it's a direct result
  // of the user's own action) are all delivered as real APNs push --
  // scheduling a second, local notification here for the same event would
  // just duplicate whatever the server already pushed. Only "success"
  // (checklist complete, a purely local event with no tenderId so it never
  // matches the gated branch below anyway) still goes through the local
  // path.
  const shouldNotifyLocally = kind !== "new" && kind !== "closing" && kind !== "status"
    && kind !== "prebid" && kind !== "download"
    && entry.tenderKey && settings.notifyTenderAlertsOn && isBookmarked(entry.tenderKey);
  if (shouldNotifyLocally) {
    notifyAlert(entry);
  }
  setBadgeCount(unreadCount());
  syncBadgeToServer(unreadCount());
  return entry;
}

export function markRead(id) {
  let changed = false;
  alertsCache = alertsCache.map((a) => {
    if (a.id !== id || a.read) return a;
    changed = true;
    return { ...a, read: true };
  });
  if (changed) { writeJSON(ALERTS_KEY, alertsCache); emit(); setBadgeCount(unreadCount()); syncBadgeToServer(unreadCount()); }
}

export function markAllRead() {
  alertsCache = alertsCache.map((a) => ({ ...a, read: true }));
  writeJSON(ALERTS_KEY, alertsCache);
  emit();
  setBadgeCount(unreadCount());
  syncBadgeToServer(unreadCount());
}

export function unreadCount() {
  return alertsCache.filter((a) => !a.read).length;
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useAlerts() {
  return useSyncExternalStore(subscribe, getAlerts, getAlerts);
}
