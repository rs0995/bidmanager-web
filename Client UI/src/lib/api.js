import { getState, getQueuedState, nextId, updateState } from './db.js';
import { useAppStore } from './store';
import { timeRemaining } from './utils';

const desktop = () => window.bidmanagerDesktop;
const DEFAULT_SERVER_URL = 'https://161.118.170.233.sslip.io';
const leaf = (value) => String(value || 'Project').replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Project';
const joinPath = (...parts) => parts.filter(Boolean).join('\\').replace(/[\\/]+/g, '\\');
const valueNumber = (value) => Number(String(value || '').replace(/[^0-9.]/g, '')) || 0;

function filterRows(rows, search, fields) {
  const q = String(search || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => fields.some((key) => String(row[key] ?? '').toLowerCase().includes(q)));
}

function normalizeServerUrl(value) {
  const raw = String(value || DEFAULT_SERVER_URL).trim().replace(/\/+$/, '');
  let parsed;
  try { parsed = new URL(raw); } catch (_) { throw new Error('Enter a valid backend URL.'); }
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Backend URL must use HTTP or HTTPS.');
  return raw;
}

// "Remember me" off at sign-in keeps the token here only (session-only, never
// written to IndexedDB) instead of in settings.auth_token — getState()/
// getSettings() overlay it so the rest of the app never needs to care which
// case it is. Cleared on sign-out and on a "remember me" sign-in (which
// persists to settings instead).
let sessionAuth = null;

async function connection(overrides = {}) {
  const settings = await getState().then((state) => state.settings);
  return {
    server_url: normalizeServerUrl(overrides.server_url ?? settings.server_url),
    // Login issues a personal session token (Server UI/server/client_api.py
    // require_client_user) that travels in the x-client-key header — a
    // per-user token, not a shared app secret.
    auth_token: String(overrides.auth_token ?? sessionAuth?.auth_token ?? settings.auth_token ?? '').trim(),
  };
}

// A rejected/expired/revoked token surfaces as a 401/403 from any /client/*
// call. main.jsx's QueryCache/MutationCache onError hook catches this by name
// and signs the device out, so App re-renders into SignInScreen.
class AuthError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'AuthError';
    this.reason = reason || 'unauthorized';
  }
}

async function requestClient(route, options = {}, overrides = {}, { requireAuth = true } = {}) {
  if (!String(route).startsWith('/client/')) throw new Error('Only /client/* API routes are allowed.');
  const config = await connection(overrides);
  if (requireAuth && !config.auth_token) throw new AuthError('Sign in to continue.', 'unauthorized');
  const method = String(options.method || 'GET').toUpperCase();
  if (desktop()?.clientApiRequest) {
    const result = await desktop().clientApiRequest({
      baseUrl: config.server_url,
      clientKey: config.auth_token,
      route,
      method,
      body: options.body,
    });
    if (!result?.ok) {
      if (result?.status === 401 || result?.status === 403) throw new AuthError(result?.message || 'Sign in again.', result?.reason);
      throw new Error(result?.message || 'Could not reach the client API.');
    }
    return result.data;
  }
  const headers = { Accept: 'application/json' };
  if (config.auth_token) headers['x-client-key'] = config.auth_token;
  const fetchOptions = { method, headers };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(options.body ?? {});
  }
  const response = await fetch(`${config.server_url}${route}`, fetchOptions);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.detail;
    const message = Array.isArray(detail)
      ? detail.map((d) => d.msg || d.type).join('; ')
      : (detail && typeof detail === 'object' ? detail.message : detail)
        || `Client API returned HTTP ${response.status}.`;
    if (response.status === 401 || response.status === 403) throw new AuthError(message, detail?.reason);
    throw new Error(message);
  }
  return payload;
}

function normalizeTender(row) {
  return {
    ...row,
    org_chain: row.org_chain ?? row.organization ?? '',
    tender_category: row.tender_category ?? row.category ?? '',
  };
}

async function downloadServerOrganizations(overrides = {}) {
  const organizations = [];
  let page = 1;
  let pages = 1;
  do {
    const payload = await requestClient(
      `/client/organizations?page=${page}&page_size=100`, {}, overrides,
    );
    if (!payload || !Array.isArray(payload.items)) break;
    organizations.push(...payload.items.map((row) => ({
      id: row.id,
      website_id: row.website_id,
      name: row.name,
      website_name: row.website_name || '',
      tender_count: Number(row.tender_count) || 0,
      scrape_enabled: Boolean(row.scrape_enabled),
    })));
    pages = Math.max(0, Number(payload.pages) || 0);
    page += 1;
    if (page > 1000) break;
  } while (page <= pages);
  return organizations;
}

async function downloadServerSnapshot(overrides = {}) {
  await requestClient('/client/health', {}, overrides);
  const tenders = [];
  let page = 1;
  let pages = 1;
  do {
    const payload = await requestClient(
      `/client/tenders?page=${page}&page_size=100&sort_by=id&sort_order=asc`, {}, overrides,
    );
    if (!payload || !Array.isArray(payload.items)) throw new Error('Invalid tender-list response from server.');
    tenders.push(...payload.items.map(normalizeTender));
    pages = Math.max(0, Number(payload.pages) || 0);
    page += 1;
    if (page > 1000) throw new Error('Server pagination exceeded the safe import limit.');
  } while (page <= pages);
  const serverStats = await requestClient('/client/stats', {}, overrides);
  // Best-effort: the org cache only feeds the bookmark->id lookup for cloud
  // sync (see pushUserData) — a failure here shouldn't block a tender sync.
  const organizations = await downloadServerOrganizations(overrides).catch(() => []);
  const websiteMap = new Map();
  tenders.forEach((tender) => {
    const id = Number(tender.website_id);
    if (!Number.isFinite(id)) return;
    const current = websiteMap.get(id) || { id, name: tender.website_name || `Website ${id}`, orgs: 0, active_tenders: 0, selected_orgs: 0 };
    if (!tender.is_archived) current.active_tenders += 1;
    websiteMap.set(id, current);
  });
  const websites = [...websiteMap.values()].map((website) => ({
    ...website,
    orgs: new Set(tenders.filter((t) => Number(t.website_id) === website.id).map((t) => t.org_chain).filter(Boolean)).size,
  }));
  return { websites, tenders, organizations, server_stats: serverStats };
}

