import { useSyncExternalStore } from 'react';
import { api } from './api.js';

// Local-first document + download cache, ported from the desktop Client UI's
// IndexedDB `documents` store (Client UI/src/lib/api.js) but backed by
// localStorage with the same cached-snapshot + useSyncExternalStore pattern
// as lib/projects.js / lib/alerts.js — consistent with the rest of this app.
//
// Row shape (matches desktop):
//   { id, tender_db_id, tender_id, tender_title, file_name, file_type,
//     size_bytes, downloadable, client_status, job_id,
//     requested_at, downloaded_at, updated_at, error }
//
//   client_status: 'synced' | 'requested' | 'downloading' | 'downloaded' | 'failed'
//   A whole-tender scrape request is tracked by a PLACEHOLDER row whose id
//   is the negative tender_db_id (so it can't collide with a real doc id).
const DOCS_KEY = 'bm.documents';
const MAX_ROWS = 400;         // keep the store bounded
const POLL_INTERVAL_MS = 15_000;
const MAX_POLL_ATTEMPTS = 40; // ~10 minutes

const listeners = new Set();
function emit() { listeners.forEach((fn) => fn()); }

function readJSON(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function writeJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

let docsCache = readJSON(DOCS_KEY, []);
let viewCache = new Map(); // tenderDbId -> filtered array (referentially stable per persist)
let activeSnap = computeActive();
let historySnap = computeHistory();

function computeActive() {
  return docsCache.filter((r) => r.client_status === 'requested' || r.client_status === 'downloading');
}
function computeHistory() {
  return docsCache
    .filter((r) => r.client_status && r.client_status !== 'synced')
    .slice()
    .sort((a, b) => String(b.downloaded_at || b.requested_at || b.updated_at || '')
      .localeCompare(String(a.downloaded_at || a.requested_at || a.updated_at || '')));
}

function persist() {
  // Keep every non-'synced' row (download history) plus the most recent
  // 'synced' rows, capped.
  if (docsCache.length > MAX_ROWS) {
    const kept = docsCache.filter((r) => r.client_status && r.client_status !== 'synced');
    const rest = docsCache.filter((r) => r.client_status === 'synced').slice(0, Math.max(0, MAX_ROWS - kept.length));
    docsCache = [...kept, ...rest];
  }
  writeJSON(DOCS_KEY, docsCache);
  viewCache = new Map();
  // Recompute whole-store snapshots up front so useSyncExternalStore
  // getSnapshot returns a stable reference between real changes.
  activeSnap = computeActive();
  historySnap = computeHistory();
  emit();
}

export function getDocuments() {
  return docsCache;
}

export function getDocumentsForTender(tenderDbId) {
  const key = Number(tenderDbId);
  if (!viewCache.has(key)) {
    viewCache.set(key, docsCache.filter((r) => Number(r.tender_db_id) === key));
  }
  return viewCache.get(key);
}

export function getDocument(id) {
  return docsCache.find((r) => r.id === id) || null;
}

export function getPendingDocuments() {
  return docsCache.filter((r) => r.client_status === 'requested');
}

export function getActiveDownloads() {
  return docsCache.filter((r) => r.client_status === 'requested' || r.client_status === 'downloading');
}

export function upsertDocument(patch) {
  if (patch == null || patch.id == null) throw new Error('upsertDocument requires an id.');
  const idx = docsCache.findIndex((r) => r.id === patch.id);
  const base = idx >= 0 ? docsCache[idx] : {
    tender_db_id: null, tender_id: '', tender_title: '',
    file_name: '', file_type: 'document', size_bytes: 0, downloadable: false,
    client_status: 'synced', job_id: null,
    requested_at: null, downloaded_at: null, error: null,
  };
  const row = { ...base, ...patch, updated_at: new Date().toISOString() };
  docsCache = idx >= 0
    ? docsCache.map((r, i) => (i === idx ? row : r))
    : [row, ...docsCache];
  persist();
  return row;
}

export function removeDocument(id) {
  docsCache = docsCache.filter((r) => r.id !== id);
  persist();
}

// Merge the server's document list for one tender into the cache, keyed by
// server id — preserving any local client_status/downloaded_at/error on a
// matching row, and implicitly dropping the negative placeholder row.
export function syncTenderDocuments(tender, serverItems) {
  const tenderDbId = Number(tender.id);
  const serverRows = Array.isArray(serverItems) ? serverItems : [];
  if (serverRows.length === 0) return serverRows;
  const existingById = new Map(
    docsCache.filter((r) => Number(r.tender_db_id) === tenderDbId).map((r) => [r.id, r]),
  );
  const others = docsCache.filter((r) => Number(r.tender_db_id) !== tenderDbId);
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
      job_id: existing?.job_id || null,
      requested_at: existing?.requested_at || null,
      downloaded_at: existing?.downloaded_at || null,
      error: existing?.error || null,
      updated_at: new Date().toISOString(),
    };
  });
  docsCache = [...others, ...merged];
  persist();
  return serverRows;
}

