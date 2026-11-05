import { useSyncExternalStore } from 'react';
import { readJSON, writeJSON } from './kv';
import type { AlertKind } from '../fixtures/alerts';

// The in-app Alerts feed, built on this device from what sync notices (server changes,
// status / corrigendum changes, closing reminders, finished downloads, completed
// checklists). Ported from BM Pro's lib/alerts.js. The server sends the matching push
// notifications; new tenders under one organisation group into one alert (and one push)
// until it is read, so the badge counts alerts, not tenders.

const ALERTS_KEY = 'bw.alerts';
export const ALERT_KEYS = [ALERTS_KEY];
const MAX_ALERTS = 100;
const MAX_NEW_TENDER_IDS = 300;

export type StoredAlert = {
  id: number;
  kind: AlertKind;
  message: string;
  at: string;
  read: boolean;
  tenderId?: string;
  projectId?: string;
  orgName?: string;
  newTenderIds?: string[];
  /** New tenders grouped in this alert (kind 'new'), oldest first. */
  newTenders?: NewTender[];
};

export type NewTender = { id: string; title: string };

/**
 * "“A” was added under X." for one tender; from two up, just the count:
 * "2 new tenders were added under X."
 */
export function newTendersMessage(org: string, items: NewTender[]): string {
  if (items.length === 1)
    return `“${items[0].title}” was added under ${org}.`;
  return `${items.length} new tenders were added under ${org}.`;
}

let alerts: StoredAlert[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(fn => fn());

export function rehydrateAlerts() {
  alerts = readJSON<StoredAlert[]>(ALERTS_KEY, []);
  nextId = 1 + alerts.reduce((m, a) => Math.max(m, a.id), 0);
  emit();
}

function persist() {
  writeJSON(ALERTS_KEY, alerts);
  emit();
}

export const getAlerts = () => alerts;
export const unreadCount = () => alerts.filter(a => !a.read).length;

export function addAlert(
  a: Omit<StoredAlert, 'id' | 'at' | 'read'>,
  at = new Date(),
) {
  const entry: StoredAlert = {
    ...a,
    id: nextId++,
    at: at.toISOString(),
    read: false,
    newTenderIds: a.newTenderIds?.slice(0, MAX_NEW_TENDER_IDS),
  };
  alerts = [entry, ...alerts].slice(0, MAX_ALERTS);
  persist();
  return entry;
}

/**
 * New tenders under an organisation. While that organisation's alert is still unread
 * they join it (one alert, so the badge stays the same) and it moves back to the top;
 * once it has been read, the next ones start a new alert. Returns true when a new alert
 * was added.
 */
export function upsertOrgAlert(
  org: string,
  items: NewTender[],
  at = new Date(),
): boolean {
  if (!items.length) return false;
  const open = alerts.find(
    a => a.kind === 'new' && !a.read && a.orgName === org,
  );
  const prior: NewTender[] = open
    ? open.newTenders ??
      (open.newTenderIds ?? (open.tenderId ? [open.tenderId] : [])).map(id => ({
        id,
        title: `Tender #${id}`,
      }))
    : [];
  const seen = new Set(prior.map(t => t.id));
  const merged = [...prior, ...items.filter(t => !seen.has(t.id))].slice(
    -MAX_NEW_TENDER_IDS,
  );
  const fields = {
    message: newTendersMessage(org, merged),
    newTenders: merged,
    newTenderIds: merged.map(t => t.id),
    // One tender opens it; several open the organisation's tenders.
    tenderId: merged.length === 1 ? merged[0].id : undefined,
  };
  if (!open) {
    addAlert({ kind: 'new', orgName: org, ...fields }, at);
    return true;
  }
  if (merged.length === prior.length) return false; // nothing new
  const updated: StoredAlert = { ...open, ...fields, at: at.toISOString() };
  alerts = [updated, ...alerts.filter(a => a.id !== open.id)];
  persist();
  return false;
}

/** Organisations whose new-tender alert is still unread (sent with the badge). */
export const unreadOrgs = () => [
  ...new Set(
    alerts
      .filter(a => a.kind === 'new' && !a.read && a.orgName)
      .map(a => a.orgName as string),
  ),
];

export function markRead(id: number) {
  if (!alerts.some(a => a.id === id && !a.read)) return;
  alerts = alerts.map(a => (a.id === id ? { ...a, read: true } : a));
  persist();
}

/**
 * A notification was opened: mark read the alerts it was about (a tender change,
 * closing reminder or download for that tender; new tenders under that organisation).
 * Returns how many were unread.
 */
export function markReadForPush(p: {
  thread?: string;
  tenderId?: number | string;
  orgName?: string;
}): number {
  const kind =
    p.thread === 'tender'
      ? 'change'
      : p.thread === 'closing'
      ? 'deadline'
      : p.thread === 'download'
      ? 'download'
      : p.thread === 'org'
      ? 'new'
      : null;
  if (!kind) return 0;
  const tid =
    p.tenderId !== undefined && p.tenderId !== null ? String(p.tenderId) : '';
  const hit = (a: StoredAlert) =>
    !a.read &&
    a.kind === kind &&
    (kind === 'new' ? a.orgName === p.orgName : a.tenderId === tid);
  const n = alerts.filter(hit).length;
  if (!n) return 0;
  alerts = alerts.map(a => (hit(a) ? { ...a, read: true } : a));
  persist();
  return n;
}

export function markAllRead() {
  if (!alerts.some(a => !a.read)) return;
  alerts = alerts.map(a => ({ ...a, read: true }));
  persist();
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * "Just now", "12 min ago", "3 hours ago" (today), "Yesterday", "22-Aug". The Alerts tab
 * groups anything "ago" under Today.
 */
export function alertTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const mins = Math.floor((now.getTime() - at.getTime()) / 60000);
  const sameDay = at.toDateString() === now.toDateString();
  if (mins < 1) return '0 min ago';
  if (mins < 60) return `${mins} min ago`;
  if (sameDay) {
    const h = Math.floor(mins / 60);
    return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (at.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return `${String(at.getDate()).padStart(2, '0')}-${MONTHS[at.getMonth()]}`;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Calls `fn` whenever the alerts change (push badge). Returns an unsubscribe. */
export const onAlertsChange = subscribe;

export const useStoredAlerts = () =>
  useSyncExternalStore(subscribe, getAlerts, getAlerts);
