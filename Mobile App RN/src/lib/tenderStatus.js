import { useSyncExternalStore } from "react";
import { getRaw, setRaw } from "./kv.js";
import { api } from "./api.js";
import { queryClient } from "./queryClient.js";
import { tenderKeyOf } from "./tenderKey.js";

// "Fetch status" jobs for archived tenders -- the server reads the portal's
// Tender Stage for the tender, stores it, and (for result stages) downloads the
// result files. Mirrors tenderUpdates.js: the pending job is persisted so the
// poll resumes after an app restart, and any terminal state re-reads the tender
// because a job can save a status even when it has no result files to report.
// Keyed by canonical portal tender_id (lib/tenderKey.js); tenderDbId is the
// row id the job was started with (its API handle). Older builds keyed this
// by row id -- such entries still resume through that id.
const PENDING_KEY = "bm.pendingTenderStatus"; // { tenderKey: { jobId, tenderDbId, beforeStatus, beforeChecked } }
const POLL_INTERVAL_MS = 15_000;
const QUICK_POLL_MS = 5_000;
const QUICK_POLL_ATTEMPTS = 8;
const MAX_ATTEMPTS = 60;
const MAX_CONSECUTIVE_ERRORS = 3;
// Each fetch needs a captcha solve + browser session on the server.
export const STATUS_COOLDOWN_MS = 6 * 60 * 60 * 1000;

const listeners = new Set();
function emit() { listeners.forEach((fn) => fn()); }

function readJSON(key, fallback) {
  try { const raw = getRaw(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}

let pendingCache = readJSON(PENDING_KEY, {});

export function rehydrateTenderStatus() {
  pendingCache = readJSON(PENDING_KEY, {});
  emit();
}

function setPending(tenderId, entry) {
  pendingCache = { ...pendingCache, [tenderId]: entry };
  setRaw(PENDING_KEY, JSON.stringify(pendingCache));
  emit();
}
function clearPending(tenderId) {
  if (!(tenderId in pendingCache)) return;
  const next = { ...pendingCache };
  delete next[tenderId];
  pendingCache = next;
  setRaw(PENDING_KEY, JSON.stringify(pendingCache));
  emit();
}

// `t` is a tender object or a tender_id string.
export function isTenderStatusPending(t) {
  const key = tenderKeyOf(t);
  return Boolean(key) && key in pendingCache;
}

function dbIdOf(key, entry) {
  return Number(entry.tenderDbId ?? key);
}

// Epoch ms of the server's last status fetch for this tender, or null.
export function getStatusCheckedAt(tender) {
  return (Number(tender?.last_status_checked_at) || 0) * 1000 || null;
}

// `tender` must be a FRESH payload so the server's own last-checked time counts.
export function getStatusSyncGate(tender) {
  const checkedAt = getStatusCheckedAt(tender);
  if (checkedAt && Date.now() - checkedAt < STATUS_COOLDOWN_MS) return { allowed: false, lastCheckedAt: checkedAt };
  return { allowed: true, lastCheckedAt: checkedAt };
}

// onDone({ ok, status, statusChanged, resultFiles, lastCheckedAt, error? }) fires
// when the job settles while the caller is still around.
export async function requestTenderStatusFetch(tender, onDone) {
  const tenderId = Number(tender.id);
  const key = tenderKeyOf(tender) || tenderId;
  const { job_id: jobId } = await api.fetchTenderStatus(tenderId);
  const entry = {
    jobId,
    tenderDbId: tenderId,
    beforeStatus: String(tender.status || ""),
    beforeChecked: Number(tender.last_status_checked_at) || 0,
  };
  setPending(key, entry);
  pollStatus(key, entry, 0, 0, onDone);
  return jobId;
}

async function finish(key, entry, jobError, onDone) {
  const tenderId = dbIdOf(key, entry);
  let fresh = null;
  let resultFiles = 0;
  try {
    fresh = await queryClient.fetchQuery({ queryKey: ["tender", tenderId], queryFn: () => api.tender(tenderId), staleTime: 0 });
    const page = await api.tenderDocuments(tenderId, { file_type: "result" }).catch(() => null);
    resultFiles = (page?.items || []).length;
  } catch {
    // Fall through: report what we know.
  }
  clearPending(key);
  queryClient.invalidateQueries({ queryKey: ["tenders"] });
  queryClient.invalidateQueries({ queryKey: ["tender", tenderId] });
  queryClient.invalidateQueries({ queryKey: ["tenderDocuments", tenderId] });
  const checkedAt = Number(fresh?.last_status_checked_at) || 0;
  // A job can be reported failed although the stage was read and saved.
  const advanced = checkedAt > entry.beforeChecked;
  if (jobError && !advanced) {
    onDone?.({ ok: false, error: jobError });
    return;
  }
  const status = String(fresh?.status || "");
  onDone?.({
    ok: true,
    status,
    statusChanged: status !== entry.beforeStatus,
    resultFiles,
    lastCheckedAt: checkedAt ? checkedAt * 1000 : Date.now(),
  });
}

async function pollStatus(key, entry, attempt = 0, consecutiveErrors = 0, onDone) {
  const tenderId = dbIdOf(key, entry);
  try {
    const { status, error } = await api.downloadStatus(tenderId, entry.jobId);
    if (status === "completed") { await finish(key, entry, null, onDone); return; }
    if (status === "failed") { await finish(key, entry, error || "The status check failed.", onDone); return; }
    if (attempt >= MAX_ATTEMPTS) { await finish(key, entry, "Timed out waiting for the server.", onDone); return; }
    setTimeout(
      () => pollStatus(key, entry, attempt + 1, 0, onDone),
      attempt < QUICK_POLL_ATTEMPTS ? QUICK_POLL_MS : POLL_INTERVAL_MS,
    );
  } catch (e) {
    if (consecutiveErrors + 1 >= MAX_CONSECUTIVE_ERRORS) {
      clearPending(key);
      onDone?.({ ok: false, error: e?.message || String(e) });
      return;
    }
    setTimeout(() => pollStatus(key, entry, attempt + 1, consecutiveErrors + 1, onDone), POLL_INTERVAL_MS);
  }
}

export function resumePendingTenderStatus() {
  for (const [key, entry] of Object.entries(pendingCache)) {
    pollStatus(key, entry, 0, 0);
  }
}

function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// `t` is a tender object or a tender_id string.
export function useTenderStatusPending(t) {
  const key = tenderKeyOf(t);
  return useSyncExternalStore(
    subscribe,
    () => isTenderStatusPending(key),
    () => isTenderStatusPending(key),
  );
}
