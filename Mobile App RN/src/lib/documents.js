import { useSyncExternalStore } from "react";
import { File, Directory, Paths } from "expo-file-system";
import { unzipSync } from "fflate";
import * as Sharing from "expo-sharing";
import { getRaw, setRaw } from "./kv.js";
import { api } from "./api.js";

const DOCUMENTS_DIR_NAME = "documents";
const ZIP_EXTRACTED_DIR_NAME = "zip-extracted";

export function isPdfDoc(doc) {
  return /\.pdf$/i.test(doc?.file_name || "");
}
export function isZipDoc(doc) {
  return /\.zip$/i.test(doc?.file_name || "");
}

// Local-first document + download cache, backed by the shared kv.js
// AsyncStorage mirror with the same cached-snapshot + useSyncExternalStore
// pattern as lib/projects.js / lib/alerts.js.
//
// Row shape:
//   { id, tender_db_id, tender_id, tender_title, file_name, file_type,
//     size_bytes, downloadable, client_status, job_id,
//     requested_at, downloaded_at, updated_at, error }
//   client_status: "synced" | "requested" | "downloading" | "downloaded" | "failed"
const DOCS_KEY = "bm.documents";
const MAX_ROWS = 400;
const POLL_INTERVAL_MS = 15_000;
const MAX_POLL_ATTEMPTS = 40;

const listeners = new Set();
function emit() { listeners.forEach((fn) => fn()); }

