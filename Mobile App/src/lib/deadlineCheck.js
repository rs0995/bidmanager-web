import { addAlert } from './alerts.js';
import { getBookmarks } from './store.js';
import { getProjects } from './projects.js';
import { timeRemaining } from './format.js';

// Best-effort, foreground-only deadline reminders: while the app/tab is
// open, periodically checks bookmarked + project tenders against 72h/24h/3h
// thresholds and (if the user opted in) fires a real browser Notification.
// This is NOT background push — there's no service worker/push server in
// this app, so nothing fires while the tab/app is closed. The Alerts screen
// still records the same entries either way.
const THRESHOLDS_HOURS = [72, 24, 3];
const FIRED_KEY = 'bm.remindersFired';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

function readFired() {
  try { return new Set(JSON.parse(localStorage.getItem(FIRED_KEY)) || []); } catch { return new Set(); }
}
function writeFired(set) {
  localStorage.setItem(FIRED_KEY, JSON.stringify([...set]));
}

export function canNotify() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function requestNotificationPermission() {
  if (!canNotify()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function notify(title, body) {
  if (canNotify() && Notification.permission === 'granted') {
    try { new Notification(title, { body }); } catch { /* best-effort */ }
  }
}

// Fetches full tender rows for the given ids so the check has closing dates
// to compare — passed in by the caller (needs an authenticated api client),
// keeping this module free of React Query dependencies.
export async function runDeadlineCheck(fetchTenderById) {
  const ids = new Set([...getBookmarks(), ...getProjects().map((p) => p.source_tender_id).filter(Boolean)]);
  if (ids.size === 0) return;
  const fired = readFired();
  let changed = false;
  for (const id of ids) {
    let tender;
    try { tender = await fetchTenderById(id); } catch { continue; }
    if (!tender?.closing_date) continue;
    const { totalDays, expired } = timeRemaining(tender.closing_date);
    if (expired || totalDays == null) continue;
    const hoursLeft = totalDays * 24;
    for (const threshold of THRESHOLDS_HOURS) {
      const key = `${tender.id}:${threshold}`;
      if (hoursLeft <= threshold && !fired.has(key)) {
        fired.add(key);
        changed = true;
        const message = `"${tender.title}" closes in about ${threshold}h.`;
        addAlert({ kind: 'deadline', message });
        notify('Deadline approaching', message);
      }
    }
  }
  if (changed) writeFired(fired);
}

let intervalId = null;
export function startDeadlineChecks(fetchTenderById) {
  stopDeadlineChecks();
  runDeadlineCheck(fetchTenderById);
  intervalId = setInterval(() => runDeadlineCheck(fetchTenderById), CHECK_INTERVAL_MS);
}
export function stopDeadlineChecks() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
}
