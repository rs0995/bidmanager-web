import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { api } from "./api.js";
import { queryClient } from "./queryClient.js";
import { WEBSITES_QUERY_KEY } from "../hooks/useWebsites.js";
import { CAPTCHA_PENDING_QUERY_KEY } from "../hooks/useCaptchaPending.js";
import { getRaw, setRaw } from "./kv.js";
import {
  getBookmarks, setBookmarks, getBookmarkedOrgs, setBookmarkedOrgs,
  getOrgIdByName, setSettings, getSettings,
} from "./store.js";
import { mergeFromServer as mergeProjectsFromServer, forSync as projectsForSync, getProjects } from "./projects.js";
import { addAlert } from "./alerts.js";
import { requestTenderUpdate } from "./tenderUpdates.js";
import { isDirty, clearDirty, registerSyncRunner, cancelScheduledPush, schedulePush } from "./pushQueue.js";

// Re-exported so existing importers of schedulePush from here (e.g.
// hooks/useBookmarks.js) don't need to change -- the dirty-flag/debounce
// mechanism itself now lives in pushQueue.js (see the comment there for why).
export { schedulePush };

// /client/sync is one whole-user JSON blob shared with the desktop Client UI.
// The SERVER is the source of truth: every local change is pushed
// (immediately when online, queued durably when offline), and a sync is
// always PUSH-the-queue -> PULL -> replace-local.
const SYNC_BLOB_KEY = "bm.syncBlob";
const SYNC_BASE_KEY = "bm.syncBase";
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
  // Server-side push (apns_push.py, via api_server.py's scheduler) reads this
  // to know which notifications a user wants -- without it the server has no
  // way to tell "push nothing" from "push everything" for a given device.
  // Last-write-wins (see _merge_sync_blob's generic-key path) is fine here:
  // it's one small object, not a set that needs cross-device union.
  const settings = getSettings();
  const data = {
    bookmarks: [...localBm],
    bookmarkedOrgs,
    bookmarkedOrgIds: bookmarkedOrgs.map((n) => orgIdByName[n]).filter((id) => Number.isFinite(id)),
    projects,
    checklist,
    notificationPrefs: {
      notifyOrgAlertsOn: Boolean(settings.notifyOrgAlertsOn),
      notifyTenderAlertsOn: Boolean(settings.notifyTenderAlertsOn),
      reminderDays: Array.isArray(settings.reminderDays) ? settings.reminderDays : [],
    },
  };
  const removed = {
    bookmarks: (lastBlob.bookmarks || []).map(Number).filter((id) => Number.isFinite(id) && !localBm.has(id)),
    bookmarkedOrgs: (lastBlob.bookmarkedOrgs || []).filter((n) => !localOrg.has(n)),
    projects: idsOf(lastBlob.projects).filter((id) => !localProjIds.has(id)),
    checklist: idsOf(lastBlob.checklist).filter((id) => !localChkIds.has(id)),
  };
  return { data, removed, base_updated_at: getBase() };
}

let inFlightPush = null;

async function doPush() {
  cancelScheduledPush();
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
// So pushQueue.js's debounced schedulePush() timer has something to call
// (pushQueue.js can't import syncUserData directly without recreating the
// cycle this split was meant to remove).
registerSyncRunner(syncUserData);
export const flushPush = doPush;

let syncNowInFlight = null;

// _layout.tsx's boot effect, its own AppState "active" listener, and the
// Tenders tab's own mount effect can all end up calling this within the
// same tick on a cold launch (iOS commonly fires an inactive->active
// AppState transition right after launch, on top of the boot effect that
// already ran). Each independent call used to read the same not-yet-updated
// LAST_CHANGES_KEY cursor and process the same server changes a second
// time, which is what put the same "N new tenders added under X" alert
// into the feed twice. Sharing one in-flight promise (same pattern as
// doPush/syncUserData above) means every concurrent caller gets the one
// real result instead of each doing its own redundant, duplicate-producing
// pass.
export async function syncNow() {
  if (syncNowInFlight) return syncNowInFlight;
  syncNowInFlight = (async () => {
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
      if (!prev) {
        if (cur.corrigendum_count > 0 && !tender.is_archived) requestTenderUpdate(tender).catch(() => {});
        continue;
      }

      if (prev.status !== cur.status) {
        changedCount += 1;
        addAlert({ kind: "status", message: `"${tender.title}" status changed to ${cur.status || "unknown"}.`, tenderId: tender.id });
      }
      if (prev.prebid_count !== cur.prebid_count || prev.corrigendum_count !== cur.corrigendum_count) {
        changedCount += 1;
        addAlert({ kind: "prebid", message: `"${tender.title}" has a new pre-bid or corrigendum.`, tenderId: tender.id });
      }
      if (cur.corrigendum_count > (prev.corrigendum_count || 0) && !tender.is_archived) {
        requestTenderUpdate(tender).catch(() => {});
      }
    }
    writeJSON(SNAPSHOT_KEY, nextSnapshot);

    changedCount += await fetchServerChanges();

    setSettings({ lastSyncAt: new Date().toISOString() });
    return { changedCount };
  })().finally(() => { syncNowInFlight = null; });
  return syncNowInFlight;
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
        addAlert({
          kind: "new",
          message: `${list.length} new tenders added under ${org}.`,
          orgName: org,
          newTenderIds: list.map((t) => t.id),
        });
      } else {
        list.forEach((t) => {
          count += 1;
          // orgName included so org-bookmark notification gating (alerts.js)
          // applies here the same way it does to the bulk branch above --
          // these single-tender alerts are only ever raised for bookmarked
          // orgs in the first place.
          addAlert({
            kind: "new", message: `"${t.title || t.tender_id}" added under ${org}.`,
            tenderId: t.id, orgName: org,
          });
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
  if (nextState === "active") {
    syncUserData().catch(() => {});
    // Orgs/websites added server-side (e.g. via the admin scraper UI) only
    // show up once the 5min staleTime in useWebsites.js lapses -- nothing
    // else was invalidating that query, so a newly-synced org wouldn't
    // appear until a cold app restart. Foregrounding is the natural "the
    // user is about to look at this" signal, same as the bookmark sync
    // above.
    queryClient.invalidateQueries({ queryKey: WEBSITES_QUERY_KEY }).catch(() => {});
    // Same reasoning -- a CAPTCHA push (see apns_push.py) can arrive while
    // the app is closed; foregrounding is the first chance to refresh the
    // Captcha row/tab badge against the server's actual pending state.
    queryClient.invalidateQueries({ queryKey: CAPTCHA_PENDING_QUERY_KEY }).catch(() => {});
  } else if (isDirty()) {
    doPush().catch(() => {});
  }
});