// Wraps updateState() for mutations that touch cloud-synced data (bookmarks,
// templates, projects, checklist) — after the local write lands, it schedules
// a near-instant push to /client/sync so other devices pick it up right away.
// The short delay (rather than 0) still collapses a tight synchronous burst
// (e.g. creating N checklist items when applying a template) into one push
// instead of N, since each call clears/reschedules the same timer.
//
// Crucially, `_syncPushPending` only clears once the push actually SUCCEEDS —
// this backend/proxy is known to intermittently 502/timeout (see the
// Downloads panel's own retry logic), and a push that fails must stay
// "pending" so a later pull can't mistake the missing edit for something
// that was never made. A failed push re-arms itself with capped backoff
// instead of being silently dropped.
const SYNC_PUSH_DELAY_MS = 150;
const SYNC_PUSH_MAX_DELAY_MS = 30000;
let _syncPushTimer = null;
let _syncPushPending = false;
// The last /client/sync blob the server handed us, and its `updated_at`.
// Used to compute the `removed` delta on push AND as `base_updated_at` for
// the server's per-item concurrency check ("any online edit beats an offline
// edit"). PERSISTED to settings so an offline delete made before an app
// restart can still be expressed on the next push. If this is lost (fresh
// install / cleared data), `base_updated_at` is 0 and the server's copy wins
// outright on the next pull.
let _lastServerBlob = {};
let _baseUpdatedAt = 0;
let _baselineLoaded = false;
async function loadSyncBaseline() {
  if (_baselineLoaded) return;
  _baselineLoaded = true;
  try {
    const s = (await getState()).settings || {};
    if (s.lastServerSyncBlob && typeof s.lastServerSyncBlob === 'object' && Object.keys(_lastServerBlob).length === 0) {
      _lastServerBlob = s.lastServerSyncBlob;
    }
    if (!_baseUpdatedAt) _baseUpdatedAt = Number(s.lastServerSyncAt) || 0;
  } catch { /* first run — no settings yet */ }
}
async function saveSyncBaseline(blob, updatedAt) {
  _lastServerBlob = (blob && typeof blob === 'object') ? blob : {};
  const ts = Number(updatedAt);
  if (Number.isFinite(ts) && ts > 0) _baseUpdatedAt = ts;
  _baselineLoaded = true;
  await updateState((state) => {
    state.settings = { ...state.settings, lastServerSyncBlob: _lastServerBlob, lastServerSyncAt: _baseUpdatedAt };
    return state;
  });
}
const _idSet = (values) => new Set((values || []).map(Number).filter(Number.isFinite));
const _rowIdSet = (rows) => new Set((rows || []).map((r) => Number(r?.id)).filter(Number.isFinite));
// `_syncPushPending` alone doesn't survive an app restart — it's just a JS
// module variable, gone the instant the process exits. If a push fails and
// the app is closed before a retry succeeds, that in-memory flag resets to
// false on next launch even though the edit was never actually confirmed by
// the server — nothing then knows to retry it until the user happens to
// touch that same data again. `state.settings.pendingSyncPush` is the
// durable twin of that flag: written to IndexedDB the moment an edit is
// made, cleared only once a push actually succeeds, and checked on every
// flush (including the very first one after a restart) so an unconfirmed
// edit from a previous session gets retried automatically.
async function markSyncPushConfirmed() {
  await updateState((state) => { state.settings = { ...state.settings, pendingSyncPush: false }; return state; });
}
function armSyncPushTimer(delay) {
  clearTimeout(_syncPushTimer);
  _syncPushTimer = setTimeout(async () => {
    try {
      await api.pushUserData();
      _syncPushPending = false;
      await markSyncPushConfirmed();
    } catch {
      armSyncPushTimer(Math.min(delay * 2, SYNC_PUSH_MAX_DELAY_MS));
    }
  }, delay);
}
function updateSyncedState(mutator) {
  const result = updateState((state) => {
    const next = mutator(state) || state;
    next.settings = { ...next.settings, pendingSyncPush: true };
    return next;
  });
  _syncPushPending = true;
  armSyncPushTimer(SYNC_PUSH_DELAY_MS);
  return result;
}

// A pull (pullUserData) overwrites local state wholesale from the server —
// if a push from updateSyncedState is still pending (scheduled OR failed and
// awaiting retry — this session's or, via the persisted flag, a previous
// one's) when that happens, the pull would resurrect whatever the local edit
// just removed/added (e.g. a deleted checklist item, or a newly bookmarked
// tender that never actually reached the server), then the stale timer would
// push that resurrection right back. Flushing — and actually confirming
// success — first closes that race. If the flush itself fails, this throws
// so pullUserData can skip overwriting local state this round entirely,
// rather than trust a server copy known to be missing this device's still-
// unconfirmed edit.
async function flushPendingSyncPush() {
  const persisted = (await getQueuedState()).settings?.pendingSyncPush;
  if (!_syncPushPending && !persisted) return;
  clearTimeout(_syncPushTimer);
  try {
    await api.pushUserData();
    _syncPushPending = false;
    await markSyncPushConfirmed();
  } catch (error) {
    armSyncPushTimer(SYNC_PUSH_DELAY_MS);
    throw error;
  }
}

// api.js is a plain module with no React Query access, but a background job
// completing (syncTenderDocuments/patchTender) can change fields a mounted
// query is already showing (e.g. a tender's has_documents). This lets App.jsx
// subscribe once and invalidate the right queries without api.js importing
// react-query at all.
const _tendersChangedListeners = new Set();
function notifyTendersChanged() {
  _tendersChangedListeners.forEach((fn) => { try { fn(); } catch { /* listener's problem, not ours */ } });
}

