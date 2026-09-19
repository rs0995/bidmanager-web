import { useSyncExternalStore } from "react";
import { getRaw, setRaw } from "./kv.js";

// Locally-derived alert feed (no server push infrastructure in scope).
// Entries are appended by real local events: a sync pass noticing a
// bookmarked/project tender closing-date change or new tenders appearing
// (see sync.js), a checklist reaching 100% (see projects.js), and a
// periodic local deadline-threshold check (see deadlineCheck.js).
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
}

export function getAlerts() {
  return alertsCache;
}

export function getAlert(id) {
  return alertsCache.find((a) => a.id === Number(id)) || null;
}

// A bulk "N new tenders added under <org>" alert carries the ids the server
// reported as new, so the alert can open a screen showing exactly those
// tenders (there is no server filter for "tenders first seen after X").
// Capped so a huge first sync can't bloat the persisted alert list.
const MAX_NEW_TENDER_IDS = 300;

export function addAlert({ kind, message, tenderId, orgName, newTenderIds }) {
  const entry = {
    id: nextId++, kind, message, at: new Date().toISOString(), read: false,
    tenderId: tenderId ?? null, orgName: orgName ?? null,
  };
  if (Array.isArray(newTenderIds) && newTenderIds.length > 0) {
    entry.newTenderIds = newTenderIds.slice(0, MAX_NEW_TENDER_IDS);
  }
  alertsCache = [entry, ...alertsCache].slice(0, MAX_ALERTS);
  writeJSON(ALERTS_KEY, alertsCache);
  emit();
  return entry;
}

export function markRead(id) {
  let changed = false;
  alertsCache = alertsCache.map((a) => {
    if (a.id !== id || a.read) return a;
    changed = true;
    return { ...a, read: true };
  });
  if (changed) { writeJSON(ALERTS_KEY, alertsCache); emit(); }
}

export function markAllRead() {
  alertsCache = alertsCache.map((a) => ({ ...a, read: true }));
  writeJSON(ALERTS_KEY, alertsCache);
  emit();
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
