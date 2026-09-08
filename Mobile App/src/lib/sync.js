import { api } from './api.js';
import {
  getBookmarks, setBookmarks, getBookmarkedOrgs, setBookmarkedOrgs,
  getOrgIdByName, setSettings,
} from './store.js';
import { mergeFromServer as mergeProjectsFromServer, forSync as projectsForSync, getProjects } from './projects.js';
import { addAlert } from './alerts.js';

// /client/sync is a single whole-user JSON blob shared with the desktop
// Client UI, which also stores templates/templateItems/tenderColumnPrefs in
// it (see Client UI/src/lib/api.js pushUserData). This app must never
// overwrite the blob wholesale — only merge its own fields in.
//
// lastBlob is PERSISTED (bm.syncBlob) so a reload doesn't start from {} and
// let a push before the first pull blank out desktop-owned fields.
const SYNC_BLOB_KEY = 'bm.syncBlob';
const SYNC_READY_KEY = 'bm.syncReady';          // '1' once a pull has merged the server blob in
const SNAPSHOT_KEY = 'bm.tenderSnapshot';       // { [id]: { closing_date, status, prebid_count, corrigendum_count } }
const LAST_CHANGES_KEY = 'bm.lastChangesAt';    // epoch seconds cursor for GET /client/changes

function readJSON(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function writeJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

let lastBlob = readJSON(SYNC_BLOB_KEY, {});
function setLastBlob(blob) {
  lastBlob = blob || {};
  writeJSON(SYNC_BLOB_KEY, lastBlob);
}

// This install must PULL the server's blob and merge it in before it is
// allowed to PUSH — otherwise a fresh / dev-mode / offline origin whose
// localStorage holds a stale `bm.bookmarks` / `bm.projects` would ship that
// as authoritative and the server (a blind whole-blob replace) would clobber
// the account. Persisted so a reload doesn't re-open the push gate.
let syncReady = false;
try { syncReady = localStorage.getItem(SYNC_READY_KEY) === '1'; } catch { /* private mode */ }

// ── Push ─────────────────────────────────────────────────────────────────
function buildPushData() {
  const orgIdByName = getOrgIdByName();
  const bookmarkedOrgs = [...getBookmarkedOrgs()];
  return {
    ...lastBlob,
    bookmarks: [...getBookmarks()],
    bookmarkedOrgs,
    bookmarkedOrgIds: bookmarkedOrgs.map((n) => orgIdByName[n]).filter((id) => Number.isFinite(id)),
    ...projectsForSync(),
  };
}

let pushTimer = null;
let inFlightPush = null;

export function schedulePush() {
  if (!syncReady) return;   // not reconciled with the server yet — see syncReady
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { flushPush(); }, 2000);
}

// Run any pending push immediately and return its promise. Called before
// every pull (desktop's flush-before-pull) and on tab hide, so a local
// edit made in the debounce window is never clobbered by the server copy.
export function flushPush() {
  if (!syncReady) return Promise.resolve();   // never push before the first pull
  clearTimeout(pushTimer);
  pushTimer = null;
  const data = buildPushData();
  setLastBlob(data);
  inFlightPush = api.putSync(data)
    .catch(() => { /* offline-tolerant: local write already succeeded */ })
    .finally(() => { inFlightPush = null; });
  return inFlightPush;
}

// ── Pull ─────────────────────────────────────────────────────────────────
export async function pullBookmarks() {
  if (syncReady) await flushPush();   // first run: nothing safe to push yet

  const res = await api.getSync().catch(() => null);
  // Server unreachable — stay local-only and NOT ready, so a later edit can't
  // push a blob we never reconciled. (Don't blank lastBlob here either.)
  if (!res) return;

  const blob = res.data || {};
  setLastBlob(blob);

  if (Array.isArray(blob.bookmarks)) {
    // Union with the current local set — belt-and-braces against a push
    // that failed just before this pull.
    const merged = new Set([...getBookmarks(), ...blob.bookmarks.map(Number)]);
    setBookmarks([...merged]);
  }
  if (Array.isArray(blob.bookmarkedOrgs)) {
    const merged = new Set([...getBookmarkedOrgs(), ...blob.bookmarkedOrgs]);
    setBookmarkedOrgs([...merged]);
  }
  mergeProjectsFromServer(blob.projects, blob.checklist);

  if (!syncReady) {
    // The server blob is now merged in — pushes are safe from here on.
    syncReady = true;
    try { localStorage.setItem(SYNC_READY_KEY, '1'); } catch { /* private mode */ }
    // Propagate anything the union just brought together (a local-only
    // bookmark/project the server didn't have yet).
    schedulePush();
  }
}