export const api = {
  defaultServerUrl: DEFAULT_SERVER_URL,

  // Subscribe to "a tender's local fields changed outside of a React
  // mutation" (e.g. a background download job completing). Returns an
  // unsubscribe function.
  onTendersChanged: (fn) => {
    _tendersChangedListeners.add(fn);
    return () => _tendersChangedListeners.delete(fn);
  },

  // Call once at app startup: retries any edit left unconfirmed by a
  // previous session (see the pendingSyncPush comment above) instead of
  // waiting for the next periodic sync or manual action to stumble onto it.
  flushPendingSyncPush: () => flushPendingSyncPush(),

  // ── Auth ───────────────────────────────────────────────────────────
  registerAccount: (input, overrides = {}) => requestClient(
    '/client/auth/register',
    { method: 'POST', body: { email: input.email, password: input.password, display_name: input.display_name || '' } },
    overrides,
    { requireAuth: false },
  ),
  loginAccount: (input, overrides = {}) => requestClient(
    '/client/auth/login',
    { method: 'POST', body: { email: input.email, password: input.password } },
    overrides,
    { requireAuth: false },
  ),
  logoutAccount: (overrides = {}) => requestClient('/client/auth/logout', { method: 'POST' }, overrides),
  // mode: 'login' | 'register'. remember=false keeps the token in memory only
  // (sessionAuth) instead of persisting it to settings, so the account isn't
  // still signed in after the app restarts.
  signIn: async (input, mode = 'login', remember = true) => {
    const response = mode === 'register' ? await api.registerAccount(input) : await api.loginAccount(input);
    const auth = {
      auth_token: response.token,
      user_email: response.email,
      user_id: response.user_id,
      display_name: response.display_name || '',
    };
    if (remember) { sessionAuth = null; await api.updateSettings(auth); }
    else sessionAuth = auth;
    await api.pullUserData().catch(() => {});
    return response;
  },
  signOut: async () => {
    try { await api.logoutAccount(); } catch { /* best-effort */ }
    sessionAuth = null;
    await api.updateSettings({ auth_token: '', user_email: '', user_id: null, display_name: '' });
  },
  changePassword: (input, overrides = {}) => requestClient(
    '/client/auth/change-password',
    { method: 'POST', body: { current_password: input.current_password, new_password: input.new_password } },
    overrides,
  ),

  health: (overrides = {}) => requestClient('/client/health', {}, overrides),
  testConnection: (overrides = {}) => requestClient('/client/health', {}, overrides),
  getTenderDetail: (id, overrides = {}) => requestClient(`/client/tenders/${Number(id)}`, {}, overrides),
  listTenderDocuments: (id, params = {}, overrides = {}) => {
    const query = new URLSearchParams({
      page: String(params.page || 1),
      page_size: String(params.page_size || 25),
      sort_by: String(params.sort_by || 'downloaded_at'),
      sort_order: String(params.sort_order || 'desc'),
    });
    if (params.file_type) query.set('file_type', params.file_type);
    return requestClient(`/client/tenders/${Number(id)}/documents?${query}`, {}, overrides);
  },
  requestDocumentDownload: (tenderId, documentId, overrides = {}) => {
    const docId = Number(documentId);
    if (!Number.isInteger(docId) || docId <= 0) throw new Error('Invalid document id');
    return requestClient(
      `/client/tenders/${Number(tenderId)}/download-request`,
      { method: 'POST', body: { document_id: docId } },
      overrides,
    );
  },
  // Kicks off the server-side scrape/download job for a tender that has no
  // documents yet (see Server UI/server/client_api.py request-download).
  requestTenderDownloadJob: (tenderId, overrides = {}) => requestClient(
    `/client/tenders/${Number(tenderId)}/request-download`,
    { method: 'POST', body: {} },
    overrides,
  ),
  getTenderDownloadStatus: (tenderId, jobId, overrides = {}) => requestClient(
    `/client/tenders/${Number(tenderId)}/download-status?job_id=${encodeURIComponent(jobId)}`,
    {}, overrides,
  ),

  // ── Document download tracking (local-first: one cached row per server
  // document, plus a locally-issued placeholder row while a whole-tender
  // request has no document yet). Every UI button reads client_status/
  // local_path/downloadable straight off these rows — never a derived count.
  listAllDocuments: async () => (await getState()).documents,
  listDocuments: async (tenderDbId) => (
    (await getState()).documents.filter((row) => Number(row.tender_db_id) === Number(tenderDbId))
  ),
  listPendingDocuments: async () => (
    (await getState()).documents.filter((row) => row.client_status === 'requested')
  ),
  upsertDocument: async (patch) => {
    if (!patch || patch.id == null) throw new Error('upsertDocument requires an id.');
    let result;
    await updateState((state) => {
      const idx = state.documents.findIndex((row) => row.id === patch.id);
      const base = idx >= 0 ? state.documents[idx] : {
        file_name: '', file_type: 'document', size_bytes: 0, downloadable: false,
        client_status: 'synced', local_path: null, requested_at: null, downloaded_at: null, error: null,
      };
      result = { ...base, ...patch, updated_at: new Date().toISOString() };
      if (idx >= 0) state.documents[idx] = result; else state.documents.push(result);
      return state;
    });
    return result;
  },
  removeDocument: async (id) => updateState((state) => {
    state.documents = state.documents.filter((row) => row.id !== id);
    return state;
  }),
  // Pulls the real document list for a tender and merges it into the local
  // cache, keyed by server document id. Local-only fields already set on a
  // matching row (client_status/local_path/etc.) are preserved. If the server
  // still has nothing for this tender, the local placeholder row (if any) is
  // left untouched rather than being wiped.
  syncTenderDocuments: async (tender, params = {}, overrides = {}) => {
    const tenderDbId = Number(tender.id);
    const payload = await api.listTenderDocuments(tenderDbId, params, overrides);
    const serverRows = payload.items || [];
    if (serverRows.length === 0) return serverRows;
    await updateState((state) => {
      const others = state.documents.filter((row) => Number(row.tender_db_id) !== tenderDbId);
      const existingById = new Map(
        state.documents.filter((row) => Number(row.tender_db_id) === tenderDbId).map((row) => [row.id, row])
      );
      const merged = serverRows.map((row) => {
        const existing = existingById.get(row.id);
        return {
          id: row.id,
          tender_db_id: tenderDbId,
          tender_id: tender.tender_id || existing?.tender_id || '',
          tender_title: tender.title || existing?.tender_title || '',
          file_name: row.name,
          file_type: row.type,
          size_bytes: row.size_bytes,
          downloadable: row.downloadable,
          client_status: existing && existing.client_status !== 'synced' ? existing.client_status : 'synced',
          local_path: existing?.local_path || null,
          requested_at: existing?.requested_at || null,
          downloaded_at: existing?.downloaded_at || null,
          updated_at: new Date().toISOString(),
          error: existing?.error || null,
        };
      });
      // Real rows now exist server-side, so the locally-issued placeholder
      // request row (negative id) for this tender is superseded.
      state.documents = [...others, ...merged];
      // Also flip the tender row itself so the "Request"/"Download" pill
      // updates immediately, without waiting for a full manual Sync.
      state.tenders = state.tenders.map((row) => (
        row.id === tenderDbId ? { ...row, has_documents: true, document_count: merged.length } : row
      ));
      return state;
    });
    notifyTendersChanged();
    return serverRows;
  },
  // "Request Download" — asks the server to fetch a tender with no documents
  // yet. Records a local placeholder row so the button becomes disabled
  // "Download Requested" and stays that way across restarts, then polls the
  // job in the background and refreshes the real document list once it lands.
  requestTenderDownload: async (tender, overrides = {}) => {
    const { job_id: jobId } = await api.requestTenderDownloadJob(tender.id, overrides);
    const placeholder = await api.upsertDocument({
      id: -Number(tender.id),
      tender_db_id: Number(tender.id),
      tender_id: tender.tender_id || '',
      tender_title: tender.title || '',
      file_name: '', file_type: '', size_bytes: 0, downloadable: false,
      client_status: 'requested',
      local_path: null,
      job_id: jobId,
      requested_at: new Date().toISOString(),
      downloaded_at: null,
      error: null,
    });
    api.pollTenderDownloadJob(tender, jobId, overrides, 0);
    return placeholder;
  },
  // Fire-and-forget: polls the server download job every 15s (capped at ~30
  // minutes, to tolerate the server running jobs one-at-a-time by default —
  // see max_concurrent_sessions in Server UI/server/api_server.py) until it
  // completes or fails, then refreshes this tender's real document list or
  // marks the placeholder row failed with the server's reason. A single
  // transient poll error (network blip, one-off 502 from whatever sits in
  // front of the server) doesn't fail the job outright — only 3 in a row do,
  // so a momentary hiccup can't kill an otherwise-fine download.
  pollTenderDownloadJob: async (tender, jobId, overrides = {}, attempt = 0, consecutiveErrors = 0) => {
    const MAX_ATTEMPTS = 120;
    const MAX_CONSECUTIVE_ERRORS = 3;
    try {
      const { status, error } = await api.getTenderDownloadStatus(tender.id, jobId, overrides);
      if (status === 'completed') {
        await api.removeDocument(-Number(tender.id));
        await api.syncTenderDocuments(tender, {}, overrides);
        return;
      }
      if (status === 'failed') {
        await api.upsertDocument({ id: -Number(tender.id), client_status: 'failed', error: error || 'Download failed.' });
        return;
      }
      if (attempt >= MAX_ATTEMPTS) {
        await api.upsertDocument({ id: -Number(tender.id), client_status: 'failed', error: 'Timed out waiting for the server.' });
        return;
      }
      setTimeout(() => api.pollTenderDownloadJob(tender, jobId, overrides, attempt + 1, 0), 15000);
    } catch (error) {
      if (consecutiveErrors + 1 >= MAX_CONSECUTIVE_ERRORS) {
        await api.upsertDocument({ id: -Number(tender.id), client_status: 'failed', error: error?.message || String(error) });
        return;
      }
      setTimeout(() => api.pollTenderDownloadJob(tender, jobId, overrides, attempt + 1, consecutiveErrors + 1), 15000);
    }
  },
  // Call once at app startup: the setTimeout chain in pollTenderDownloadJob only
  // lives as long as the page/app stays open, so a restart while a request is
  // still 'requested' needs to re-attach polling to whatever job_id was saved
  // on the placeholder row — otherwise the pill would stay "Requested…" forever.
  resumePendingDownloadJobs: async (overrides = {}) => {
    const pending = await api.listPendingDocuments();
    for (const placeholder of pending) {
      if (!placeholder.job_id) continue;
      const tender = {
        id: placeholder.tender_db_id,
        tender_id: placeholder.tender_id,
        title: placeholder.tender_title,
      };
      api.pollTenderDownloadJob(tender, placeholder.job_id, overrides, 0);
    }
  },
  // "Download" — mint a signed URL for an already-available document, then
  // save it to disk via the Electron IPC bridge (or fall back to a plain
  // browser download when running outside Electron, where the destination
  // folder can't be controlled).
  downloadDocument: async (doc, overrides = {}) => {
    // tender_db_id/tender_id/tender_title travel on every patch this function
    // makes, not just the caller's own upsert — otherwise a document row with
    // no prior syncTenderDocuments/requestTenderDownload row behind it
    // (upsertDocument's default base carries none of these) ends up titleless
    // in the Downloads panel ("Untitled tender") and, missing tender_db_id,
    // invisible to the downloadedTenderIds ledger — so the tender's pill
    // never flips to "Downloaded" even though the file downloaded fine.
    const identity = {};
    if (doc.tender_db_id != null) identity.tender_db_id = doc.tender_db_id;
    if (doc.tender_id) identity.tender_id = doc.tender_id;
    if (doc.tender_title) identity.tender_title = doc.tender_title;
    await api.upsertDocument({ id: doc.id, ...identity, client_status: 'downloading', error: null });
    try {
      const { url } = await api.requestDocumentDownload(doc.tender_db_id, doc.id, overrides);
      const bridge = desktop();
      if (bridge?.downloadFile) {
        const settings = (await getState()).settings;
        const parentDir = String(settings.parent_dir || '').trim();
        if (!parentDir) throw new Error('Set a parent folder in Settings before downloading files.');
        const destinationPath = joinPath(parentDir, 'Tender_Downloads', leaf(doc.tender_id), leaf(doc.file_name));
        const result = await bridge.downloadFile({ url, destinationPath });
        if (!result?.ok) throw new Error(result?.message || 'Download failed.');
        return api.upsertDocument({
          id: doc.id, ...identity, client_status: 'downloaded', local_path: result.path,
          downloaded_at: new Date().toISOString(), error: null,
        });
      }
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = doc.file_name || '';
      anchor.rel = 'noopener';
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return api.upsertDocument({
        id: doc.id, ...identity, client_status: 'downloaded', local_path: null,
        downloaded_at: new Date().toISOString(), error: null,
      });
    } catch (error) {
      await api.upsertDocument({ id: doc.id, ...identity, client_status: 'failed', error: error?.message || String(error) });
      throw error;
    }
  },
  // Folder a tender's downloaded files land in — same construction
  // downloadDocument uses, exposed so callers (e.g. the Downloads panel)
  // don't need to duplicate the leaf/joinPath path logic.
  getTenderDownloadFolder: async (tenderId) => {
    const settings = (await getState()).settings;
    const parentDir = String(settings.parent_dir || '').trim();
    if (!parentDir) throw new Error('Set a parent folder in Settings before opening downloads.');
    return joinPath(parentDir, 'Tender_Downloads', leaf(tenderId));
  },

  listWebsites: async () => (await getState()).websites,
  listOrganizations: async () => (await getState()).organizations || [],
  listBookmarkedOrgs: async () => (await getState()).bookmarkedOrgs || [],
  toggleOrgBookmark: async (orgChain) => {
    let result;
    await updateSyncedState((state) => {
      const set = new Set(state.bookmarkedOrgs || []);
      if (set.has(orgChain)) set.delete(orgChain); else set.add(orgChain);
      state.bookmarkedOrgs = [...set];
      result = state.bookmarkedOrgs;
      return state;
    });
    return result;
  },
  countBookmarkedTenders: async () => (await getState()).tenders.filter((row) => row.is_bookmarked).length,
  listTenders: async (websiteId, params = {}) => {
    let rows = (await getState()).tenders;
    if (websiteId != null) rows = rows.filter((row) => Number(row.website_id) === Number(websiteId));
    if (params.archived !== undefined) rows = rows.filter((row) => Boolean(row.is_archived) === Boolean(params.archived));
    if (params.bookmarked !== undefined) rows = rows.filter((row) => Boolean(row.is_bookmarked) === Boolean(params.bookmarked));
    rows = filterRows(rows, params.search, ['tender_id', 'title', 'org_chain', 'location', 'tender_category']);
    return rows.slice(0, Number(params.limit) || rows.length);
  },
  patchTender: async (id, patch) => {
    let result;
    await updateSyncedState((state) => {
      state.tenders = state.tenders.map((row) => row.id === id ? (result = { ...row, ...patch }) : row);
      return state;
    });
    notifyTendersChanged();
    return result;
  },

  listProjects: async (search = '', status = '') => {
    let rows = (await getState()).projects;
    if (status) rows = rows.filter((row) => String(row.status || 'Active').toLowerCase() === String(status).toLowerCase());
    return filterRows(rows, search, ['title', 'client_name', 'source_tender_id', 'description']);
  },
  createProject: async (data) => {
    const sourceTenderId = String(data?.source_tender_id || '').trim();
    if (sourceTenderId) {
      const existing = (await getState()).projects.find((row) => String(row.source_tender_id || '').trim() === sourceTenderId);
      if (existing) throw new Error('Tender already added to Projects.');
    }
    let result;
    await updateSyncedState((state) => {
      result = { id: nextId(state.projects), folder_path: null, ...data, status: data.status || 'Active' };
      state.projects.push(result);
      return state;
    });
    return result;
  },
  getProject: async (id) => {
    const result = (await getState()).projects.find((row) => row.id === Number(id));
    if (!result) throw new Error('Project not found.');
    return result;
  },
  updateProject: async (id, patch) => {
    let result;
    await updateSyncedState((state) => {
      state.projects = state.projects.map((row) => row.id === Number(id) ? (result = { ...row, ...patch }) : row);
      return state;
    });
    return result;
  },
  archiveProject: (id) => api.updateProject(id, { status: 'Archived' }),
  deleteProject: async (id) => updateSyncedState((state) => {
    state.projects = state.projects.filter((row) => row.id !== Number(id));
    state.checklist = state.checklist.filter((row) => row.project_id !== Number(id));
    return state;
  }),
  getProjectsRootFolder: async (archived = false) => {
    const settings = (await getState()).settings;
    const name = archived ? 'Archived Projects' : 'My_Tender_Projects';
    return { root_folder: settings.parent_dir ? joinPath(settings.parent_dir, name) : '' };
  },
  ensureProjectFolder: async (id) => {
    const project = await api.getProject(id);
    if (project.folder_path) return { ok: true, folder_path: project.folder_path };
    const root = (await api.getProjectsRootFolder(false)).root_folder;
    if (!root) return { ok: false, folder_path: '', message: 'Choose a parent folder in Settings.' };
    const folderPath = joinPath(root, `${id} - ${leaf(project.title)}`);
    const bridge = desktop();
    if (bridge?.ensureProjectFolders) {
      const made = await bridge.ensureProjectFolders(folderPath);
      if (!made?.ok) throw new Error(made?.message || 'Could not create project folder.');
    }
    await api.updateProject(id, { folder_path: folderPath });
    return { ok: true, folder_path: folderPath };
  },
  restoreProjectsFromFolders: async () => ({ root_folder: (await api.getProjectsRootFolder()).root_folder, scanned_folders: 0, created_projects: 0, updated_projects: 0, restored_checklist_items: 0 }),

  listChecklist: async (projectId) => (await getState()).checklist.filter((row) => row.project_id === Number(projectId)).sort((a, b) => a.sr_no - b.sr_no),
  createChecklistItem: async (projectId, data) => {
    let result;
    await updateSyncedState((state) => {
      const siblings = state.checklist.filter((row) => row.project_id === Number(projectId));
      result = { id: nextId(state.checklist), project_id: Number(projectId), sr_no: data.sr_no || siblings.length + 1, req_file_name: '', description: '', subfolder: 'Ready Docs', linked_file_path: '', status: 'Pending', ...data };
      state.checklist.push(result);
      return state;
    });
    return result;
  },
  updateChecklistItem: async (id, patch) => updateSyncedState((state) => {
    state.checklist = state.checklist.map((row) => row.id === Number(id) ? { ...row, ...patch } : row);
    return state;
  }),
  deleteChecklistItem: async (id) => updateSyncedState((state) => {
    state.checklist = state.checklist.filter((row) => row.id !== Number(id));
    return state;
  }),

  listTemplates: async (organization = '') => filterRows((await getState()).templates, organization, ['organization']),
  createTemplate: async (data) => {
    let result;
    await updateSyncedState((state) => {
      result = { id: nextId(state.templates), template_no: null, description: '', notes: '', ...data };
      state.templates.push(result);
      return state;
    });
    return result;
  },
  updateTemplate: async (id, patch) => {
    let result;
    await updateSyncedState((state) => {
      state.templates = state.templates.map((row) => row.id === Number(id) ? (result = { ...row, ...patch }) : row);
      return state;
    });
    return result;
  },
  deleteTemplate: async (id) => updateSyncedState((state) => {
    state.templates = state.templates.filter((row) => row.id !== Number(id));
    state.templateItems = state.templateItems.filter((row) => row.template_id !== Number(id));
    return state;
  }),
  listTemplateItems: async (templateId) => (await getState()).templateItems.filter((row) => row.template_id === Number(templateId)).sort((a, b) => a.sr_no - b.sr_no),
  createTemplateItem: async (templateId, data) => {
    let result;
    await updateSyncedState((state) => {
      const siblings = state.templateItems.filter((row) => row.template_id === Number(templateId));
      result = { id: nextId(state.templateItems), template_id: Number(templateId), sr_no: siblings.length + 1, req_file_name: '', description: '', subfolder: 'Ready Docs', ...data };
      state.templateItems.push(result);
      return state;
    });
    return result;
  },
  deleteTemplateItem: async (id) => updateSyncedState((state) => {
    state.templateItems = state.templateItems.filter((row) => row.id !== Number(id));
    return state;
  }),
  saveProjectAsTemplate: async (projectId, data) => {
    const template = await api.createTemplate(data);
    const items = await api.listChecklist(projectId);
    for (const item of items) await api.createTemplateItem(template.id, item);
    return template;
  },
  applyTemplateToProject: async (projectId, templateId) => {
    const items = await api.listTemplateItems(templateId);
    for (const item of items) await api.createChecklistItem(projectId, item);
    return { ok: true, added: items.length };
  },

  dashboardStats: async () => {
    const state = await getState();
    const active = state.tenders.filter((row) => !row.is_archived);
    const activeProjects = state.projects.filter((row) => String(row.status || 'Active').toLowerCase() === 'active');
    // Only surface deadlines for tenders the user has actually acted on
    // (bookmarked, or already turned into a project) — not every closing
    // tender, which is what the "Closing < 7 Days" stat card is for instead.
    const activeProjectTenderIds = new Set(activeProjects.map((row) => row.source_tender_id).filter(Boolean));
    const upcoming = active
      .filter((row) => row.closing_date && (row.is_bookmarked || activeProjectTenderIds.has(row.tender_id)))
      .slice().sort((a, b) => String(a.closing_date).localeCompare(String(b.closing_date))).slice(0, 12);
    const bookmarkedItems = state.tenders.filter((row) => row.is_bookmarked).slice().sort((a, b) => String(a.closing_date || '').localeCompare(String(b.closing_date || ''))).slice(0, 6);
    const closingSoon = active.filter((row) => {
      const r = timeRemaining(row.closing_date);
      return !r.expired && r.totalDays >= 0 && r.totalDays <= 7;
    }).length;
    return {
      active_tenders: active.length,
      archived_tenders: state.tenders.length - active.length,
      active_projects: activeProjects.length,
      bookmarked_tenders: state.tenders.filter((row) => row.is_bookmarked).length,
      closing_soon: closingSoon,
      total_pipeline_value: state.projects.reduce((sum, row) => sum + valueNumber(row.project_value), 0),
      websites: state.websites.map((site) => {
        const siteTenders = active.filter((row) => Number(row.website_id) === Number(site.id));
        const derivedOrgs = new Set(siteTenders.map((row) => String(row.org_chain || '').trim()).filter(Boolean)).size;
        return {
          id: site.id,
          name: site.name,
          orgs: Number(site.orgs ?? site.organization_count) || derivedOrgs,
          active_tenders: siteTenders.length,
          selected_orgs: Number(site.selected_orgs) || 0,
        };
      }),
      upcoming_deadlines: upcoming,
      bookmarked_items: bookmarkedItems,
      bids_under_preparation: activeProjects.slice().sort((a, b) => String(a.deadline || '').localeCompare(String(b.deadline || ''))).slice(0, 6),
    };
  },

  getSettings: async () => {
    const settings = (await getState()).settings;
    return sessionAuth ? { ...settings, ...sessionAuth } : settings;
  },
  ensureParentFolders: async (parentDir) => {
    const dir = String(parentDir || '').trim();
    if (!dir) return { ok: false, message: 'Choose a parent folder first.' };
    const bridge = desktop();
    if (!bridge?.ensureDirectory) return { ok: false, message: 'Folder creation is available in the desktop app.' };
    const names = ['Tender_Downloads', 'My_Tender_Projects', 'Archived Projects', 'Checklist_Templates'];
    for (const name of names) {
      const result = await bridge.ensureDirectory(joinPath(dir, name));
      if (!result?.ok) return { ok: false, message: result?.message || `Could not create ${name}.` };
    }
    return { ok: true };
  },
  updateSettings: async (patch) => updateState((state) => { state.settings = { ...state.settings, ...patch }; return state; }),
  listServerStorage: async (relPath = '') => {
    const state = await getState();
    const linked = state.checklist.filter((row) => row.linked_file_path).map((row) => ({
      name: String(row.linked_file_path).split(/[\\/]/).pop(), rel_path: row.linked_file_path, is_dir: false, size_bytes: 0, modified_at: '',
    }));
    return { root_folder: state.settings.parent_dir || '', current_rel_path: relPath, parent_rel_path: '', items: linked };
  },
  deleteServerFolder: async () => { throw new Error('Folder deletion is available through the operating system.'); },

  syncFromServer: async (overrides = {}) => {
    const config = await connection(overrides);
    const snapshot = await downloadServerSnapshot(config);
    let result;
    let changesSince = 0;
    const notificationsToEmit = [];
    // New tenders under a bookmarked org are collected here instead of
    // notified immediately, so a website's first-ever big batch (or just an
    // org with a lot of activity) can collapse into one message instead of
    // one per tender — see the post-loop flush below.
    const newTendersByOrg = new Map();
    await updateState((state) => {
      const bookmarks = new Map(state.tenders.map((row) => [String(row.tender_id || row.id), Boolean(row.is_bookmarked)]));
      const previousById = new Map(state.tenders.map((row) => [String(row.tender_id || row.id), row]));
      const bookmarkedOrgsSet = new Set(state.bookmarkedOrgs || []);
      changesSince = Number(state.settings?.last_changes_at) || 0;
      state.websites = Array.isArray(snapshot.websites) ? snapshot.websites : state.websites;
      state.organizations = Array.isArray(snapshot.organizations) ? snapshot.organizations : state.organizations;
      state.tenders = snapshot.tenders.map((row) => {
        const key = String(row.tender_id || row.id);
        const previous = previousById.get(key);
        if (previous?.is_bookmarked) {
          // closing_date is covered by the /client/changes feed below; the
          // local diff owns status + pre-bid/corrigendum, which the server's
          // tender_history snapshot doesn't track.
          if (previous.status !== row.status) {
            notificationsToEmit.push({ type: 'status', message: `"${row.title || row.tender_id}" status changed to ${row.status || 'unknown'}.` });
          }
          if ((Number(previous.prebid_count) || 0) !== (Number(row.prebid_count) || 0) || (Number(previous.corrigendum_count) || 0) !== (Number(row.corrigendum_count) || 0)) {
            notificationsToEmit.push({ type: 'prebid', message: `"${row.title || row.tender_id}" has a new pre-bid or corrigendum.` });
          }
        } else if (!previous && row.org_chain && bookmarkedOrgsSet.has(row.org_chain)) {
          const bucket = newTendersByOrg.get(row.org_chain) || [];
          bucket.push(row);
          newTendersByOrg.set(row.org_chain, bucket);
        }
        return { ...row, is_bookmarked: bookmarks.get(key) ?? false };
      });
      state.settings = {
        ...state.settings,
        server_url: config.server_url,
        last_sync_at: new Date().toISOString(),
      };
      result = { tenders: state.tenders.length, websites: state.websites.length, syncedAt: state.settings.last_sync_at };
      return state;
    });
    for (const [org, rows] of newTendersByOrg) {
      if (rows.length > 10) {
        notificationsToEmit.push({ type: 'new', message: `${rows.length} new tenders added under ${org}.` });
      } else {
        rows.forEach((row) => notificationsToEmit.push({ type: 'new', message: `"${row.title || row.tender_id}" added under ${org}.` }));
      }
    }
    // Server-recorded changes for this account's bookmarks (closing-date
    // changes + new tenders under bookmarked orgs) since our last cursor.
    // First sync (no cursor) only advances the cursor — no back-catalogue spam.
    try {
      const changes = await requestClient(`/client/changes?since=${changesSince}`, {}, overrides);
      if (changesSince > 0) {
        (changes?.tenders || []).forEach((t) => {
          if ((t.changed_fields || []).includes('closing_date')) {
            notificationsToEmit.push({ type: 'status', message: `"${t.title || `Tender #${t.id}`}" — closing date changed.` });
          }
        });
        for (const [org, items] of Object.entries(changes?.new_by_org || {})) {
          const list = items || [];
          if (list.length > 10) {
            notificationsToEmit.push({ type: 'new', message: `${list.length} new tenders added under ${org}.` });
          } else {
            list.forEach((t) => notificationsToEmit.push({ type: 'new', message: `"${t.title || t.tender_id}" added under ${org}.` }));
          }
        }
      }
      if (changes?.now) {
        await updateState((state) => {
          state.settings = { ...state.settings, last_changes_at: changes.now };
          return state;
        });
      }
    } catch { /* offline / endpoint unavailable — local diff still ran */ }
    if (notificationsToEmit.length) {
      const { addNotification } = useAppStore.getState();
      const time = new Date().toLocaleString();
      notificationsToEmit.forEach((n) => addNotification({ type: n.type, message: n.message, time }));
    }
    // Reconcile with whatever another device may have pushed since this
    // device's last sync. Runs after the notification diff above (which
    // intentionally uses this device's own pre-sync bookmark state).
    // pullUserData flushes any of this device's own not-yet-pushed edits
    // first, so they're never clobbered by the incoming server copy.
    await api.pullUserData(overrides).catch(() => {});
    return result;
  },

  // ── Cloud sync (bookmarks, templates, projects, checklist, tender column
  // prefs) ──────────────────────────────────────────────────────────────
  // Whole-state blob, last-push-wins: the server just stores whatever this
  // device last sent and hands it back verbatim. Device-specific fields
  // (folder_path, linked_file_path — local filesystem paths) never travel.
  // Bookmarking a tender/org also flips on a 24-hour server-side scrape
  // schedule for it (shared across every user who bookmarks it, and clubbed
  // per website into one scrape run), server-side (see Server UI/server/
  // client_api.py _reconcile_bookmark_schedules) — nothing to do here for that.
  pushUserData: async (overrides = {}) => {
    // getQueuedState (not plain getState) — waits for any in-flight
    // updateState write (e.g. a bookmark toggle, or syncFromServer's own
    // tender-replacement write) to actually commit first, so this never
    // ships an incomplete snapshot that then wipes the missing data on the
    // next pull. See Client UI/src/lib/db.js.
    const state = await getQueuedState();
    const orgIdByName = new Map((state.organizations || []).map((row) => [row.name, row.id]));
    const bookmarkedOrgs = state.bookmarkedOrgs || [];
    const { tendersTable, tendersView } = useAppStore.getState();
    const data = {
      bookmarks: state.tenders.filter((row) => row.is_bookmarked).map((row) => row.id),
      bookmarkedOrgs,
      bookmarkedOrgIds: bookmarkedOrgs.map((name) => orgIdByName.get(name)).filter((id) => Number.isFinite(id)),
      templates: state.templates,
      templateItems: state.templateItems,
      projects: state.projects.map(({ folder_path, ...rest }) => rest),
      checklist: state.checklist.map(({ linked_file_path, ...rest }) => rest),
      // Tenders column show/hide/order/width — see TendersPage in App.jsx.
      // Kept alongside the rest of this account's synced preferences so a
      // customized layout follows the login across devices, not just this
      // browser's localStorage.
      tenderColumnPrefs: {
        hiddenColumns: tendersTable.hiddenColumns || [],
        columnOrder: tendersTable.columnOrder || [],
        columnWidths: tendersView.tenderColumnWidths || {},
      },
    };
    // Removal delta: what the server last gave us but is gone locally now. The
    // server unions the rest, so this is the only way a delete propagates.
    await loadSyncBaseline();
    const localBookmarks = _idSet(data.bookmarks);
    const localOrgs = new Set(bookmarkedOrgs);
    const localProjectIds = _rowIdSet(data.projects);
    const localChecklistIds = _rowIdSet(data.checklist);
    const removed = {
      bookmarks: [...(_lastServerBlob.bookmarks || [])].map(Number).filter((id) => Number.isFinite(id) && !localBookmarks.has(id)),
      bookmarkedOrgs: [...(_lastServerBlob.bookmarkedOrgs || [])].filter((name) => !localOrgs.has(name)),
      projects: [...(_lastServerBlob.projects || [])].map((r) => Number(r?.id)).filter((id) => Number.isFinite(id) && !localProjectIds.has(id)),
      checklist: [...(_lastServerBlob.checklist || [])].map((r) => Number(r?.id)).filter((id) => Number.isFinite(id) && !localChecklistIds.has(id)),
    };
    const res = await requestClient(
      '/client/sync',
      { method: 'PUT', body: { data, removed, base_updated_at: _baseUpdatedAt } },
      overrides,
    );
    // Our push is now the latest known state — re-baseline so the next push
    // isn't treated as stale and the next `removed` diff is against what we
    // just sent.
    await saveSyncBaseline(data, res?.updated_at);
    return res;
  },
  pullUserData: async (overrides = {}) => {
    // Send any not-yet-pushed local edit first — otherwise this pull could
    // overwrite it with the server's still-stale copy (see flushPendingSyncPush).
    // If that flush itself fails (e.g. the backend is briefly 502ing), skip
    // this pull entirely rather than overwrite local state with a server
    // copy we already know is missing this device's unconfirmed edit — a
    // retry is already armed, and the next sync will try again.
    try {
      await flushPendingSyncPush();
    } catch {
      return {};
    }
    const response = await requestClient('/client/sync', {}, overrides);
    const data = response?.data || {};
    // The server is authoritative and flushPendingSyncPush() above already sent
    // this device's queued edits, so this is a straight REPLACE from the
    // server copy. Device-local filesystem paths (folder_path /
    // linked_file_path) are carried over by id.
    await updateState((state) => {
      if (Array.isArray(data.bookmarks)) {
        const serverIds = _idSet(data.bookmarks);
        state.tenders = state.tenders.map((row) => ({ ...row, is_bookmarked: serverIds.has(Number(row.id)) }));
      }
      if (Array.isArray(data.bookmarkedOrgs)) state.bookmarkedOrgs = [...data.bookmarkedOrgs];
      if (Array.isArray(data.templates)) state.templates = data.templates;
      if (Array.isArray(data.templateItems)) state.templateItems = data.templateItems;
      if (Array.isArray(data.projects)) {
        const localFolders = new Map(state.projects.map((row) => [row.id, row.folder_path]));
        state.projects = data.projects.map((row) => ({ ...row, folder_path: localFolders.get(row.id) || row.folder_path || null }));
      }
      if (Array.isArray(data.checklist)) {
        const localPaths = new Map(state.checklist.map((row) => [row.id, row.linked_file_path]));
        state.checklist = data.checklist.map((row) => ({ ...row, linked_file_path: localPaths.get(row.id) || row.linked_file_path || '' }));
      }
      return state;
    });
    await saveSyncBaseline(data, response?.updated_at);
    const columnPrefs = data.tenderColumnPrefs;
    if (columnPrefs) {
      const store = useAppStore.getState();
      if (Array.isArray(columnPrefs.hiddenColumns)) store.setTendersHiddenColumns(columnPrefs.hiddenColumns);
      if (Array.isArray(columnPrefs.columnOrder)) store.setTendersColumnOrder(columnPrefs.columnOrder);
      if (columnPrefs.columnWidths && typeof columnPrefs.columnWidths === 'object') {
        for (const [key, width] of Object.entries(columnPrefs.columnWidths)) store.setTenderColumnWidth(key, width);
      }
    }
    return data;
  },
};

// Column customization lives in the Zustand store (Client UI/src/lib/store.ts),
// separate from the IndexedDB `state` that updateSyncedState() covers — so it
// needs its own near-instant push whenever it changes, reusing the same
// collapse-rapid-edits behavior and the same offline-tolerant swallowed catch.
let _columnSyncPushTimer = null;
useAppStore.subscribe((state, prevState) => {
  if (state.tendersTable === prevState.tendersTable && state.tendersView.tenderColumnWidths === prevState.tendersView.tenderColumnWidths) return;
  clearTimeout(_columnSyncPushTimer);
  _columnSyncPushTimer = setTimeout(() => { api.pushUserData().catch(() => {}); }, SYNC_PUSH_DELAY_MS);
});
