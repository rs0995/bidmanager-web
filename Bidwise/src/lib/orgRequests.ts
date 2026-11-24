import { useSyncExternalStore } from 'react';
import { api } from './api';
import { readJSON, writeJSON } from './kv';
import { queryClient } from './queryClient';

// "Request tenders" for an organisation whose tenders haven't been fetched (ported from
// BM Pro's lib/orgRequests.js). Pending jobs are this device's own, never synced.

const PENDING_KEY = 'bw.pendingOrgRequests';
export const ORG_REQUEST_KEYS = [PENDING_KEY];

const POLL_INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 80;
const MAX_CONSECUTIVE_ERRORS = 3;
/** The server refuses a second fetch within 24 h of the last one. */
export const ORG_COOLDOWN_MS = 24 * 60 * 60 * 1000;

let pending: Record<number, string> = readJSON(PENDING_KEY, {});
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(fn => fn());

export function rehydrateOrgRequests() {
  pending = readJSON(PENDING_KEY, {});
  emit();
}

function setPending(orgId: number, jobId: string) {
  pending = { ...pending, [orgId]: jobId };
  writeJSON(PENDING_KEY, pending);
  emit();
}

function clearPending(orgId: number) {
  if (!(orgId in pending)) return;
  const next = { ...pending };
  delete next[orgId];
  pending = next;
  writeJSON(PENDING_KEY, pending);
  emit();
}

export const isOrgRequestPending = (orgId?: number) =>
  orgId !== undefined && orgId in pending;

export async function requestOrgTenders(orgId: number) {
  const { job_id: jobId } = await api.requestOrgTenders(orgId);
  setPending(orgId, jobId);
  poll(orgId, jobId, 0, 0);
  return jobId;
}

async function poll(
  orgId: number,
  jobId: string,
  attempt: number,
  errors: number,
) {
  try {
    const { status } = await api.orgRequestStatus(orgId, jobId);
    if (status === 'completed') {
      clearPending(orgId);
      queryClient.invalidateQueries({ queryKey: ['tenders'] });
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      return;
    }
    if (status === 'failed' || attempt >= MAX_ATTEMPTS) {
      clearPending(orgId);
      return;
    }
    setTimeout(() => poll(orgId, jobId, attempt + 1, 0), POLL_INTERVAL_MS);
  } catch {
    if (errors + 1 >= MAX_CONSECUTIVE_ERRORS) {
      clearPending(orgId);
      return;
    }
    setTimeout(
      () => poll(orgId, jobId, attempt + 1, errors + 1),
      POLL_INTERVAL_MS,
    );
  }
}

/** After a restart: keep following the requests still running. */
export function resumeOrgRequests() {
  for (const [orgId, jobId] of Object.entries(pending))
    poll(Number(orgId), jobId, 0, 0);
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function useOrgRequestPending(orgId?: number) {
  return useSyncExternalStore(
    subscribe,
    () => isOrgRequestPending(orgId),
    () => isOrgRequestPending(orgId),
  );
}

/** BM Pro's wording: updates open at 8 PM IST; after that, tomorrow at 8 PM. */
export function scrapeCooldownMessage(lastScrapedAtSeconds: number) {
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  if (ist.getUTCHours() < 20)
    return 'Next update will be available at 8:00 PM IST.';
  const tomorrow = new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1),
  ).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const last = new Date(lastScrapedAtSeconds * 1000).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Last updated on ${last}. Next update will be available ${tomorrow} 8:00 PM IST.`;
}
