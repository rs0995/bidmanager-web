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

// A sync is always PULL -> reconcile -> PUSH. A push never fires before a
// /client/sync GET has succeeded this session, so a device that made changes
// while offline / not-yet-synced fetches the server's copy and merges into it
// first, instead of shipping a stale/partial blob. Session-scoped (not
// persisted) on purpose — every launch re-pulls before it pushes.
let pulledThisSession = false;
let pullInFlight = null;

// ── Push ─────────────────────────────────────────────────────────────────
function idsOf(rows) {
  return (rows || []).map((r) => Number(r && r.id)).filter((id) => Number.isFinite(id));
}

function buildPushBody() {
  const orgIdByName = getOrgIdByName();
  const bookmarkedOrgs = [...getBookmarkedOrgs()];
  const localBm = getBookmarks();
  const localOrg = getBookmarkedOrgs();
  const { projects, checklist } = projectsForSync();
  const localProjIds = new Set(idsOf(projects));
  const localChkIds = new Set(idsOf(checklist));
  const data = {
    ...lastBlob,
    bookmarks: [...localBm],
    bookmarkedOrgs,
    bookmarkedOrgIds: bookmarkedOrgs.map((n) => orgIdByName[n]).filter((id) => Number.isFinite(id)),
    projects,
    checklist,
  };
  delete data.removed;
  // Removal delta: what the last server blob had but is gone locally now —
  // the server unions everything else, so this is the only way a delete
  // propagates.
  const removed = {
    bookmarks: (lastBlob.bookmarks || []).map(Number).filter((id) => Number.isFinite(id) && !localBm.has(id)),
    bookmarkedOrgs: (lastBlob.bookmarkedOrgs || []).filter((n) => !localOrg.has(n)),
    projects: idsOf(lastBlob.projects).filter((id) => !localProjIds.has(id)),
    checklist: idsOf(lastBlob.checklist).filter((id) => !localChkIds.has(id)),
  };
  return { data, removed };
}

let pushTimer = null;
let inFlightPush = null;

export function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { flushPush(); }, 2000);
}

// Run any pending push now. If we haven't pulled yet this session, pull &
// reconcile first (its trailing flushPush sends the merged result).
export function flushPush() {
  clearTimeout(pushTimer);
  pushTimer = null;
  if (!pulledThisSession) return pullBookmarks();
  const { data, removed } = buildPushBody();
  setLastBlob(data);
  inFlightPush = api.putSync(data, removed)
    .catch(() => { /* offline-tolerant: local write already succeeded */ })
    .finally(() => { inFlightPush = null; });
  return inFlightPush;
}

// ── Pull ─────────────────────────────────────────────────────────────────
export async function pullBookmarks() {
  if (pullInFlight) { await pullInFlight; return; }
  pullInFlight = (async () => {
    const res = await api.getSync().catch(() => null);
    if (!res) return;   // offline — stay local-only; a later pull reconciles + pushes

    const blob = res.data || {};
    const prev = lastBlob;

    if (Array.isArray(blob.bookmarks)) {
      // server is authoritative, but keep a local bookmark that is a genuine
      // unsynced ADD (not on the server AND not in the last server blob we
      // saw). Drop anything the server dropped — real removals + phantoms.
      const serverSet = new Set(blob.bookmarks.map(Number));
      const prevSet = new Set((prev.bookmarks || []).map(Number));
      const localAdds = [...getBookmarks()].filter((id) => !serverSet.has(id) && !prevSet.has(id));
      setBookmarks([...serverSet, ...localAdds]);
    }
    if (Array.isArray(blob.bookmarkedOrgs)) {
      const serverSet = new Set(blob.bookmarkedOrgs);
      const prevSet = new Set(prev.bookmarkedOrgs || []);
      const localAdds = [...getBookmarkedOrgs()].filter((n) => !serverSet.has(n) && !prevSet.has(n));
      setBookmarkedOrgs([...serverSet, ...localAdds]);
    }
    mergeProjectsFromServer(blob.projects, blob.checklist, prev);

    setLastBlob(blob);
    pulledThisSession = true;
  })().finally(() => { pullInFlight = null; });
  await pullInFlight;

  // Reconciled — push our merged state (adds the other device should see +
  // the `removed` delta). Skipped if the pull failed (still not ready).
  if (pulledThisSession) await flushPush();
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
