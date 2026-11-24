import { AppState } from 'react-native';
import { api, SyncBlob } from './api';
import { getRaw, readJSON, setRaw, writeJSON } from './kv';
import {
  cancelScheduledPush,
  clearDirty,
  isDirty,
  isSyncPaused,
  registerSyncRunner,
} from './pushQueue';
import { forSync, mergeFromServer } from './sharedProjects';
import { checkForAlerts } from './alertChecks';
import { refreshAccount } from './account';
import { checkNewProjects } from './projectAlerts';
import {
  getBookmarkedOrgs,
  getBookmarks,
  getOrgIdByName,
  getPrebidOff,
  getPrebidOn,
  getSettings,
  setBookmarkedOrgs,
  setBookmarks,
  setPrebidLists,
  setSettings,
  tenderKey,
} from './store';

// /client/sync is one whole-user JSON blob shared with BM Pro and the desktop Client UI.
// The server is the source of truth and merges additively: unions, plus `removed` deltas
// for what this device dropped since its last pull. A sync is always
// push-the-queue -> pull -> replace-local. Ported from BM Pro's lib/sync.js.

const BLOB_KEY = 'bw.syncBlob';
const BASE_KEY = 'bw.syncBase';
export const SYNC_KEYS = [BLOB_KEY, BASE_KEY];

const ids = (rows: { id?: number }[] | undefined) =>
  (rows ?? []).map(r => Number(r?.id)).filter(Number.isFinite);

const getLastBlob = () => readJSON<SyncBlob>(BLOB_KEY, {});
const getBase = () => {
  const n = Number(getRaw(BASE_KEY));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const setBase = (ts: number | null | undefined) => {
  const n = Number(ts);
  if (Number.isFinite(n) && n > 0) setRaw(BASE_KEY, String(n));
};

/** What this device sends: its full state, plus what it removed since the last pull. */
export function buildPushBody(): {
  data: SyncBlob;
  removed: Record<string, (number | string)[]>;
  base_updated_at: number;
} {
  const last = getLastBlob();
  const localBm = getBookmarks();
  const localOrgs = getBookmarkedOrgs();
  const prebidOn = getPrebidOn();
  const prebidOff = getPrebidOff();
  const orgIdByName = getOrgIdByName();
  const { projects, checklist } = forSync();
  const localProjIds = new Set(ids(projects));
  const localChkIds = new Set(ids(checklist));
  const settings = getSettings();
  const bookmarkedOrgs = [...localOrgs];
  const data: SyncBlob = {
    bookmarks: [...localBm],
    bookmarkedOrgs,
    bookmarkedOrgIds: bookmarkedOrgs
      .map(n => orgIdByName[n])
      .filter(id => Number.isFinite(id)),
    projects,
    checklist,
    prebidReminderIds: [...prebidOn],
    prebidReminderOffIds: [...prebidOff],
  };
  // Notification preferences (read by the server's push pass) are sent only once the
  // user has set them here, or one is on. A fresh install sends nothing, so its "off"
  // defaults can't overwrite the saved choice; the server also keeps the newer copy.
  const stamp = Number(settings.notificationPrefsUpdatedAt) || 0;
  if (
    stamp > 0 ||
    settings.notifyOrgAlertsOn ||
    settings.notifyTenderAlertsOn ||
    settings.reminderDays.length > 0
  ) {
    data.notificationPrefs = {
      notifyOrgAlertsOn: Boolean(settings.notifyOrgAlertsOn),
      notifyTenderAlertsOn: Boolean(settings.notifyTenderAlertsOn),
      reminderDays: settings.reminderDays,
      prebidLeads: settings.prebidLeads,
      prebidAutoBookmarked: Boolean(settings.prebidAutoBookmarked),
      updatedAt: stamp,
    };
  }
  return {
    data,
    removed: {
      bookmarks: (last.bookmarks ?? [])
        .map(Number)
        .filter(id => Number.isFinite(id) && !localBm.has(id)),
      bookmarkedOrgs: (last.bookmarkedOrgs ?? []).filter(
        n => !localOrgs.has(n),
      ),
      projects: ids(last.projects).filter(id => !localProjIds.has(id)),
      checklist: ids(last.checklist).filter(id => !localChkIds.has(id)),
      prebidReminderIds: (last.prebidReminderIds ?? [])
        .map(tenderKey)
        .filter(id => id && !prebidOn.has(id)),
      prebidReminderOffIds: (last.prebidReminderOffIds ?? [])
        .map(tenderKey)
        .filter(id => id && !prebidOff.has(id)),
    },
    base_updated_at: getBase(),
  };
}

let inFlightPush: Promise<boolean> | null = null;

export async function pushNow(): Promise<boolean> {
  cancelScheduledPush();
  if (isSyncPaused()) return false;
  if (inFlightPush) await inFlightPush.catch(() => false);
  const body = buildPushBody();
  inFlightPush = api
    .putSync(body.data, body.removed, body.base_updated_at)
    .then(res => {
      clearDirty();
      writeJSON(BLOB_KEY, body.data);
      setBase(res?.updated_at);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      inFlightPush = null;
    });
  return inFlightPush;
}

/** The server's preferences win unless this device changed its toggles more recently. */
export function applyServerNotificationPrefs(
  prefs: SyncBlob['notificationPrefs'],
) {
  if (!prefs || typeof prefs !== 'object') return;
  const remote = Number(prefs.updatedAt) || 0;
  const local = Number(getSettings().notificationPrefsUpdatedAt) || 0;
  if (remote < local) return;
  setSettings({
    notifyOrgAlertsOn: Boolean(prefs.notifyOrgAlertsOn),
    notifyTenderAlertsOn: Boolean(prefs.notifyTenderAlertsOn),
    reminderDays: Array.isArray(prefs.reminderDays) ? prefs.reminderDays : [],
    // Older apps (BM Pro) don't send these: keep this phone's choice then.
    ...(Array.isArray(prefs.prebidLeads) && { prebidLeads: prefs.prebidLeads }),
    ...(typeof prefs.prebidAutoBookmarked === 'boolean' && {
      prebidAutoBookmarked: prefs.prebidAutoBookmarked,
    }),
    notificationPrefsUpdatedAt: remote,
  });
}

export async function pull(): Promise<boolean> {
  const res = await api.getSync().catch(() => null);
  if (!res) return false;
  const blob = res.data ?? {};
  setBookmarks((blob.bookmarks ?? []).map(Number));
  setBookmarkedOrgs(blob.bookmarkedOrgs ?? []);
  setPrebidLists(blob.prebidReminderIds ?? [], blob.prebidReminderOffIds ?? []);
  mergeFromServer(blob.projects ?? [], blob.checklist ?? []);
  // Projects someone else added: an alert in the Alerts tab (if that's on).
  if (Array.isArray(blob.projects)) checkNewProjects(blob.projects);
  applyServerNotificationPrefs(blob.notificationPrefs);
  writeJSON(BLOB_KEY, blob);
  setBase(res.updated_at);
  return true;
}

let syncInFlight: Promise<void> | null = null;

/** Push pending changes, pull, and push again if anything changed meanwhile. */
export async function syncUserData(): Promise<void> {
  if (isSyncPaused()) return;
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    if (isDirty() && !(await pushNow())) return;
    await pull();
    if (isDirty()) await pushNow();
    afterSync.forEach(fn => fn());
  })().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