// ── Full "Sync now" (More screen + Overview banner) ──────────────────────
export async function syncNow() {
  await pullBookmarks();

  const projectTenderIds = getProjects().map((p) => p.source_tender_id).filter(Boolean);
  const ids = new Set([...getBookmarks(), ...projectTenderIds]);

  const snapshot = readJSON(SNAPSHOT_KEY, {});
  const nextSnapshot = {};
  let changedCount = 0;

  for (const id of ids) {
    let tender;
    try { tender = await api.tender(id); } catch { continue; }
    const cur = {
      closing_date: tender.closing_date,
      status: tender.status,
      prebid_count: Number(tender.prebid_count) || 0,
      corrigendum_count: Number(tender.corrigendum_count) || 0,
    };
    nextSnapshot[id] = cur;
    const prev = snapshot[id];
    if (!prev) continue;

    // closing_date is covered by the server change feed (fetchServerChanges);
    // the local diff owns status + pre-bid/corrigendum, which the server's
    // tender_history snapshot doesn't track.
    if (prev.status !== cur.status) {
      changedCount += 1;
      addAlert({ kind: 'status', message: `"${tender.title}" status changed to ${cur.status || 'unknown'}.` });
    }
    if (prev.prebid_count !== cur.prebid_count || prev.corrigendum_count !== cur.corrigendum_count) {
      changedCount += 1;
      addAlert({ kind: 'prebid', message: `"${tender.title}" has a new pre-bid or corrigendum.` });
    }
  }
  writeJSON(SNAPSHOT_KEY, nextSnapshot);

  changedCount += await fetchServerChanges();

  setSettings({ lastSyncAt: new Date().toISOString() });
  return { changedCount };
}

// Pull server-recorded changes for this user's bookmarks (closing-date changes
// on bookmarked tenders + new tenders under bookmarked orgs) since our cursor,
// and raise alerts. Replaces the old per-org tender paging — the server already
// knows what changed via tender_history / first_seen_at. The very first run
// (no cursor) only stores the cursor so we don't alert on the back-catalogue.
async function fetchServerChanges() {
  const stored = Number(localStorage.getItem(LAST_CHANGES_KEY)) || 0;
  let resp;
  try {
    resp = await api.changes(stored);
  } catch { return 0; }

  let count = 0;
  if (stored > 0) {
    for (const t of resp.tenders || []) {
      if ((t.changed_fields || []).includes('closing_date')) {
        count += 1;
        addAlert({ kind: 'status', message: `"${t.title || `Tender #${t.id}`}" — closing date changed.` });
      }
    }
    for (const [org, items] of Object.entries(resp.new_by_org || {})) {
      const list = items || [];
      if (list.length > 10) {
        count += 1;
        addAlert({ kind: 'new', message: `${list.length} new tenders added under ${org}.` });
      } else {
        list.forEach((t) => {
          count += 1;
          addAlert({ kind: 'new', message: `"${t.title || t.tender_id}" added under ${org}.` });
        });
      }
    }
  }
  if (resp.now) localStorage.setItem(LAST_CHANGES_KEY, String(resp.now));
  return count;
}

// Flush a pending push before the tab is backgrounded/closed.
if (typeof window !== 'undefined') {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pushTimer) flushPush();
  });
  window.addEventListener('pagehide', () => { if (pushTimer) flushPush(); });
}