// ── Whole-tender scrape request ("Request download") ──────────────────────
export async function requestTenderDownload(tender) {
  const { job_id: jobId } = await api.requestDownloadJob(tender.id);
  const placeholder = upsertDocument({
    id: -Number(tender.id),
    tender_db_id: Number(tender.id),
    tender_id: tender.tender_id || '',
    tender_title: tender.title || '',
    file_name: '', file_type: '', size_bytes: 0, downloadable: false,
    client_status: 'requested',
    job_id: jobId,
    requested_at: new Date().toISOString(),
    downloaded_at: null,
    error: null,
  });
  pollTenderDownloadJob(tender, jobId, 0);
  return placeholder;
}

export async function pollTenderDownloadJob(tender, jobId, attempt = 0) {
  try {
    const { status, error } = await api.downloadStatus(tender.id, jobId);
    if (status === 'completed') {
      removeDocument(-Number(tender.id));
      const page = await api.tenderDocuments(tender.id).catch(() => null);
      if (page) syncTenderDocuments(tender, page.items || []);
      return;
    }
    if (status === 'failed') {
      upsertDocument({ id: -Number(tender.id), client_status: 'failed', error: error || 'Download failed.' });
      return;
    }
    if (attempt >= MAX_POLL_ATTEMPTS) {
      upsertDocument({ id: -Number(tender.id), client_status: 'failed', error: 'Timed out waiting for the server.' });
      return;
    }
    setTimeout(() => pollTenderDownloadJob(tender, jobId, attempt + 1), POLL_INTERVAL_MS);
  } catch (e) {
    upsertDocument({ id: -Number(tender.id), client_status: 'failed', error: e?.message || String(e) });
  }
}

// Call once on app startup (see RequireAuth): the setTimeout chain only
// lives while the page is open, so a reload while a request is still
// 'requested' needs the poll re-attached from the persisted placeholder.
export function resumePendingDownloadJobs() {
  for (const row of getPendingDocuments()) {
    if (!row.job_id) continue;
    pollTenderDownloadJob(
      { id: row.tender_db_id, tender_id: row.tender_id, title: row.tender_title },
      row.job_id,
      0,
    );
  }
}

// ── Per-file download ────────────────────────────────────────────────────
// doc: { id, tender_db_id, tender_id, file_name }
export async function downloadDocument(doc) {
  upsertDocument({ id: doc.id, client_status: 'downloading', error: null });
  try {
    const { url } = await api.downloadRequest(doc.tender_db_id, doc.id);
    // window.location.assign (not an <a download>) — a cross-origin download
    // attribute is unreliable in mobile Safari; the server sends
    // Content-Disposition: attachment so this saves rather than navigates.
    window.location.assign(url);
    return upsertDocument({ id: doc.id, client_status: 'downloaded', downloaded_at: new Date().toISOString(), error: null });
  } catch (e) {
    upsertDocument({ id: doc.id, client_status: 'failed', error: e?.message || String(e) });
    throw e;
  }
}

// Download every downloadable file for a tender, sequentially.
export async function downloadAllForTender(tender) {
  const page = await api.tenderDocuments(tender.id);
  const items = (page.items || []).filter((d) => d.downloadable !== false);
  let ok = 0;
  const failures = [];
  for (const it of items) {
    try {
      await downloadDocument({ id: it.id, tender_db_id: tender.id, tender_id: tender.tender_id, file_name: it.name });
      ok += 1;
    } catch (e) {
      failures.push(e?.message || String(e));
    }
  }
  return { ok, failed: failures.length, failures, total: items.length };
}

// ── Hooks ────────────────────────────────────────────────────────────────
function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function useDocumentsForTender(tenderDbId) {
  return useSyncExternalStore(
    subscribe,
    () => getDocumentsForTender(tenderDbId),
    () => getDocumentsForTender(tenderDbId),
  );
}
export function useActiveDownloads() {
  return useSyncExternalStore(subscribe, () => activeSnap, () => activeSnap);
}
export function useAllDownloads() {
  return useSyncExternalStore(subscribe, () => historySnap, () => historySnap);
}