function readJSON(key, fallback) {
  try { const raw = getRaw(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
function writeJSON(key, value) { setRaw(key, JSON.stringify(value)); }

let docsCache = readJSON(DOCS_KEY, []);
let viewCache = new Map();
let activeSnap = computeActive();
let historySnap = computeHistory();

function computeActive() {
  return docsCache.filter((r) => r.client_status === "requested" || r.client_status === "downloading");
}
function computeHistory() {
  return docsCache
    .filter((r) => r.client_status && r.client_status !== "synced")
    .slice()
    .sort((a, b) => String(b.downloaded_at || b.requested_at || b.updated_at || "")
      .localeCompare(String(a.downloaded_at || a.requested_at || a.updated_at || "")));
}

export function rehydrateDocuments() {
  docsCache = readJSON(DOCS_KEY, []);
  viewCache = new Map();
  activeSnap = computeActive();
  historySnap = computeHistory();
  emit();
}

function persist() {
  if (docsCache.length > MAX_ROWS) {
    const kept = docsCache.filter((r) => r.client_status && r.client_status !== "synced");
    const rest = docsCache.filter((r) => r.client_status === "synced").slice(0, Math.max(0, MAX_ROWS - kept.length));
    docsCache = [...kept, ...rest];
  }
  writeJSON(DOCS_KEY, docsCache);
  viewCache = new Map();
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
  return docsCache.filter((r) => r.client_status === "requested");
}

export function getActiveDownloads() {
  return docsCache.filter((r) => r.client_status === "requested" || r.client_status === "downloading");
}

export function upsertDocument(patch) {
  if (patch == null || patch.id == null) throw new Error("upsertDocument requires an id.");
  const idx = docsCache.findIndex((r) => r.id === patch.id);
  const base = idx >= 0 ? docsCache[idx] : {
    tender_db_id: null, tender_id: "", tender_title: "",
    file_name: "", file_type: "document", size_bytes: 0, downloadable: false,
    client_status: "synced", job_id: null,
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
      tender_id: tender.tender_id || existing?.tender_id || "",
      tender_title: tender.title || existing?.tender_title || "",
      file_name: row.name,
      file_type: row.type,
      size_bytes: row.size_bytes,
      downloadable: row.downloadable,
      client_status: existing && existing.client_status !== "synced" ? existing.client_status : "synced",
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

export async function requestTenderDownload(tender) {
  const { job_id: jobId } = await api.requestDownloadJob(tender.id);
  const placeholder = upsertDocument({
    id: -Number(tender.id),
    tender_db_id: Number(tender.id),
    tender_id: tender.tender_id || "",
    tender_title: tender.title || "",
    file_name: "", file_type: "", size_bytes: 0, downloadable: false,
    client_status: "requested",
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
    if (status === "completed") {
      removeDocument(-Number(tender.id));
      const page = await api.tenderDocuments(tender.id).catch(() => null);
      if (page) syncTenderDocuments(tender, page.items || []);
      return;
    }
    if (status === "failed") {
      upsertDocument({ id: -Number(tender.id), client_status: "failed", error: error || "Download failed." });
      return;
    }
    if (attempt >= MAX_POLL_ATTEMPTS) {
      upsertDocument({ id: -Number(tender.id), client_status: "failed", error: "Timed out waiting for the server." });
      return;
    }
    setTimeout(() => pollTenderDownloadJob(tender, jobId, attempt + 1), POLL_INTERVAL_MS);
  } catch (e) {
    upsertDocument({ id: -Number(tender.id), client_status: "failed", error: e?.message || String(e) });
  }
}

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

// Per-file download: RN has no browser download mechanism, so this pulls the
// file into persistent app storage (Paths.document, not the OS-purgeable
// cache dir) via expo-file-system. PDFs and ZIPs are viewable/browsable right
// in the app (see documents/[id]/view.tsx and archive.tsx), so those are just
// saved. Everything else (Word/Excel/etc.) still gets handed to the OS share
// sheet (expo-sharing) immediately, same as before.
// doc: { id, tender_db_id, tender_id, file_name }
export async function downloadDocument(doc) {
  upsertDocument({ id: doc.id, client_status: "downloading", error: null });
  try {
    const { url } = await api.downloadRequest(doc.tender_db_id, doc.id);
    const destDir = new Directory(Paths.document, DOCUMENTS_DIR_NAME, String(doc.id));
    destDir.create({ intermediates: true, idempotent: true });
    const dest = new File(destDir, doc.file_name || `document-${doc.id}`);
    const file = await File.downloadFileAsync(url, dest, { idempotent: true });
    if (!isPdfDoc(doc) && !isZipDoc(doc) && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(file.uri);
    }
    return upsertDocument({
      id: doc.id,
      client_status: "downloaded",
      local_uri: file.uri,
      downloaded_at: new Date().toISOString(),
      error: null,
    });
  } catch (e) {
    upsertDocument({ id: doc.id, client_status: "failed", error: e?.message || String(e) });
    throw e;
  }
}

// Returns a `File` for a downloaded document's persisted copy, or null if it
// hasn't been downloaded (or was removed by Clear Cache).
export function getLocalFile(doc) {
  const row = getDocument(doc?.id) ?? doc;
  if (!row?.local_uri) return null;
  const file = new File(row.local_uri);
  return file.exists ? file : null;
}

// Extracts a downloaded ZIP into its own folder (once — subsequent calls
// reuse the existing extraction) and returns the destination `Directory`.
// Entries are read with fflate (pure JS, no native unzip dependency) since
// expo-file-system has no unzip of its own.
export async function ensureZipExtracted(doc) {
  const row = getDocument(doc?.id) ?? doc;
  const zipFile = getLocalFile(row);
  if (!zipFile) throw new Error("This document has not been downloaded yet.");

  const destDir = new Directory(Paths.document, ZIP_EXTRACTED_DIR_NAME, String(row.id));
  if (destDir.exists && destDir.list().length > 0) {
    return destDir;
  }
  destDir.create({ intermediates: true, idempotent: true });

  const bytes = zipFile.bytesSync();
  const entries = unzipSync(bytes);
  for (const [entryPath, data] of Object.entries(entries)) {
    if (!data || entryPath.endsWith("/")) continue; // directory entries have no bytes
    const parts = entryPath.split("/").filter(Boolean);
    const name = parts.pop();
    let dir = destDir;
    for (const part of parts) {
      dir = new Directory(dir, part);
      dir.create({ intermediates: true, idempotent: true });
    }
    new File(dir, name).write(data);
  }
  return destDir;
}

// Flattens an extracted ZIP's directory tree into a list of file entries
// (nested folders are represented by "/" in `name`, not returned separately).
function walkFiles(dir, prefix = "") {
  const out = [];
  for (const entry of dir.list()) {
    const label = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (typeof entry.list === "function") {
      out.push(...walkFiles(entry, label));
    } else {
      out.push({ name: label, uri: entry.uri, size: entry.size ?? null });
    }
  }
  return out;
}

// Extracts a ZIP (if not already extracted) and returns its contents as a
// flat list of { name, uri, size } file entries, sorted by name.
export async function listZipEntries(doc) {
  const destDir = await ensureZipExtracted(doc);
  return walkFiles(destDir).sort((a, b) => a.name.localeCompare(b.name));
}

// Deletes every persisted document file and extracted ZIP folder. Called
// from Clear Cache (lib/localCache.js) so it reclaims real device storage,
// not just the bm.documents KV index.
export function deleteAllLocalDocumentFiles() {
  for (const name of [DOCUMENTS_DIR_NAME, ZIP_EXTRACTED_DIR_NAME]) {
    const dir = new Directory(Paths.document, name);
    if (dir.exists) dir.delete();
  }
}

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
