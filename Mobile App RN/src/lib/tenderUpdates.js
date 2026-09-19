import { useSyncExternalStore } from "react";
import { getRaw, setRaw } from "./kv.js";
import { api } from "./api.js";
import { queryClient } from "./queryClient.js";
import { getDocumentsForTender, syncTenderDocuments } from "./documents.js";

// "Check for updates" jobs for a tender whose documents are already
// downloaded — the per-tender counterpart of orgRequests.js. Sends the same
// scraper job the first-time "Request documents" flow uses, then polls it.
// Device-local only (a job id is meaningless cross-device).
//
// The server has no cooldown on per-tender jobs (only orgs get a 24h one) and
// each job drives a Selenium session, so the client gates it: one check per
// 24h, unless a new corrigendum has been issued since the last check.
const PENDING_KEY = "bm.pendingTenderUpdates"; // { tenderId: { jobId, corrigendumCount, knownDocIds } }
const STATE_KEY = "bm.tenderUpdateState"; // { tenderId: { lastSyncAt, corrigendumCount } }
const POLL_INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 40;
const MAX_CONSECUTIVE_ERRORS = 3;
export const SYNC_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const listeners = new Set();
function emit() { listeners.forEach((fn) => fn()); }

function readJSON(key, fallback) {
  try { const raw = getRaw(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function writeJSON(key, value) { setRaw(key, JSON.stringify(value)); }

let pendingCache = readJSON(PENDING_KEY, {});
let stateCache = readJSON(STATE_KEY, {});

export function rehydrateTenderUpdates() {
  pendingCache = readJSON(PENDING_KEY, {});
  stateCache = readJSON(STATE_KEY, {});
  emit();
}

function setPending(tenderId, entry) {
  pendingCache = { ...pendingCache, [tenderId]: entry };
  writeJSON(PENDING_KEY, pendingCache);
  emit();
}
function clearPending(tenderId) {
  if (!(tenderId in pendingCache)) return;
  const next = { ...pendingCache };
  delete next[tenderId];
  pendingCache = next;
  writeJSON(PENDING_KEY, pendingCache);
  emit();
}
function recordSync(tenderId, corrigendumCount) {
  stateCache = { ...stateCache, [tenderId]: { lastSyncAt: Date.now(), corrigendumCount } };
  writeJSON(STATE_KEY, stateCache);
}

export function isTenderUpdatePending(tenderId) {
  return Number(tenderId) in pendingCache;
}

// Whether a new check may be started for `tender` (a FRESH tender payload —
// a stale cached one could hide a newly issued corrigendum).
export function getTenderSyncGate(tender) {
  const state = stateCache[Number(tender.id)];
  if (!state) return { allowed: true };
  if ((Number(tender.corrigendum_count) || 0) > (state.corrigendumCount || 0)) {
    return { allowed: true, reason: "corrigendum" };
  }
  if (Date.now() - state.lastSyncAt >= SYNC_COOLDOWN_MS) return { allowed: true };
  return { allowed: false, lastSyncAt: state.lastSyncAt };
}

// onDone({ ok, newDocuments?, error? }) fires when the job settles while the
// caller is still around. A job resumed after an app restart has no caller,
// so it settles silently (like orgRequests.js).
export async function requestTenderUpdate(tender, onDone) {
  const tenderId = Number(tender.id);
  const { job_id: jobId } = await api.requestDownloadJob(tenderId);
  const entry = {
    jobId,
    corrigendumCount: Number(tender.corrigendum_count) || 0,
    knownDocIds: getDocumentsForTender(tenderId).filter((r) => r.id > 0).map((r) => r.id),
  };
  setPending(tenderId, entry);
  pollTenderUpdate(tenderId, entry, 0, 0, onDone);
  return jobId;
}

async function finishUpdate(tenderId, entry, onDone) {
  let newDocuments = 0;
  try {
    const page = await api.tenderDocuments(tenderId);
    const items = page.items || [];
    syncTenderDocuments({ id: tenderId }, items);
    const known = new Set(entry.knownDocIds || []);
    newDocuments = items.filter((d) => !known.has(d.id)).length;
  } catch {
    // The job itself succeeded; the documents query below refetches on its own.
  }
  recordSync(tenderId, entry.corrigendumCount);
  clearPending(tenderId);
  queryClient.invalidateQueries({ queryKey: ["tenderDocuments", tenderId] });
  queryClient.invalidateQueries({ queryKey: ["tender", tenderId] });
  onDone?.({ ok: true, newDocuments });
}

async function pollTenderUpdate(tenderId, entry, attempt = 0, consecutiveErrors = 0, onDone) {
  try {
    const { status, error } = await api.downloadStatus(tenderId, entry.jobId);
    if (status === "completed") {
      await finishUpdate(tenderId, entry, onDone);
      return;
    }
    if (status === "failed") {
      clearPending(tenderId);
      onDone?.({ ok: false, error: error || "The update check failed." });
      return;
    }
    if (attempt >= MAX_ATTEMPTS) {
      clearPending(tenderId);
      onDone?.({ ok: false, error: "Timed out waiting for the server." });
      return;
    }
    setTimeout(() => pollTenderUpdate(tenderId, entry, attempt + 1, 0, onDone), POLL_INTERVAL_MS);
  } catch (e) {
    if (consecutiveErrors + 1 >= MAX_CONSECUTIVE_ERRORS) {
      clearPending(tenderId);
      onDone?.({ ok: false, error: e?.message || String(e) });
      return;
    }
    setTimeout(() => pollTenderUpdate(tenderId, entry, attempt + 1, consecutiveErrors + 1, onDone), POLL_INTERVAL_MS);
  }
}

export function resumePendingTenderUpdates() {
  for (const [tenderId, entry] of Object.entries(pendingCache)) {
    pollTenderUpdate(Number(tenderId), entry, 0, 0);
  }
}

function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function useTenderUpdatePending(tenderId) {
  return useSyncExternalStore(
    subscribe,
    () => isTenderUpdatePending(tenderId),
    () => isTenderUpdatePending(tenderId),
  );
}
