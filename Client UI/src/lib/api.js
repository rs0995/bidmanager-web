import { getState, getQueuedState, nextId, updateState } from './db.js';
import { useAppStore } from './store';
import { timeRemaining } from './utils';
import { DEFAULT_SERVER_URL } from './cloud-config';

const desktop = () => window.bidmanagerDesktop;
const leaf = (value) => String(value || 'Project').replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Project';
const joinPath = (...parts) => parts.filter(Boolean).join('\\').replace(/[\\/]+/g, '\\');
const valueNumber = (value) => Number(String(value || '').replace(/[^0-9.]/g, '')) || 0;

// A tender's identity everywhere is its portal tender id (e.g.
// "2026_MCGM_1345164_1"), compared in this canonical form — the same
// normaliser as the server's _canon_tender_id. The server DB row id
// (tender.id) only lives as long as that DB does: it's a short-lived handle
// for /client/tenders/{id} calls, looked up from the tender id right before
// use (api.resolveTenderRowId). Anything persisted (bookmarks, documents,
// notifications, project links) is keyed by tender id so a server DB
// restore that renumbers every row reconnects automatically.
export const canonTenderId = (value) => String(value ?? '').split(/\s+/).filter(Boolean).join(' ').toUpperCase();
export const tenderKey = (tender) => canonTenderId(tender?.tender_id);

function filterRows(rows, search, fields) {
  const q = String(search || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => fields.some((key) => String(row[key] ?? '').toLowerCase().includes(q)));
}

const IST_TIME_ZONE = 'Asia/Kolkata';
const IST_DATE_FMT = new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });
const IST_TIME_FMT = new Intl.DateTimeFormat('en-IN', { timeZone: IST_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true });
const IST_HOUR_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: IST_TIME_ZONE, hour: '2-digit', hour12: false });

// "{date}, {time}" in IST, e.g. "11 Sep 2026, 3:45 PM" — used both for the
// "Request tenders" cooldown message and the Organizations table's "Last
// updated" label. Intl's timeZone option avoids hand-rolled UTC+5:30 math
// (India has no DST, but this also sidesteps ever getting that wrong).
function formatISTTimestamp(epochSeconds) {
  const date = new Date(Number(epochSeconds) * 1000);
  return `${IST_DATE_FMT.format(date)}, ${IST_TIME_FMT.format(date)}`;
}

