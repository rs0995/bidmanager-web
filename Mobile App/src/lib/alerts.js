import { useSyncExternalStore } from 'react';

// Locally-derived alert feed (no server push infrastructure in scope — see
// the plan's Alerts section). Entries are appended by real local events:
// a sync pass noticing a bookmarked/project tender's closing date changed
// or new tenders appearing (see sync.js), a checklist reaching 100% (see
// projects.js), and a periodic local deadline-threshold check (see
// deadlineCheck.js). Nothing here is fabricated demo content.
const ALERTS_KEY = 'bm.alerts';
const MAX_ALERTS = 100;

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

let alertsCache = readJSON(ALERTS_KEY, []);
let nextId = 1 + alertsCache.reduce((m, a) => Math.max(m, a.id), 0);

export function getAlerts() {
  return alertsCache;
}

export function addAlert({ kind, message }) {
  const entry = { id: nextId++, kind, message, at: new Date().toISOString(), read: false };
  alertsCache = [entry, ...alertsCache].slice(0, MAX_ALERTS);
  writeJSON(ALERTS_KEY, alertsCache);
  emit();
  return entry;
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
