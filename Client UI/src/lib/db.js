import { DEFAULT_SERVER_URL } from './cloud-config';

const DB_NAME = 'bidmanager-client';
const DB_VERSION = 1;
const STORE = 'state';
const STATE_KEY = 'primary';

const initialState = () => ({
  schemaVersion: 1,
  websites: [],
  tenders: [],
  projects: [],
  checklist: [],
  templates: [],
  templateItems: [],
  documents: [],
  // organizations.id when pushing cloud sync data; never rendered directly.
  organizations: [],
  bookmarkedOrgs: [],
  settings: {
    parent_dir: '',
    project_details_show_tender_info: 'true',
    projects_entry_mode: 'inline',
    server_url: DEFAULT_SERVER_URL,
    // The baked-in DEFAULT_SERVER_URL is authoritative until the user
    // explicitly changes the Backend URL in Settings (flips this true).
    // Until then connection() ignores a stale/dead saved server_url — a
    // fresh install over old app data can't get stuck on a dead host.
    server_url_user_set: false,
    // Set true after the first successful pullUserData. Until then the
    // client never pushes: a brand-new (or stale) device adopts the
    // server's data first and can't clobber it with a blank/partial blob.
    has_synced_once: false,
    client_api_key: '',
    auth_token: '',
    last_sync_at: '',
    // How often the background sync (App.jsx's periodic syncFromServer
    // effect) re-runs, in minutes. Editable in Settings; the app also
    // always syncs once immediately on every launch regardless of this.
    sync_interval_minutes: 15,
    // Durable twin of api.js's in-memory _syncPushPending — true whenever a
    // cloud-synced edit hasn't yet been confirmed pushed to the server.
    // Survives an app restart so an edit that failed to push (backend 502,
    // app closed before the retry landed) doesn't silently sit unconfirmed
    // forever — see flushPendingSyncPush in Client UI/src/lib/api.js.
    pendingSyncPush: false,
    // Device-local only — never part of the cloud sync blob. Maps
    // organization id -> job_id for an in-flight one-time "Request tenders"
    // scrape (see api.js requestOrgTenders/pollOrgTendersJob), so the button
    // still shows "Requesting…" and polling still resumes after a restart.
    pendingOrgRequests: {},
    // Device-local only. Maps portal-search id -> true for an in-flight
    // search (see api.js requestPortalSearch/pollPortalSearch), so polling
    // resumes after a restart while the server is still working on it.
    pendingPortalSearches: {},
    // Account/organisation state (see Server UI/server/org_access.py) —
    // mirrors the `account` block returned by login/register/GET /client/me.
    // An individual account (the only kind that existed before this) always
    // reads account_type 'individual', org null, every permission true —
    // except portal_search, which defaults OFF even for individuals and
    // must be explicitly granted (by the operator, or an org admin).
    account_type: 'individual',
    org: null, // { id, name, role: 'admin' | 'member' } | null
    permissions: { active: true, archived: true, bookmarks: true, projects: true, portal_search: false },
    pending_request: null, // { id, org_id, org_name, status, note, created_at, ... } | null
  },
});

let dbPromise;
let writeQueue = Promise.resolve();

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function readRaw() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(STATE_KEY);
    req.onsuccess = () => resolve(req.result || initialState());
    req.onerror = () => reject(req.error);
  });
}

async function writeRaw(value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, STATE_KEY);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getState() {
  const state = await readRaw();
  return { ...initialState(), ...state, settings: { ...initialState().settings, ...(state.settings || {}) } };
}

export function updateState(mutator) {
  const run = async () => {
    const current = await getState();
    const next = (await mutator(structuredClone(current))) || current;
    return writeRaw(next);
  };
  writeQueue = writeQueue.then(run, run);
  return writeQueue;
}

// Like getState(), but waits for every write already queued via updateState()
// to actually commit first. Plain getState() reads IndexedDB directly and can
// race an in-flight updateState() write (e.g. a bookmark toggle whose write
// hasn't landed yet), reading a stale/incomplete snapshot. Anything that
// pushes local state elsewhere (pushUserData) must use this instead, or it
// can ship an incomplete payload that then wipes the missing data on the
// next pull.
export function getQueuedState() {
  const run = () => getState();
  writeQueue = writeQueue.then(run, run);
  return writeQueue;
}

export async function replaceState(value) {
  const clean = { ...initialState(), ...(value || {}), schemaVersion: 1 };
  return updateState(() => clean);
}

export function nextId(rows) {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
}
