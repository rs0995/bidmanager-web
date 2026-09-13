import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { api } from "./api.js";
import { getRaw, setRaw } from "./kv.js";
import {
  getBookmarks, setBookmarks, getBookmarkedOrgs, setBookmarkedOrgs,
  getOrgIdByName, setSettings,
} from "./store.js";
import { mergeFromServer as mergeProjectsFromServer, forSync as projectsForSync, getProjects } from "./projects.js";
import { addAlert } from "./alerts.js";

// /client/sync is one whole-user JSON blob shared with the desktop Client UI.
// The SERVER is the source of truth: every local change is pushed
// (immediately when online, queued durably when offline), and a sync is
// always PUSH-the-queue -> PULL -> replace-local.
const SYNC_BLOB_KEY = "bm.syncBlob";
const SYNC_BASE_KEY = "bm.syncBase";
const SYNC_DIRTY_KEY = "bm.syncDirty";
const SNAPSHOT_KEY = "bm.tenderSnapshot";
const LAST_CHANGES_KEY = "bm.lastChangesAt";

function readJSON(key, fallback) {
  try { const raw = getRaw(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function writeJSON(key, value) { setRaw(key, JSON.stringify(value)); }

let lastBlob = readJSON(SYNC_BLOB_KEY, {});
function setLastBlob(blob) {
  lastBlob = blob || {};
  writeJSON(SYNC_BLOB_KEY, lastBlob);
}
function getBase() { const n = Number(getRaw(SYNC_BASE_KEY)); return Number.isFinite(n) && n > 0 ? n : 0; }
function setBase(ts) { const n = Number(ts); if (Number.isFinite(n) && n > 0) setRaw(SYNC_BASE_KEY, String(n)); }

function isDirty() { return getRaw(SYNC_DIRTY_KEY) === "1"; }
function markDirty() { setRaw(SYNC_DIRTY_KEY, "1"); }
function clearDirty() { setRaw(SYNC_DIRTY_KEY, ""); }

// Called once after lib/kv.js hydrateKV() resolves — re-reads the
// now-populated mirror (no subscribers to notify, this module has no hooks).
export function rehydrateSync() {
  lastBlob = readJSON(SYNC_BLOB_KEY, {});
}

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
    bookmarks: [...localBm],
    bookmarkedOrgs,
    bookmarkedOrgIds: bookmarkedOrgs.map((n) => orgIdByName[n]).filter((id) => Number.isFinite(id)),
    projects,
    checklist,
  };
  const removed = {
    bookmarks: (lastBlob.bookmarks || []).map(Number).filter((id) => Number.isFinite(id) && !localBm.has(id)),
    bookmarkedOrgs: (lastBlob.bookmarkedOrgs || []).filter((n) => !localOrg.has(n)),
    projects: idsOf(lastBlob.projects).filter((id) => !localProjIds.has(id)),
    checklist: idsOf(lastBlob.checklist).filter((id) => !localChkIds.has(id)),
  };
  return { data, removed, base_updated_at: getBase() };
}

let pushTimer = null;
let inFlightPush = null;

async function doPush() {
  clearTimeout(pushTimer);
  pushTimer = null;
  if (inFlightPush) { try { await inFlightPush; } catch { /* ignore */ } }
  const { data, removed, base_updated_at } = buildPushBody();
  inFlightPush = (async () => {
    try {
      const res = await api.putSync(data, removed, base_updated_at);
      clearDirty();
      setLastBlob(data);
      if (res && res.updated_at) setBase(res.updated_at);
      return true;
    } catch {
      return false;
    }
  })().finally(() => { inFlightPush = null; });
  return inFlightPush;
}

export function schedulePush() {
  markDirty();
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { syncUserData(); }, 1000);
}

async function doPull() {
  const res = await api.getSync().catch(() => null);
  if (!res) return false;
  const blob = res.data || {};

  setBookmarks((blob.bookmarks || []).map(Number));
  setBookmarkedOrgs(blob.bookmarkedOrgs || []);
  mergeProjectsFromServer(blob.projects || [], blob.checklist || []);

  setLastBlob(blob);
  if (res.updated_at) setBase(res.updated_at);
  return true;
}

let syncInFlight = null;
export async function syncUserData() {
  if (syncInFlight) { await syncInFlight; return; }
  syncInFlight = (async () => {
    if (isDirty()) {
      const ok = await doPush();
      if (!ok) return;
    }
    await doPull();
    if (isDirty()) await doPush();
  })().finally(() => { syncInFlight = null; });
  await syncInFlight;
}

export const pullBookmarks = syncUserData;
export const flushPush = doPush;

export async function syncNow() {
  await syncUserData();

  const projectTenderIds = getProjects().map((p) => p.source_tender_db_id).filter(Boolean);
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

    if (prev.status !== cur.status) {
      changedCount += 1;
      addAlert({ kind: "status", message: `"${tender.title}" status changed to ${cur.status || "unknown"}.`, tenderId: tender.id });
    }
    if (prev.prebid_count !== cur.prebid_count || prev.corrigendum_count !== cur.corrigendum_count) {
      changedCount += 1;
      addAlert({ kind: "prebid", message: `"${tender.title}" has a new pre-bid or corrigendum.`, tenderId: tender.id });
    }
  }
  writeJSON(SNAPSHOT_KEY, nextSnapshot);

  changedCount += await fetchServerChanges();

  setSettings({ lastSyncAt: new Date().toISOString() });
  return { changedCount };
}

async function fetchServerChanges() {
  const stored = Number(getRaw(LAST_CHANGES_KEY)) || 0;
  let resp;
  try {
    resp = await api.changes(stored);
  } catch { return 0; }

  let count = 0;
  if (stored > 0) {
    for (const t of resp.tenders || []) {
      if ((t.changed_fields || []).includes("closing_date")) {
        count += 1;
        addAlert({ kind: "status", message: `"${t.title || `Tender #${t.id}`}" — closing date changed.`, tenderId: t.id });
      }
    }
    for (const [org, items] of Object.entries(resp.new_by_org || {})) {
      const list = items || [];
      if (list.length > 10) {
        count += 1;
        addAlert({ kind: "new", message: `${list.length} new tenders added under ${org}.`, orgName: org });
      } else {
        list.forEach((t) => {
          count += 1;
          addAlert({ kind: "new", message: `"${t.title || t.tender_id}" added under ${org}.`, tenderId: t.id });
        });
      }
    }
  }
  if (resp.now) setRaw(LAST_CHANGES_KEY, String(resp.now));
  return count;
}

// Triggers — RN equivalents of the web app connectivity-change,
// visibilitychange, and pagehide listeners: NetInfo for online/offline,
// AppState for foreground/background.
NetInfo.addEventListener((state) => {
  if (state.isConnected) syncUserData().catch(() => {});
});
AppState.addEventListener("change", (nextState) => {
  if (nextState === "active") syncUserData().catch(() => {});
  else if (isDirty()) doPush().catch(() => {});
});
