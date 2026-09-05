import { api } from './api.js';
import { getBookmarks, setBookmarks, getBookmarkedOrgs, setBookmarkedOrgs, setSettings } from './store.js';
import { mergeFromServer as mergeProjectsFromServer, forSync as projectsForSync, getProjects } from './projects.js';
import { addAlert } from './alerts.js';
import { timeRemaining } from './format.js';

// /client/sync is a single whole-user JSON blob shared with the desktop
// Client UI, which also stores templates/templateItems/bookmarkedOrgs/
// tenderColumnPrefs in it (see Client UI/src/lib/api.js pushUserData). This
// app must never overwrite the blob wholesale — only merge its own
// `bookmarks`/`projects`/`checklist` fields in, or a mobile save would wipe
// a user's desktop templates.
let lastBlob = {};

const SNAPSHOT_KEY = 'bm.tenderSnapshot'; // { [tenderId]: closing_date } — for change detection only

function readSnapshot() {
  try { return JSON.parse(localStorage.getItem(SNAPSHOT_KEY)) || {}; } catch { return {}; }
}
function writeSnapshot(snapshot) {
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export async function pullBookmarks() {
  const res = await api.getSync().catch(() => null);
  lastBlob = res?.data || {};
  if (Array.isArray(lastBlob.bookmarks)) {
    setBookmarks(lastBlob.bookmarks.map(Number));
  }
  if (Array.isArray(lastBlob.bookmarkedOrgs)) {
    setBookmarkedOrgs(lastBlob.bookmarkedOrgs);
  }
  mergeProjectsFromServer(lastBlob.projects, lastBlob.checklist);
}

let pushTimer = null;
export function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const data = { ...lastBlob, bookmarks: [...getBookmarks()], bookmarkedOrgs: [...getBookmarkedOrgs()], ...projectsForSync() };
    lastBlob = data;
    api.putSync(data).catch(() => {
      // Offline-tolerant: the local write already succeeded; the desktop
      // app or a later mobile sync will reconcile it eventually.
    });
  }, 2000);
}

// Full "Sync now" action (More screen + Overview banner): pulls bookmarks/
// projects/checklist, then diffs the tenders the user actually cares about
// (bookmarked + turned into a project) against a small locally-kept
// snapshot to raise real Alerts entries for closing-date changes — mirrors
// Client UI/src/lib/api.js's syncFromServer notification diff, at a scale
// that doesn't require caching the entire tender table on the phone.
export async function syncNow() {
  await pullBookmarks();

  const ids = new Set([...getBookmarks(), ...getProjects().map((p) => p.source_tender_id).filter(Boolean)]);
  const snapshot = readSnapshot();
  const nextSnapshot = {};
  let changedCount = 0;
  for (const id of ids) {
    let tender;
    try { tender = await api.tender(id); } catch { continue; }
    nextSnapshot[id] = tender.closing_date;
    const previous = snapshot[id];
    if (previous && previous !== tender.closing_date) {
      changedCount += 1;
      addAlert({ kind: 'warning', message: `"${tender.title}" — closing date changed to ${formatSnapshotDate(tender.closing_date)}.` });
    }
  }
  writeSnapshot(nextSnapshot);
  if (changedCount === 0 && ids.size > 0) {
    // Quiet sync — no alert spam, just record the time (see below).
  }
  setSettings({ lastSyncAt: new Date().toISOString() });
  return { changedCount };
}

function formatSnapshotDate(dateLike) {
  const { date } = timeRemaining(dateLike);
  return date ? date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : String(dateLike || '—');
}