const afterSync = new Set<() => void>();
/** Runs `fn` after every completed sync (lib/projectFiles.ts uploads waiting files). */
export function onSynced(fn: () => void) {
  afterSync.add(fn);
  return () => {
    afterSync.delete(fn);
  };
}

registerSyncRunner(syncUserData);

/** The manual Sync tenders action: also lifts the Clear-cache pause. */
export async function syncNow(): Promise<number> {
  await syncUserData();
  const alerts = await checkForAlerts().catch(() => 0);
  lastAlertCheck = Date.now();
  setSettings({ lastSyncAt: new Date().toISOString() });
  return alerts;
}

/** Automatic alert checks (launch, foreground) run at most this often. */
const AUTO_CHECK_MS = 10 * 60 * 1000;
let lastAlertCheck = 0;

/** Sync, then look for alerts unless that happened in the last 10 minutes. */
export async function autoSync(): Promise<void> {
  if (isSyncPaused()) return;
  // Sections or organisation may have changed (an admin's edit) while away.
  refreshAccount().catch(() => {});
  await syncUserData();
  if (Date.now() - lastAlertCheck < AUTO_CHECK_MS) return;
  lastAlertCheck = Date.now();
  await checkForAlerts().catch(() => 0);
}

let appStateWired = false;
/** Sync on foreground; flush pending changes on background. Called once at boot. */
export function wireSyncTriggers() {
  if (appStateWired) return;
  appStateWired = true;
  AppState.addEventListener('change', next => {
    if (next === 'active') autoSync().catch(() => {});
    else if (isDirty()) pushNow().catch(() => {});
  });
}
