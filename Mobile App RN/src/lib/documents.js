import { useSyncExternalStore } from "react";
import { File, Directory, Paths } from "expo-file-system";
import { unzipSync } from "fflate";
import * as Sharing from "expo-sharing";
import { getRaw, setRaw } from "./kv.js";
import { api } from "./api.js";
import { queryClient } from "./queryClient.js";
import { addAlert } from "./alerts.js";
import { canonTenderId, tenderKeyOf } from "./tenderKey.js";

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
//     requested_at, downloaded_at, updated_at, error, local_uri, local_doc_id }
//   client_status: "synced" | "requested" | "downloading" | "downloaded" | "failed"
//
// Rows belong to a tender by its canonical portal tender_id (lib/tenderKey.js).
// tender_db_id and the document `id` are server row ids: handles for API
// calls only, refreshed from the live tender/document list -- both change if
// the server DB is restored (see syncTenderDocuments()).
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

// Rows saved by older builds may lack tender_id (they were grouped by
// tender_db_id); fill it from a sibling row of the same tender where one has it.
function normalizeDocs(rows) {
  const keyByDbId = new Map();
  rows.forEach((r) => { if (r.tender_id && r.tender_db_id != null) keyByDbId.set(Number(r.tender_db_id), r.tender_id); });
  return rows.map((r) => (r.tender_id || !keyByDbId.has(Number(r.tender_db_id))
    ? r
    : { ...r, tender_id: keyByDbId.get(Number(r.tender_db_id)) }));
}

const EMPTY = [];
function docKey(row) { return canonTenderId(row?.tender_id); }

let docsCache = normalizeDocs(readJSON(DOCS_KEY, []));
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
  docsCache = normalizeDocs(readJSON(DOCS_KEY, []));
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