// Org tenders were last individually fetched at `lastScrapedAtEpoch` (epoch
// seconds, 0/falsy = never) — see organizations.last_scraped_at, stamped by
// the scraper only on an actual per-org tender fetch. Returns null when a
// "Request tenders" press should go through (never scraped, or ≥24h ago);
// otherwise the message to show instead of calling the endpoint at all.
function getScrapeCooldownMessage(lastScrapedAtEpoch) {
  const last = Number(lastScrapedAtEpoch) || 0;
  if (!last) return null;
  const nowSeconds = Date.now() / 1000;
  if (nowSeconds - last >= 86400) return null;
  const now = new Date();
  const istHour = Number(IST_HOUR_FMT.format(now));
  const lastUpdated = `Last updated on ${formatISTTimestamp(last)}.`;
  if (istHour < 20) {
    return `${lastUpdated} Next update will be available today at 8:00 PM IST.`;
  }
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return `${lastUpdated} Next update will be available tomorrow, ${IST_DATE_FMT.format(tomorrow)}, at 8:00 PM IST.`;
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
    // The baked-in DEFAULT_SERVER_URL wins until the user has explicitly set
    // a Backend URL in Settings — so a stale/dead server_url left in an old
    // install's IndexedDB never gets honored on a fresh install.
    server_url: normalizeServerUrl(
      overrides.server_url ?? (settings.server_url_user_set ? settings.server_url : DEFAULT_SERVER_URL),
    ),
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
      // Only 401 means "bad/expired token" — a 403 here is always a
      // permission problem (section_forbidden, org-admin-only, ...) with a
      // perfectly valid token, and must not force a global sign-out.
      if (result?.status === 401) throw new AuthError(result?.message || 'Sign in again.', result?.reason);
      const error = new Error(result?.message || 'Could not reach the client API.');
      error.status = result?.status;
      error.detail = result?.detail;
      throw error;
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
    // Same reasoning as the Electron-bridge branch above — 403 is a
    // permission problem, not a bad token, and must not sign the user out.
    if (response.status === 401) throw new AuthError(message, detail?.reason);
    const error = new Error(message);
    error.status = response.status;
    error.detail = detail;
    throw error;
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
      // Listing-page URL for this org — used by openTenderUrl() to recover
      // a stale-session deep link, and (once the server sends it) to hide
      // "Request tenders" for orgs already covered by a saved custom job.
      tenders_url: row.tenders_url || '',
      has_saved_job: Boolean(row.has_saved_job),
      // Epoch seconds, stamped by the scraper only when this org's
      // individual tenders were actually fetched (0 = never) — drives the
      // "Request tenders" cooldown and the "Last updated" org-table label.
      last_scraped_at: Number(row.last_scraped_at) || 0,
      // Was this org found on the site's own organisation-list page during
      // the most recent scrape of its website — distinct from
      // scrape_enabled (an admin's per-org auto-scrape toggle). Hidden
      // entirely from the plain Organizations tab; greyed out and
      // non-clickable (but still shown) when bookmarked.
      is_available: row.is_available !== false,
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
  // The server's own portal list, so a portal shows before anything is
  // scraped and a deleted one disappears. Older servers without the
  // endpoint fall back to the portals seen on tenders.
  const serverWebsites = await requestClient('/client/websites', {}, overrides).catch(() => null);
  const websiteMap = new Map();
  tenders.forEach((tender) => {
    const id = Number(tender.website_id);
    if (!Number.isFinite(id)) return;
    const current = websiteMap.get(id) || { id, name: tender.website_name || `Website ${id}`, orgs: 0, active_tenders: 0, selected_orgs: 0 };
    if (!tender.is_archived) current.active_tenders += 1;
    websiteMap.set(id, current);
  });
  const derivedWebsites = [...websiteMap.values()].map((website) => ({
    ...website,
    orgs: new Set(tenders.filter((t) => Number(t.website_id) === website.id).map((t) => t.org_chain).filter(Boolean)).size,
  }));
  const websites = Array.isArray(serverWebsites)
    ? serverWebsites.map((w) => {
      const id = Number(w.id);
      const seen = derivedWebsites.find((d) => d.id === id);
      return { id, name: w.name || `Website ${id}`, url: w.url || '', orgs: seen?.orgs || 0, active_tenders: seen?.active_tenders || 0, selected_orgs: 0 };
    })
    : derivedWebsites;
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
const _tenderIdList = (values) => [...new Set((values || []).map(canonTenderId).filter(Boolean))];
// Bookmarked tender ids in the last server blob. A baseline saved before
// bookmarks were keyed by tender id only has row ids — translated once via
// the loaded tenders (an id that can't be translated is neither carried nor
// claimed removed; the server keeps it).
function baselineBookmarkTenderIds(tenders) {
  if (Array.isArray(_lastServerBlob.bookmarkTenderIds)) return _tenderIdList(_lastServerBlob.bookmarkTenderIds);
  const keyByRowId = new Map((tenders || []).map((row) => [Number(row.id), tenderKey(row)]));
  return _tenderIdList((_lastServerBlob.bookmarks || []).map((id) => keyByRowId.get(Number(id))));
}
// The locally-issued "request" placeholder document row (negative id) for a
// tender — found by tender id, so a row-id change since the request doesn't
// orphan it.
async function placeholderDocId(tender) {
  const key = tenderKey(tender);
  const row = key && (await getState()).documents.find((doc) => doc.id < 0 && canonTenderId(doc.tender_id) === key);
  return row ? row.id : -Number(tender.id);
}
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
      const res = await api.pushUserData();
      if (res?.skipped) return;  // first sync not done yet — pullUserData re-arms
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
  const s = (await getQueuedState()).settings || {};
  if (!_syncPushPending && !s.pendingSyncPush) return;
  // First sync not done — don't push yet, leave the pending flag set so the
  // first pull re-arms it.
  if (!s.has_synced_once) return;
  clearTimeout(_syncPushTimer);
  try {
    const res = await api.pushUserData();
    if (res?.skipped) return;
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

// Same idea, for the Portal Search page's history list — a background-
// resumed poll (app restarted mid-search) can resolve while that page isn't
// mounted to notice on its own refetchInterval.
const _portalSearchChangedListeners = new Set();
function notifyPortalSearchChanged() {
  _portalSearchChangedListeners.forEach((fn) => { try { fn(); } catch { /* listener's problem, not ours */ } });
}

// Maps the server's `account` block (identical shape from login/register's
// `response.account` and GET /client/me) onto the local settings fields —
// see db.js initialState().settings and Server UI/server/org_access.py
// public_account(). Tolerant of a missing/null account (keeps the
// individual/all-sections default) so a pre-this-change server response
// (no `account` key at all) doesn't break sign-in.
function accountSettingsPatch(account) {
  if (!account || typeof account !== 'object') return {};
  return {
    account_type: account.account_type === 'organisation' ? 'organisation' : 'individual',
    org: account.org || null,
    permissions: {
      active: account.permissions?.active !== false,
      archived: account.permissions?.archived !== false,
      bookmarks: account.permissions?.bookmarks !== false,
      projects: account.permissions?.projects !== false,
      // Closed by default (unlike the other four) — must be explicitly true.
      portal_search: account.permissions?.portal_search === true,
    },
    pending_request: account.pending_request || null,
  };
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
  onPortalSearchChanged: (fn) => {
    _portalSearchChangedListeners.add(fn);
    return () => _portalSearchChangedListeners.delete(fn);
  },

  // Call once at app startup: retries any edit left unconfirmed by a
  // previous session (see the pendingSyncPush comment above) instead of
  // waiting for the next periodic sync or manual action to stumble onto it.
  flushPendingSyncPush: () => flushPendingSyncPush(),

  // ── Auth ───────────────────────────────────────────────────────────
  registerAccount: (input, overrides = {}) => requestClient(
    '/client/auth/register',
    {
      method: 'POST',
      body: {
        email: input.email,
        password: input.password,
        display_name: input.display_name || '',
        // Organisation signup — omitted/undefined for a plain individual
        // account, matching the server's default. See Server UI/server/
        // org_access.py for the account/org/permissions model this feeds.
        ...(input.account_type ? { account_type: input.account_type } : {}),
        ...(input.org_name ? { org_name: input.org_name } : {}),
      },
    },
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
      ...accountSettingsPatch(response.account),
    };
    if (remember) { sessionAuth = null; await api.updateSettings(auth); }
    else sessionAuth = auth;
    await api.pullUserData().catch(() => {});
    return response;
  },
  signOut: async () => {
    try { await api.logoutAccount(); } catch { /* best-effort */ }
    sessionAuth = null;
    await api.updateSettings({
      auth_token: '', user_email: '', user_id: null, display_name: '',
      account_type: 'individual', org: null,
      permissions: { active: true, archived: true, bookmarks: true, projects: true, portal_search: false },
      pending_request: null,
    });
  },
  // Refreshes this device's local view of account/org/permissions state —
  // call after signing in (redundant with the auth response but harmless)
  // and after any org action below, since approving/declining/de-linking
  // can change what THIS device's own account looks like too (e.g. an org
  // admin approving a request doesn't change their own account, but acting
  // on their own pending request or being de-linked by another admin does).
  getMe: async (overrides = {}) => {
    const me = await requestClient('/client/me', {}, overrides);
    await api.updateSettings(accountSettingsPatch(me));
    return me;
  },
  changePassword: (input, overrides = {}) => requestClient(
    '/client/auth/change-password',
    { method: 'POST', body: { current_password: input.current_password, new_password: input.new_password } },
    overrides,
  ),

  // ── Organisation accounts (Server UI/server/org_access.py) ───────────
  // Any individual can create or request to join an org; the rest are
  // admin-only (the server itself enforces this — a plain member or
  // individual calling them just gets back the server's own 403/404).
  createOrg: (name, overrides = {}) => requestClient(
    '/client/org', { method: 'POST', body: { name } }, overrides,
  ).then(async (detail) => { await api.getMe(overrides); return detail; }),
  requestJoinOrg: (joinCode, note = '', overrides = {}) => requestClient(
    '/client/org/join-requests', { method: 'POST', body: { join_code: joinCode, note } }, overrides,
  ).then(async (result) => { await api.getMe(overrides); return result; }),
  getMyJoinRequest: (overrides = {}) => requestClient('/client/org/join-requests/mine', {}, overrides),
  cancelJoinRequest: (overrides = {}) => requestClient(
    '/client/org/join-requests/mine', { method: 'DELETE' }, overrides,
  ).then(async (result) => { await api.getMe(overrides); return result; }),
  getOrgDetail: (overrides = {}) => requestClient('/client/org', {}, overrides),
  renameOrg: (name, overrides = {}) => requestClient(
    '/client/org', { method: 'PUT', body: { name } }, overrides,
  ),
  regenerateJoinCode: (overrides = {}) => requestClient(
    '/client/org/join-code/regenerate', { method: 'POST' }, overrides,
  ),
  listJoinRequests: (overrides = {}) => requestClient('/client/org/join-requests', {}, overrides),
  // permissions: optional partial { active, archived, bookmarks, projects } —
  // omitted keys default to every section on, matching the server's own
  // default for a newly approved member.
  approveJoinRequest: (requestId, permissions, overrides = {}) => requestClient(
    `/client/org/join-requests/${Number(requestId)}/approve`,
    { method: 'POST', body: permissions ? { permissions } : {} },
    overrides,
  ),
  rejectJoinRequest: (requestId, overrides = {}) => requestClient(
    `/client/org/join-requests/${Number(requestId)}/reject`, { method: 'POST' }, overrides,
  ),
  setMemberPermissions: (memberId, permissions, overrides = {}) => requestClient(
    `/client/org/members/${Number(memberId)}/permissions`,
    { method: 'PUT', body: permissions },
    overrides,
  ),
  setMemberRole: (memberId, role, overrides = {}) => requestClient(
    `/client/org/members/${Number(memberId)}/role`, { method: 'PUT', body: { role } }, overrides,
  ),
  // retain: true keeps the member's bookmarks (if they had bookmark access),
  // false wipes their account back to an empty individual.
  delinkMember: (memberId, retain, overrides = {}) => requestClient(
    `/client/org/members/${Number(memberId)}/delink`, { method: 'POST', body: { retain: Boolean(retain) } }, overrides,
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
  // "Check for updates" on an open tender: the server re-reads the portal and
  // fetches only corrigendum / pre-bid files the last run didn't cover.
  requestTenderUpdateJob: (tenderId, overrides = {}) => requestClient(
    `/client/tenders/${Number(tenderId)}/request-download`,
    { method: 'POST', body: { mode: 'update' } },
    overrides,
  ),
  // "Fetch status" on a closed tender: the portal's tender stage plus any
  // result files. Polled with getTenderDownloadStatus like a download job.
  fetchTenderStatus: (tenderId, overrides = {}) => requestClient(
    `/client/tenders/${Number(tenderId)}/fetch-status`,
    { method: 'POST', body: {} },
    overrides,
  ),
  // Runs a request-download / fetch-status job to the end: 5 s steps at
  // first, then 15 s, capped at ~30 min; three failed polls in a row give up.
  waitForTenderJob: async (tenderId, jobId, overrides = {}) => {
    let errors = 0;
    for (let attempt = 0; attempt < 128; attempt += 1) {
      try {
        const { status, error } = await api.getTenderDownloadStatus(tenderId, jobId, overrides);
        if (status === 'completed' || status === 'failed') return { status, error };
        errors = 0;
      } catch (err) {
        errors += 1;
        if (errors >= 3) return { status: 'failed', error: err?.message || String(err) };
      }
      await new Promise((resolve) => setTimeout(resolve, attempt < 8 ? 5000 : 15000));
    }
    return { status: 'failed', error: 'Timed out waiting for the server.' };
  },
  // CAPTCHAs raised by this user's own jobs (request-download, fetch-status,
  // request-tenders). Whichever answer reaches the server first wins -- the
  // operator console can answer the same one.
  getPendingCaptcha: (overrides = {}) => requestClient('/client/captcha/pending', {}, overrides),
  answerCaptcha: (id, text, overrides = {}) => requestClient(
    `/client/captcha/${encodeURIComponent(id)}/answer`,
    { method: 'POST', body: { text } },
    overrides,
  ),
  // `ref` is { tender_id, id? }: found by tender id; the row id is only used
  // when there's no tender id to go on.
  getLocalTender: async (ref) => {
    const key = tenderKey(ref);
    const rows = (await getState()).tenders;
    return (key ? rows.find((row) => tenderKey(row) === key) : rows.find((row) => row.id === Number(ref?.id))) || null;
  },
  // POST { tender_ids } -> { tenders: { CANON_ID: tender } } (missing ids absent).
  resolveTenders: (tenderIds, overrides = {}) => requestClient(
    '/client/tenders/resolve',
    { method: 'POST', body: { tender_ids: _tenderIdList(tenderIds) } },
    overrides,
  ),
  // Current server row id for `ref` ({ tender_id, id? }) — the local tender
  // list first, then /client/tenders/resolve for one this device hasn't
  // synced. null when the server no longer has that tender. The row id
  // carried on `ref` is only trusted when there's no tender id or the server
  // can't be asked (offline / older server), since a DB restore renumbers rows.
  resolveTenderRowId: async (ref, overrides = {}) => {
    const key = tenderKey(ref);
    const hint = Number(ref?.id);
    const fallback = Number.isFinite(hint) && hint > 0 ? hint : null;
    if (!key) return fallback;
    const local = (await getState()).tenders.find((row) => tenderKey(row) === key);
    if (local) return Number(local.id);
    try {
      const found = (await api.resolveTenders([key], overrides))?.tenders?.[key];
      return found ? Number(found.id) : null;
    } catch {
      return fallback;
    }
  },

  // ── Document download tracking (local-first: one cached row per server
  // document, plus a locally-issued placeholder row while a whole-tender
  // request has no document yet). Every UI button reads client_status/
  // local_path/downloadable straight off these rows — never a derived count.
  // Rows belong to a tender by tender_id; tender_db_id is just the current
  // row-id handle, re-pointed on every syncFromServer.
  listAllDocuments: async () => (await getState()).documents,
  listDocuments: async (tenderId) => {
    const key = canonTenderId(tenderId);
    return (await getState()).documents.filter((row) => key && canonTenderId(row.tender_id) === key);
  },
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
    const key = tenderKey(tender);
    const tenderDbId = await api.resolveTenderRowId(tender, overrides);
    if (!tenderDbId) return [];
    const payload = await api.listTenderDocuments(tenderDbId, params, overrides);
    const serverRows = payload.items || [];
    if (serverRows.length === 0) return serverRows;
    const isThisTender = (row) => (key
      ? canonTenderId(row.tender_id) === key || (!row.tender_id && Number(row.tender_db_id) === tenderDbId)
      : Number(row.tender_db_id) === tenderDbId);
    await updateState((state) => {
      const others = state.documents.filter((row) => !isThisTender(row));
      const mine = state.documents.filter(isThisTender);
      const existingById = new Map(mine.map((row) => [row.id, row]));
      // Server document ids are renumbered by a DB restore too — fall back to
      // the file name within this same tender so a downloaded file keeps its
      // local status/path.
      const existingByName = new Map(mine.filter((row) => row.id > 0 && row.file_name).map((row) => [row.file_name, row]));
      const merged = serverRows.map((row) => {
        const existing = existingById.get(row.id) || existingByName.get(row.name);
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
      // request row (negative id) for this tender is superseded. A stale
      // row of another tender holding one of these document ids (only after
      // a server DB restore renumbered them) goes too, so ids stay unique.
      const mergedIds = new Set(merged.map((row) => row.id));
      state.documents = [...others.filter((row) => !mergedIds.has(row.id)), ...merged];
      // Also flip the tender row itself so the "Request"/"Download" pill
      // updates immediately, without waiting for a full manual Sync.
      state.tenders = state.tenders.map((row) => (
        (key ? tenderKey(row) === key : row.id === tenderDbId) ? { ...row, has_documents: true, document_count: merged.length } : row
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
    const tenderDbId = await api.resolveTenderRowId(tender, overrides);
    if (!tenderDbId) throw new Error('This tender is no longer on the server.');
    const { job_id: jobId } = await api.requestTenderDownloadJob(tenderDbId, overrides);
    const current = { ...tender, id: tenderDbId };
    const placeholder = await api.upsertDocument({
      id: await placeholderDocId(current),
      tender_db_id: tenderDbId,
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
    api.pollTenderDownloadJob(current, jobId, overrides, 0);
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
        await api.removeDocument(await placeholderDocId(tender));
        await api.syncTenderDocuments(tender, {}, overrides);
        return;
      }
      if (status === 'failed') {
        await api.upsertDocument({ id: await placeholderDocId(tender), client_status: 'failed', error: error || 'Download failed.' });
        return;
      }
      if (attempt >= MAX_ATTEMPTS) {
        await api.upsertDocument({ id: await placeholderDocId(tender), client_status: 'failed', error: 'Timed out waiting for the server.' });
        return;
      }
      setTimeout(() => api.pollTenderDownloadJob(tender, jobId, overrides, attempt + 1, 0), 15000);
    } catch (error) {
      if (consecutiveErrors + 1 >= MAX_CONSECUTIVE_ERRORS) {
        await api.upsertDocument({ id: await placeholderDocId(tender), client_status: 'failed', error: error?.message || String(error) });
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
      // Polled by the tender's current row id (looked up from tender_id).
      // The job only exists on the server DB it was queued on, so a tender
      // the server no longer has can't be polled — mark it failed (Retry
      // re-queues it) instead of leaving it "Requested…" forever.
      const tenderDbId = await api.resolveTenderRowId({ tender_id: placeholder.tender_id, id: placeholder.tender_db_id }, overrides);
      if (!tenderDbId) {
        await api.upsertDocument({ id: placeholder.id, client_status: 'failed', error: 'This tender is no longer on the server.' });
        continue;
      }
      const tender = {
        id: tenderDbId,
        tender_id: placeholder.tender_id,
        title: placeholder.tender_title,
      };
      api.pollTenderDownloadJob(tender, placeholder.job_id, overrides, 0);
    }
  },

  // ── "Request tenders" — one-time manual scrape, allowed for any org as
  // long as its tenders haven't been individually fetched in the last 24h
  // (see Server UI/server/client_api.py /organizations/{id}/request-tenders
  // and organizations.last_scraped_at). Mirrors the tender download-request
  // flow above, but the pending marker is a plain local settings field
  // (never synced to the cloud — it's meaningless on another device).
  formatISTTimestamp,
  getScrapeCooldownMessage,
  requestOrgTenders: async (org) => {
    const cooldownMessage = getScrapeCooldownMessage(org.last_scraped_at);
    if (cooldownMessage) {
      useAppStore.getState().pushToast({ type: 'info', message: cooldownMessage });
      return { skipped: true };
    }
    let jobId;
    try {
      ({ job_id: jobId } = await requestClient(
        `/client/organizations/${Number(org.id)}/request-tenders`,
        { method: 'POST', body: {} },
      ));
    } catch (error) {
      // Local last_scraped_at was stale (this device hasn't synced since
      // another device/job refreshed this org) and the pre-check above
      // passed when it shouldn't have — the server's own defense-in-depth
      // 429 caught it. Rebuild the same friendly message from the server's
      // live timestamp (not a generic error dialog) and correct the local
      // cache so this device doesn't repeat the round-trip immediately.
      if (error?.status === 429) {
        const liveLastScrapedAt = Number(error.detail?.last_scraped_at) || 0;
        const message = getScrapeCooldownMessage(liveLastScrapedAt) || getScrapeCooldownMessage(Date.now() / 1000 - 1);
        useAppStore.getState().pushToast({ type: 'info', message });
        if (liveLastScrapedAt) {
          await updateState((state) => {
            state.organizations = state.organizations.map((row) => (
              Number(row.id) === Number(org.id) ? { ...row, last_scraped_at: liveLastScrapedAt } : row
            ));
            return state;
          });
        }
        return { skipped: true };
      }
      // Org account whose "active" section was turned off after this device
      // last loaded — server's defense-in-depth (_require_section) wins.
      if (error?.status === 403 && error.detail?.reason === 'section_forbidden') {
        useAppStore.getState().pushToast({ type: 'info', message: error.detail?.message || "Your account doesn't have access to this section." });
        return { skipped: true };
      }
      throw error;
    }
    await updateState((state) => {
      state.settings = { ...state.settings, pendingOrgRequests: { ...(state.settings.pendingOrgRequests || {}), [org.id]: jobId } };
      return state;
    });
    api.pollOrgTendersJob(org, jobId, 0);
    return { job_id: jobId };
  },
  getOrgRequestStatus: (orgId, jobId, overrides = {}) => requestClient(
    `/client/organizations/${Number(orgId)}/request-tenders-status?job_id=${encodeURIComponent(jobId)}`,
    {}, overrides,
  ),
  // Same shape/resilience as pollTenderDownloadJob: poll every 15s, capped,
  // tolerating a couple of transient errors before giving up.
  pollOrgTendersJob: async (org, jobId, attempt = 0, consecutiveErrors = 0) => {
    const MAX_ATTEMPTS = 80;
    const MAX_CONSECUTIVE_ERRORS = 3;
    const clearPending = () => updateState((state) => {
      const next = { ...(state.settings.pendingOrgRequests || {}) };
      delete next[org.id];
      state.settings = { ...state.settings, pendingOrgRequests: next };
      return state;
    });
    try {
      const { status } = await api.getOrgRequestStatus(org.id, jobId);
      if (status === 'completed') {
        await clearPending();
        await api.syncFromServer().catch(() => {});
        notifyTendersChanged();
        return;
      }
      if (status === 'failed' || attempt >= MAX_ATTEMPTS) {
        await clearPending();
        return;
      }
      setTimeout(() => api.pollOrgTendersJob(org, jobId, attempt + 1, 0), 15000);
    } catch {
      if (consecutiveErrors + 1 >= MAX_CONSECUTIVE_ERRORS) {
        await clearPending();
        return;
      }
      setTimeout(() => api.pollOrgTendersJob(org, jobId, attempt + 1, consecutiveErrors + 1), 15000);
    }
  },
  // Call once at app startup — same rationale as resumePendingDownloadJobs.
  resumePendingOrgRequests: async () => {
    const settings = (await getState()).settings;
    const pending = settings.pendingOrgRequests || {};
    for (const [orgId, jobId] of Object.entries(pending)) {
      api.pollOrgTendersJob({ id: Number(orgId) }, jobId, 0);
    }
  },
  getPendingOrgRequestIds: async () => Object.keys((await getState()).settings.pendingOrgRequests || {}).map(Number),

  // ── Portal tender search (portal_search section — Server UI/server/
  // API_CHANGES.md §2) ───────────────────────────────────────────────
  getPortalSearchPortals: (overrides = {}) => requestClient('/client/portal-search/portals', {}, overrides),
  requestPortalSearch: async (websiteId, tenderId, overrides = {}) => {
    const result = await requestClient(
      '/client/portal-search',
      { method: 'POST', body: { website_id: Number(websiteId), tender_id: tenderId } },
      overrides,
    );
    const searchId = result?.search?.id;
    if (searchId != null) {
      await updateState((state) => {
        state.settings = { ...state.settings, pendingPortalSearches: { ...(state.settings.pendingPortalSearches || {}), [searchId]: true } };
        return state;
      });
      api.pollPortalSearch(searchId, 0);
    }
    return result;
  },
  getPortalSearch: (searchId, overrides = {}) => requestClient(`/client/portal-search/${Number(searchId)}`, {}, overrides),
  getPortalSearchHistory: (limit = 50, overrides = {}) => requestClient(`/client/portal-search/history?limit=${Number(limit) || 50}`, {}, overrides),
  deletePortalSearchHistoryItem: (searchId, overrides = {}) => requestClient(`/client/portal-search/history/${Number(searchId)}`, { method: 'DELETE' }, overrides),
  clearPortalSearchHistory: (overrides = {}) => requestClient('/client/portal-search/history', { method: 'DELETE' }, overrides),
  // Fire-and-forget: polls a running portal search every ~3s (API_CHANGES.md
  // says 2-3s — the scrape+captcha can take a while, so this is capped
  // generously, same resilience shape as pollOrgTendersJob) until it leaves
  // "pending", then clears the local marker and — only when the tender was
  // actually found — refreshes the tender caches so it shows up everywhere.
  pollPortalSearch: async (searchId, attempt = 0, consecutiveErrors = 0) => {
    const MAX_ATTEMPTS = 400; // ~20 min at 3s
    const MAX_CONSECUTIVE_ERRORS = 3;
    const clearPending = () => updateState((state) => {
      const next = { ...(state.settings.pendingPortalSearches || {}) };
      delete next[searchId];
      state.settings = { ...state.settings, pendingPortalSearches: next };
      return state;
    });
    try {
      const { search } = await api.getPortalSearch(searchId);
      if (search?.status && search.status !== 'pending') {
        await clearPending();
        if (search.status === 'found') {
          await api.syncFromServer().catch(() => {});
          notifyTendersChanged();
        }
        notifyPortalSearchChanged();
        return;
      }
      if (attempt >= MAX_ATTEMPTS) {
        await clearPending();
        notifyPortalSearchChanged();
        return;
      }
      setTimeout(() => api.pollPortalSearch(searchId, attempt + 1, 0), 3000);
    } catch {
      if (consecutiveErrors + 1 >= MAX_CONSECUTIVE_ERRORS) {
        await clearPending();
        notifyPortalSearchChanged();
        return;
      }
      setTimeout(() => api.pollPortalSearch(searchId, attempt + 1, consecutiveErrors + 1), 3000);
    }
  },
  // Call once at app startup — same rationale as resumePendingOrgRequests.
  resumePendingPortalSearches: async () => {
    const settings = (await getState()).settings;
    const pending = settings.pendingPortalSearches || {};
    for (const searchId of Object.keys(pending)) {
      api.pollPortalSearch(Number(searchId), 0);
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
    // in the Downloads panel ("Untitled tender") and, missing tender_id,
    // invisible to the downloadedTenderIds ledger — so the tender's pill
    // never flips to "Downloaded" even though the file downloaded fine.
    const identity = {};
    if (doc.tender_db_id != null) identity.tender_db_id = doc.tender_db_id;
    if (doc.tender_id) identity.tender_id = doc.tender_id;
    if (doc.tender_title) identity.tender_title = doc.tender_title;
    await api.upsertDocument({ id: doc.id, ...identity, client_status: 'downloading', error: null });
    try {
      // The row id on `doc` may predate a server DB restore — use the
      // tender's current one, looked up by tender_id.
      const tenderDbId = await api.resolveTenderRowId({ tender_id: doc.tender_id, id: doc.tender_db_id }, overrides);
      if (!tenderDbId) throw new Error('This tender is no longer on the server.');
      identity.tender_db_id = tenderDbId;
      const { url } = await api.requestDocumentDownload(tenderDbId, doc.id, overrides);
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
  // Keeps projects created from a tender in step with it. Each project
  // remembers what it copied (tender_snapshot); a field still equal to that
  // follows the tender, a field that differs was edited by hand and is kept.
  // Projects from before tender_snapshot existed take the tender's current
  // values once. Changes sync to the user's other devices.
  refreshLinkedProjects: async () => {
    const state = await getState();
    const byTenderId = new Map();
    for (const t of state.tenders || []) {
      const key = tenderKey(t);
      if (key && !byTenderId.has(key)) byTenderId.set(key, t);
    }
    const norm = (v) => String(v ?? '').replace(/[,\s]/g, '').replace(/\.0+$/, '').trim();
    const pairs = [['deadline', 'closing_date'], ['prebid', 'pre_bid_meeting_date'], ['project_value', 'tender_value']];
    const updates = new Map();
    for (const project of state.projects || []) {
      const tender = byTenderId.get(canonTenderId(project.source_tender_id));
      if (!tender) continue;
      const legacy = !project.tender_snapshot;
      const snapshot = { ...(project.tender_snapshot || {}) };
      const patch = {};
      for (const [field, key] of pairs) {
        const live = tender[key];
        if (live == null || live === '') continue;
        const editedByHand = !legacy && norm(project[field]) !== norm(snapshot[key]);
        if (editedByHand) continue;
        if (norm(project[field]) !== norm(live)) patch[field] = live;
        snapshot[key] = live;
      }
      if (legacy || Object.keys(patch).length || JSON.stringify(snapshot) !== JSON.stringify(project.tender_snapshot)) {
        updates.set(project.id, { ...patch, tender_snapshot: snapshot });
      }
    }
    if (!updates.size) return 0;
    await updateSyncedState((s) => {
      s.projects = s.projects.map((row) => (updates.has(row.id) ? { ...row, ...updates.get(row.id) } : row));
      return s;
    });
    return updates.size;
  },
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
  // "Open Tender" opens tender.tender_url directly — a raw deep link into a
  // government portal, which often shows THAT portal's own "Stale Session"
  // error unless you arrive via its own search/listing flow. Under Electron
  // this is handled in-app (see electron/main.cjs desktop:open-tender-url):
  // it opens tender_url in an embedded window and, if that stale-session
  // page shows up, re-navigates through the org's listing URL and back.
  // Outside Electron (dev/browser) there's no way to do that recovery, so
  // it just opens the link like before.
  openTenderUrl: async (tender) => {
    const url = String(tender?.tender_url || '').trim();
    if (!url) return;
    const bridge = desktop();
    if (bridge?.openTenderUrl) {
      const orgs = (await getState()).organizations || [];
      const org = orgs.find((o) => o.name === tender.org_chain && Number(o.website_id) === Number(tender.website_id))
        || orgs.find((o) => o.name === tender.org_chain);
      await bridge.openTenderUrl(url, org?.tenders_url || '');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
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
    const sourceTenderId = canonTenderId(data?.source_tender_id);
    if (sourceTenderId) {
      const existing = (await getState()).projects.find((row) => canonTenderId(row.source_tender_id) === sourceTenderId);
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
    const activeProjectTenderIds = new Set(activeProjects.map((row) => canonTenderId(row.source_tender_id)).filter(Boolean));
    const upcoming = active
      .filter((row) => row.closing_date && (row.is_bookmarked || activeProjectTenderIds.has(tenderKey(row))))
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
      // Active only — an archived/removed project must stop counting instead
      // of leaving the total permanently inflated (state.projects here never
      // shrinks on archive, only on a hard delete from the Archived list).
      total_pipeline_value: activeProjects.reduce((sum, row) => sum + valueNumber(row.project_value), 0),
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
      // Keyed by tender id only — a row without one can't be matched across
      // syncs, so it's neither diffed nor carries a bookmark.
      const previousByKey = new Map(state.tenders.filter((row) => tenderKey(row)).map((row) => [tenderKey(row), row]));
      const previousKeyByRowId = new Map(state.tenders.map((row) => [Number(row.id), tenderKey(row)]));
      const bookmarkedOrgsSet = new Set(state.bookmarkedOrgs || []);
      changesSince = Number(state.settings?.last_changes_at) || 0;
      state.websites = Array.isArray(snapshot.websites) ? snapshot.websites : state.websites;
      state.organizations = Array.isArray(snapshot.organizations) ? snapshot.organizations : state.organizations;
      state.tenders = snapshot.tenders.map((row) => {
        const key = tenderKey(row);
        if (!key) return { ...row, is_bookmarked: false };
        const previous = previousByKey.get(key);
        if (previous?.is_bookmarked) {
          // closing_date is covered by the /client/changes feed below; the
          // local diff owns status + pre-bid/corrigendum, which the server's
          // tender_history snapshot doesn't track.
          if (previous.status !== row.status) {
            notificationsToEmit.push({ type: 'status', message: `"${row.title || row.tender_id}" status changed to ${row.status || 'unknown'}.`, tenderId: key, tenderDbId: row.id });
          }
          if ((Number(previous.prebid_count) || 0) !== (Number(row.prebid_count) || 0) || (Number(previous.corrigendum_count) || 0) !== (Number(row.corrigendum_count) || 0)) {
            notificationsToEmit.push({ type: 'prebid', message: `"${row.title || row.tender_id}" has a new pre-bid or corrigendum.`, tenderId: key, tenderDbId: row.id });
          }
        } else if (!previous && row.org_chain && bookmarkedOrgsSet.has(row.org_chain)) {
          const bucket = newTendersByOrg.get(row.org_chain) || [];
          bucket.push(row);
          newTendersByOrg.set(row.org_chain, bucket);
        }
        return { ...row, is_bookmarked: Boolean(previous?.is_bookmarked) };
      });
      // Documents belong to a tender by tender_id; re-point each one's
      // tender_db_id handle at this snapshot's row for that tender (null once
      // the server no longer has it). A row saved before documents carried a
      // tender_id gets it from the pre-sync row it pointed at.
      const rowIdByKey = new Map(state.tenders.filter((row) => tenderKey(row)).map((row) => [tenderKey(row), Number(row.id)]));
      state.documents = (state.documents || []).map((doc) => {
        const key = canonTenderId(doc.tender_id) || previousKeyByRowId.get(Number(doc.tender_db_id)) || '';
        if (!key) return doc;
        return { ...doc, tender_id: doc.tender_id || key, tender_db_id: rowIdByKey.get(key) ?? null };
      });
      state.settings = {
        ...state.settings,
        server_url: config.server_url,
        last_sync_at: new Date().toISOString(),
      };
      result = { tenders: state.tenders.length, websites: state.websites.length, syncedAt: state.settings.last_sync_at };
      return state;
    });
    await api.refreshLinkedProjects().catch(() => {});
    for (const [org, rows] of newTendersByOrg) {
      if (rows.length > 10) {
        notificationsToEmit.push({ type: 'new', message: `${rows.length} new tenders added under ${org}.`, orgName: org });
      } else {
        rows.forEach((row) => notificationsToEmit.push({ type: 'new', message: `"${row.title || row.tender_id}" added under ${org}.`, tenderId: tenderKey(row), tenderDbId: row.id, orgName: org }));
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
            notificationsToEmit.push({ type: 'status', message: `"${t.title || t.tender_id || `Tender #${t.id}`}" — closing date changed.`, tenderId: canonTenderId(t.tender_id), tenderDbId: t.id });
          }
        });
        for (const [org, items] of Object.entries(changes?.new_by_org || {})) {
          const list = items || [];
          if (list.length > 10) {
            notificationsToEmit.push({ type: 'new', message: `${list.length} new tenders added under ${org}.`, orgName: org });
          } else {
            list.forEach((t) => notificationsToEmit.push({ type: 'new', message: `"${t.title || t.tender_id}" added under ${org}.`, tenderId: canonTenderId(t.tender_id), tenderDbId: t.id, orgName: org }));
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
      // tenderId is the canonical tender id (the identity); tenderDbId is only
      // an optional row-id hint for when the tender id is missing.
      notificationsToEmit.forEach((n) => addNotification({ type: n.type, message: n.message, time, tenderId: n.tenderId || undefined, tenderDbId: n.tenderDbId, orgName: n.orgName }));
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
    // First sync must be a pull: a brand-new (or stale) device adopts the
    // server's data before it is ever allowed to push its own blank/partial
    // blob up. pullUserData sets has_synced_once and re-arms this push.
    if (!state.settings?.has_synced_once) return { skipped: true };
    const orgIdByName = new Map((state.organizations || []).map((row) => [row.name, row.id]));
    const bookmarkedOrgs = state.bookmarkedOrgs || [];
    const { tendersTable, tendersView } = useAppStore.getState();
    // Baseline must be loaded before the payload: bookmarks are only a flag on
    // state.tenders rows, and that list loads lazily (syncFromServer / the
    // ['client-tenders'] query). In the brief post-install window it's still
    // empty, so a naive `state.tenders.filter(is_bookmarked)` yields [] and the
    // removal delta below would tell the server to delete every prior bookmark.
    // Carry through any baseline bookmark whose tender row hasn't loaded here
    // yet — we can't see its real state, so we must not claim it was removed.
    await loadSyncBaseline();
    // Bookmarks travel as canonical tender ids (bookmarkTenderIds) — the
    // server's row ids change on a DB restore. `bookmarks` (row ids) is only
    // for older servers; the current one ignores it when bookmarkTenderIds is
    // present and recomputes it on read.
    const loadedTenderKeys = new Set(state.tenders.map(tenderKey).filter(Boolean));
    const flaggedRows = state.tenders.filter((row) => row.is_bookmarked);
    const baselineBookmarks = baselineBookmarkTenderIds(state.tenders);
    const carriedBookmarks = baselineBookmarks.filter((key) => !loadedTenderKeys.has(key));
    const data = {
      bookmarkTenderIds: _tenderIdList([...flaggedRows.map(tenderKey), ...carriedBookmarks]),
      bookmarks: flaggedRows.map((row) => Number(row.id)).filter(Number.isFinite),
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
    // `localBookmarks` includes the carried ids above, so
    // `removed.bookmarkTenderIds` reduces to "tenders this device HAS loaded
    // and are now unbookmarked" — the only safe removal claim. Once the full
    // snapshot is in, carried is empty and a genuine un-bookmark still
    // propagates.
    const localBookmarks = new Set(data.bookmarkTenderIds);
    const localOrgs = new Set(bookmarkedOrgs);
    const localProjectIds = _rowIdSet(data.projects);
    const localChecklistIds = _rowIdSet(data.checklist);
    const removed = {
      bookmarkTenderIds: baselineBookmarks.filter((key) => !localBookmarks.has(key)),
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

    // The server is the source of truth: a pull HARD-MIRRORS local user-data
    // to the server blob — every synced collection is set unconditionally,
    // defaulting to empty, so a key the server omits (or a "Reset synced
    // data") clears the stale local copy too. Device-local filesystem paths
    // (folder_path / linked_file_path) are carried over by id.
    await updateState((state) => {
      // Bookmarks by tender id; an older server without bookmarkTenderIds
      // only has row ids.
      const serverKeys = Array.isArray(data.bookmarkTenderIds) ? new Set(_tenderIdList(data.bookmarkTenderIds)) : null;
      const serverIds = _idSet(data.bookmarks || []);
      state.tenders = state.tenders.map((row) => ({
        ...row,
        is_bookmarked: serverKeys ? serverKeys.has(tenderKey(row)) : serverIds.has(Number(row.id)),
      }));
      state.bookmarkedOrgs = Array.isArray(data.bookmarkedOrgs) ? [...data.bookmarkedOrgs] : [];
      state.templates = Array.isArray(data.templates) ? data.templates : [];
      state.templateItems = Array.isArray(data.templateItems) ? data.templateItems : [];
      const localFolders = new Map(state.projects.map((row) => [row.id, row.folder_path]));
      state.projects = (Array.isArray(data.projects) ? data.projects : []).map((row) => ({
        ...row, folder_path: localFolders.get(row.id) || row.folder_path || null,
      }));
      const localPaths = new Map(state.checklist.map((row) => [row.id, row.linked_file_path]));
      state.checklist = (Array.isArray(data.checklist) ? data.checklist : []).map((row) => ({
        ...row, linked_file_path: localPaths.get(row.id) || row.linked_file_path || '',
      }));
      // First successful pull done — pushes are now allowed.
      state.settings = { ...state.settings, has_synced_once: true };
      return state;
    });
    await saveSyncBaseline(data, response?.updated_at);
    const columnPrefs = data.tenderColumnPrefs || {};
    const store = useAppStore.getState();
    store.setTendersHiddenColumns(Array.isArray(columnPrefs.hiddenColumns) ? columnPrefs.hiddenColumns : []);
    store.setTendersColumnOrder(Array.isArray(columnPrefs.columnOrder) ? columnPrefs.columnOrder : []);
    const widths = (columnPrefs.columnWidths && typeof columnPrefs.columnWidths === 'object') ? columnPrefs.columnWidths : {};
    for (const [key, width] of Object.entries(widths)) store.setTenderColumnWidth(key, width);
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
