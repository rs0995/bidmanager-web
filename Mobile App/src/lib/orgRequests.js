import { useSyncExternalStore } from 'react';
import { api } from './api.js';
import { queryClient } from './queryClient.js';

// One-time "Request tenders" job tracking for an organisation with no saved
// scrape job covering it yet — ported from the desktop Client UI's
// pendingOrgRequests (Client UI/src/lib/api.js). Device-local only, never
// synced (a job id is meaningless cross-device), same reasoning as
// lib/documents.js's download job tracking, which this mirrors.
const PENDING_KEY = 'bm.pendingOrgRequests'; // { [orgId]: jobId }
const POLL_INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 80;              // ~20 minutes
const MAX_CONSECUTIVE_ERRORS = 3;

const listeners = new Set();
function emit() { listeners.forEach((fn) => fn()); }

function readJSON(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function writeJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } }

let pendingCache = readJSON(PENDING_KEY, {});

function setPending(orgId, jobId) {
  pendingCache = { ...pendingCache, [orgId]: jobId };
  writeJSON(PENDING_KEY, pendingCache);
  emit();
}
function clearPending(orgId) {
  if (!(orgId in pendingCache)) return;
  const next = { ...pendingCache };
  delete next[orgId];
  pendingCache = next;
  writeJSON(PENDING_KEY, pendingCache);
  emit();
}

export function getPendingOrgRequests() {
  return pendingCache;
}
export function isOrgRequestPending(orgId) {
  return Number(orgId) in pendingCache;
}

export async function requestOrgTenders(org) {
  const { job_id: jobId } = await api.requestOrgTenders(org.id);
  setPending(org.id, jobId);
  pollOrgTendersJob(org, jobId, 0, 0);
  return jobId;
}

export async function pollOrgTendersJob(org, jobId, attempt = 0, consecutiveErrors = 0) {
  try {
    const { status } = await api.orgRequestStatus(org.id, jobId);
    if (status === 'completed') {
      clearPending(org.id);
      queryClient.invalidateQueries({ queryKey: ['tenders'] });
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      return;
    }
    if (status === 'failed' || attempt >= MAX_ATTEMPTS) {
      clearPending(org.id);
      return;
    }
    setTimeout(() => pollOrgTendersJob(org, jobId, attempt + 1, 0), POLL_INTERVAL_MS);
  } catch {
    if (consecutiveErrors + 1 >= MAX_CONSECUTIVE_ERRORS) {
      clearPending(org.id);
      return;
    }
    setTimeout(() => pollOrgTendersJob(org, jobId, attempt + 1, consecutiveErrors + 1), POLL_INTERVAL_MS);
  }
}

// Call once on app startup (see RequireAuth): the setTimeout chain only
// lives while the page is open, so a reload while a request is still
// pending needs the poll re-attached from the persisted job id.
export function resumePendingOrgRequests() {
  for (const [orgId, jobId] of Object.entries(pendingCache)) {
    pollOrgTendersJob({ id: Number(orgId) }, jobId, 0, 0);
  }
}

function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function useOrgRequestPending(orgId) {
  return useSyncExternalStore(
    subscribe,
    () => isOrgRequestPending(orgId),
    () => isOrgRequestPending(orgId),
  );
}