// `t` is a tender object or a tender_id string.
export function getDocumentsForTender(t) {
  const key = tenderKeyOf(t);
  if (!key) return EMPTY;
  if (!viewCache.has(key)) {
    viewCache.set(key, docsCache.filter((r) => docKey(r) === key));
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
  const key = tenderKeyOf(tender);
  const tenderDbId = Number(tender.id);
  const serverRows = Array.isArray(serverItems) ? serverItems : [];
  if (serverRows.length === 0 || !key) return serverRows;
  const mine = docsCache.filter((r) => docKey(r) === key);
  const existingById = new Map(mine.map((r) => [r.id, r]));
  // After a server DB restore every document id changes: a saved row whose
  // id is no longer listed is matched to the server document by file name, so
  // its downloaded file carries over (local_doc_id remembers the folder it was
  // saved under -- see getLocalFile()).
  const serverIds = new Set(serverRows.map((r) => r.id));
  const byName = new Map(
    mine.filter((r) => r.id > 0 && !serverIds.has(r.id) && r.file_name).map((r) => [r.file_name, r]),
  );
  const others = docsCache.filter((r) => docKey(r) !== key);
  const merged = serverRows.map((row) => {
    let existing = existingById.get(row.id);
    if (!existing && byName.has(row.name)) {
      const old = byName.get(row.name);
      byName.delete(row.name);
      existing = { ...old, local_doc_id: old.local_doc_id ?? old.id };
    }
    // Spread the existing row first so fields this merge doesn't own
    // (local_uri of a saved file, etc.) survive -- dropping local_uri made every
    // downloaded document look "missing" (corrupt) after the next server sync.
    return {
      ...existing,
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

// mode: undefined ("full", first-time request) | "redownload" (re-fetch even
// files the server already has stored). Resolves to the placeholder row plus
// `created` -- false when the server joined an already in-flight job for this
// tender instead of queuing a new one.
export async function requestTenderDownload(tender, mode) {
  const { job_id: jobId, created } = await api.requestDownloadJob(tender.id, mode);
  const placeholder = upsertDocument({
    id: -Number(tender.id),
    tender_db_id: Number(tender.id),
    tender_id: tender.tender_id || "",
    tender_title: tender.title || "",
    file_name: "", file_type: "", size_bytes: 0, downloadable: false,
    client_status: "requested",
    job_id: jobId,
    job_mode: mode || null,
    requested_at: new Date().toISOString(),
    downloaded_at: null,
    error: null,
  });
  pollTenderDownloadJob(tender, jobId, 0, mode);
  return { ...placeholder, created: created !== false };
}

// After a "redownload" job the server holds good copies, but the phone still
// has the old empty/corrupt files: drop them and fetch fresh ones.
async function refetchCorruptLocalDocs(tender) {
  const tenderDbId = Number(tender.id);
  const bad = getDocumentsForTender(tender).filter((r) => r.id > 0 && isCorruptDownload(r));
  for (const row of bad) {
    try { getLocalFile(row)?.delete(); } catch { /* already gone */ }
    upsertDocument({ id: row.id, client_status: "synced", local_uri: null, downloaded_at: null, error: null });
  }
  for (const row of bad) {
    try {
      await downloadDocument({
        id: row.id, tender_db_id: tenderDbId, tender_id: row.tender_id, file_name: row.file_name,
      });
    } catch {
      // Left as "failed"; the document row shows a retry.
    }
  }
}

// Saves every listed document that isn't on the phone yet, so a finished
// server job shows up on the Downloads page. No share sheet: this runs
// without the user watching.
export async function saveDocsToDevice(tender, serverItems) {
  const tenderDbId = Number(tender.id);
  let saved = 0;
  for (const it of getUndownloadedDocs(tender, serverItems)) {
    try {
      await downloadDocument(
        { id: it.id, tender_db_id: tenderDbId, tender_id: tender.tender_id, file_name: it.name },
        { share: false },
      );
      saved += 1;
    } catch {
      // Left as "failed"; the document row shows a retry.
    }
  }
  return saved;
}

export async function pollTenderDownloadJob(tender, jobId, attempt = 0, mode) {
  try {
    const { status, error } = await api.downloadStatus(tender.id, jobId);
    if (status === "completed") {
      removeDocument(-Number(tender.id));
      const page = await api.tenderDocuments(tender.id).catch(() => null);
      if (page) syncTenderDocuments(tender, page.items || []);
      queryClient.invalidateQueries({ queryKey: ["tenderDocuments", Number(tender.id)] });
      queryClient.invalidateQueries({ queryKey: ["tender", Number(tender.id)] });
      if (mode === "redownload") await refetchCorruptLocalDocs(tender);
      if (page) await saveDocsToDevice(tender, page.items || []);
      // Local-only, same as the status/prebid alerts above in sync.js -- the
      // job itself runs server-side, but completion is only noticed once
      // something on the device actually polls it (here, or
      // resumePendingDownloadJobs() on next app open if the app was closed
      // mid-job), so this can arrive late rather than never, not instantly
      // while fully closed. That gap only closes with a server-side push
      // tied to this specific job + device, which is a separate piece of
      // work (apns_push.py has no notion of "this job belongs to this
      // user's device" today).
      addAlert({
        kind: "download",
        message: `Documents for "${tender.title || tender.tender_id || `Tender #${tender.id}`}" finished downloading.`,
        tenderId: tender.id,
        tenderKey: tender.tender_id,
      });
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
    setTimeout(() => pollTenderDownloadJob(tender, jobId, attempt + 1, mode), POLL_INTERVAL_MS);
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
      row.job_mode || undefined,
    );
  }
}

// Per-file download: RN has no browser download mechanism, so this pulls the
// file into persistent app storage (Paths.document, not the OS-purgeable
// cache dir) via expo-file-system. PDFs and ZIPs are viewable/browsable right
// in the app (see documents/[id]/view.tsx and archive.tsx), so those are just
// saved. Everything else (Word/Excel/etc.) still gets handed to the OS share
// sheet (expo-sharing) immediately, same as before.
// doc: { id, tender_db_id, tender_id, file_name } -- tender_db_id must come
// from the live tender (it is only the API handle; tender_id groups the row).
export async function downloadDocument(doc, options = {}) {
  upsertDocument({
    id: doc.id,
    ...(doc.tender_db_id != null && { tender_db_id: Number(doc.tender_db_id) }),
    ...(doc.tender_id && { tender_id: doc.tender_id }),
    ...(doc.file_name && { file_name: doc.file_name }),
    client_status: "downloading",
    error: null,
  });
  try {
    const { url } = await api.downloadRequest(doc.tender_db_id, doc.id);
    const destDir = new Directory(Paths.document, DOCUMENTS_DIR_NAME, String(doc.id));
    destDir.create({ intermediates: true, idempotent: true });
    const dest = new File(destDir, doc.file_name || `document-${doc.id}`);
    const file = await File.downloadFileAsync(url, dest, { idempotent: true });
    if (options.share !== false && !isPdfDoc(doc) && !isZipDoc(doc) && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(file.uri);
    }
    return upsertDocument({
      id: doc.id,
      client_status: "downloaded",
      local_uri: file.uri,
      local_doc_id: null,
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
  if (!row || row.id == null) return null;
  // The stored absolute URI embeds the app container path, which iOS can change
  // across app updates/reinstalls -- so also look at the deterministic spot
  // downloadDocument() writes to, or every saved file would suddenly look missing.
  const candidates = [];
  if (row.local_uri) candidates.push(new File(row.local_uri));
  if (row.file_name) {
    candidates.push(new File(new Directory(Paths.document, DOCUMENTS_DIR_NAME, String(row.id)), row.file_name));
    // Saved before a server DB restore re-numbered the document.
    if (row.local_doc_id != null) {
      candidates.push(new File(new Directory(Paths.document, DOCUMENTS_DIR_NAME, String(row.local_doc_id)), row.file_name));
    }
  }
  for (const file of candidates) {
    try { if (file.exists) return file; } catch { /* try the next location */ }
  }
  return null;
}

// A file that "downloaded" but is empty or far smaller than the server said
// it should be almost always means the scrape produced something other than
// the real document (e.g. a captcha page) instead of failing outright --
// downloadDocument() below only checks that the HTTP request succeeded, not
// that the bytes it got back are plausible.
export function isCorruptDownload(doc) {
  const row = getDocument(doc?.id) ?? doc;
  if (row?.client_status !== "downloaded") return false;
  const file = getLocalFile(row);
  if (!file) return true; // marked downloaded but the file is gone/missing
  const actual = file.size ?? 0;
  if (actual === 0) return true;
  const expected = Number(row.size_bytes) || 0;
  return expected > 0 && actual < expected * 0.5;
}

// Server documents for a tender that still need fetching to this device: not
// downloaded yet, or downloaded but empty/corrupt. Drives which of the
// "Download all" / sync controls make sense on the tender and project screens.
// `t` is the tender (or its tender_id).
export function getUndownloadedDocs(t, serverItems) {
  const rows = getDocumentsForTender(t).filter((r) => r.id > 0);
  const local = new Map(rows.map((r) => [r.id, r]));
  // Same tender + file name = same document when ids were re-numbered.
  const byName = new Map(rows.filter((r) => r.file_name).map((r) => [r.file_name, r]));
  return (serverItems || []).filter((d) => {
    if (d.downloadable === false) return false;
    const row = local.get(d.id) ?? byName.get(d.name);
    return !row || row.client_status !== "downloaded" || isCorruptDownload(row);
  });
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

// `t` is a tender object or a tender_id string.
export function useDocumentsForTender(t) {
  const key = tenderKeyOf(t);
  return useSyncExternalStore(
    subscribe,
    () => getDocumentsForTender(key),
    () => getDocumentsForTender(key),
  );
}
export function useActiveDownloads() {
  return useSyncExternalStore(subscribe, () => activeSnap, () => activeSnap);
}
export function useAllDownloads() {
  return useSyncExternalStore(subscribe, () => historySnap, () => historySnap);
}
