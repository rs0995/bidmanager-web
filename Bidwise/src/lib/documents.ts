import { useSyncExternalStore } from 'react';
import { api, ServerDocument, ServerTender } from './api';
import { BACKEND_URL } from './http';
import { readJSON, writeJSON } from './kv';
import { files } from '../platform/files';
import { addAlert, unreadCount } from './alerts';
import { push } from '../platform/push';

// Tender documents on this device: per-file download state and history, the
// server-side "Request documents" / "Check for updates" jobs, ZIP contents and CSV
// export. Ported from BM Pro's lib/documents.js and lib/tenderUpdates.js
// (expo-file-system / fflate → react-native-blob-util / react-native-zip-archive).

const DOCS_KEY = 'bw.documents';
const JOBS_KEY = 'bw.docJobs';
const CHECKS_KEY = 'bw.docChecks';
export const DOCUMENT_KEYS = [DOCS_KEY, JOBS_KEY, CHECKS_KEY];

const DOCS_DIR = 'documents';
const ZIP_DIR = 'zip-extracted';
const MAX_ROWS = 400;
const POLL_MS = 15_000;
const QUICK_POLL_MS = 4_000;
const QUICK_POLLS = 8;
const MAX_POLLS = 48;
/** "Check for updates" at most once an hour per tender (the server decides what's new). */
export const CHECK_COOLDOWN_MS = 60 * 60 * 1000;

export type DocStatus = 'synced' | 'downloading' | 'downloaded' | 'failed';

export type LocalDoc = {
  id: number;
  tender_db_id: number;
  tender_ref: string;
  tender_title: string;
  file_name: string;
  file_type: string;
  size_bytes: number;
  downloadable: boolean;
  status: DocStatus;
  /** Path relative to the app's Documents folder. */
  local_rel: string | null;
  local_size: number | null;
  downloaded_at: string | null;
  updated_at: string;
  error: string | null;
  /** Saved at full size but won't open (a ZIP that isn't one): treated as broken. */
  unreadable?: boolean;
};

export type JobKind = 'request' | 'redownload' | 'update';
export type DocJob = {
  jobId: string;
  kind: JobKind;
  tenderRef: string;
  tenderTitle: string;
  startedAt: string;
  knownDocIds: number[];
  error?: string | null;
};

type State = {
  docs: LocalDoc[];
  jobs: Record<string, DocJob>;
  /** tender id → last completed update check (ms). */
  checks: Record<string, number>;
};

let state: State = { docs: [], jobs: {}, checks: {} };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(fn => fn());

let byTender = new Map<number, LocalDoc[]>();
let history: LocalDoc[] = [];
let active: LocalDoc[] = [];

function recompute() {
  byTender = new Map();
  for (const d of state.docs) {
    const list = byTender.get(d.tender_db_id) ?? [];
    list.push(d);
    byTender.set(d.tender_db_id, list);
  }
  history = state.docs
    .filter(d => d.status !== 'synced')
    .sort((a, b) =>
      String(b.downloaded_at || b.updated_at).localeCompare(
        String(a.downloaded_at || a.updated_at),
      ),
    );
  active = state.docs.filter(d => d.status === 'downloading');
}

export function rehydrateDocuments() {
  state = {
    docs: readJSON<LocalDoc[]>(DOCS_KEY, []),
    jobs: readJSON<Record<string, DocJob>>(JOBS_KEY, {}),
    checks: readJSON<Record<string, number>>(CHECKS_KEY, {}),
  };
  // A download in flight when the app closed never finished.
  state.docs = state.docs.map(d =>
    d.status === 'downloading'
      ? { ...d, status: 'failed', error: 'Interrupted. Tap to try again.' }
      : d,
  );
  recompute();
  emit();
}

function commit(next: Partial<State>) {
  state = { ...state, ...next };
  if (next.docs) {
    if (state.docs.length > MAX_ROWS) {
      const kept = state.docs.filter(d => d.status !== 'synced');
      const rest = state.docs
        .filter(d => d.status === 'synced')
        .slice(0, Math.max(0, MAX_ROWS - kept.length));
      state.docs = [...kept, ...rest];
    }
    writeJSON(DOCS_KEY, state.docs);
  }
  if (next.jobs) writeJSON(JOBS_KEY, state.jobs);
  if (next.checks) writeJSON(CHECKS_KEY, state.checks);
  recompute();
  emit();
}

const nowIso = () => new Date().toISOString();

function upsert(id: number, patch: Partial<LocalDoc>): LocalDoc {
  const existing = state.docs.find(d => d.id === id);
  const row: LocalDoc = {
    id,
    tender_db_id: 0,
    tender_ref: '',
    tender_title: '',
    file_name: '',
    file_type: 'document',
    size_bytes: 0,
    downloadable: true,
    status: 'synced',
    local_rel: null,
    local_size: null,
    downloaded_at: null,
    error: null,
    ...existing,
    ...patch,
    updated_at: nowIso(),
  };
  commit({
    docs: existing
      ? state.docs.map(d => (d.id === id ? row : d))
      : [row, ...state.docs],
  });
  return row;
}

export const getDocsState = () => state;
export const docsForTender = (tenderId: number) =>
  byTender.get(tenderId) ?? EMPTY;
const EMPTY: LocalDoc[] = [];

/**
 * Downloaded but empty, under half the server's size, or found unreadable when opened:
 * usually a portal error page saved while its CAPTCHA went unsolved.
 */
export function isCorrupt(d: LocalDoc): boolean {
  if (d.status !== 'downloaded') return false;
  if (d.unreadable) return true;
  const actual = d.local_size ?? 0;
  if (actual === 0) return true;
  return d.size_bytes > 0 && actual < d.size_bytes * 0.5;
}

export const isZip = (name: string) => /\.zip$/i.test(name);

/** Records the server's document list for a tender, keeping local download state. */
export function syncTenderDocuments(
  tender: Pick<ServerTender, 'id' | 'tender_id' | 'title'>,
  items: ServerDocument[],
) {
  if (!items.length) return;
  const tid = Number(tender.id);
  const existing = new Map(docsForTender(tid).map(d => [d.id, d]));
  const others = state.docs.filter(d => d.tender_db_id !== tid);
  const merged = items.map<LocalDoc>(it => {
    const e = existing.get(it.id);
    return {
      local_rel: null,
      local_size: null,
      downloaded_at: null,
      error: null,
      status: 'synced',
      ...e,
      id: it.id,
      tender_db_id: tid,
      tender_ref: tender.tender_id || e?.tender_ref || '',
      tender_title: tender.title || e?.tender_title || '',
      file_name: it.name,
      file_type: it.type,
      size_bytes: it.size_bytes,
      downloadable: it.downloadable,
      updated_at: nowIso(),
    };
  });
  commit({ docs: [...others, ...merged] });
}

/**
 * The server builds the signed link from the address it was reached on, which behind
 * its HTTPS proxy can come out as plain http:// (blocked by iOS). Keep the path and
 * token, always on the app's https backend.
 */
export function signedUrl(url: string) {
  return url.startsWith('/')
    ? `${BACKEND_URL}${url}`
    : `${BACKEND_URL}${url.replace(/^https?:\/\/[^/]+/, '')}`;
}

const relPathFor = (id: number, name: string) =>
  `${DOCS_DIR}/${id}/${name || `document-${id}`}`;

/** Downloads one document to this device. Rejects (and marks the row failed) on error. */
export async function downloadDocument(
  doc: Pick<LocalDoc, 'id' | 'tender_db_id' | 'file_name'> &
    Partial<Pick<LocalDoc, 'tender_ref' | 'tender_title' | 'size_bytes'>>,
): Promise<LocalDoc> {
  upsert(doc.id, { ...doc, status: 'downloading', error: null });
  try {
    const { url } = await api.downloadRequest(doc.tender_db_id, doc.id);
    const rel = relPathFor(doc.id, doc.file_name);
    const size = await files.download(signedUrl(url), files.abs(rel));
    // A new copy of a ZIP is unpacked afresh, not from the old copy's folder.
    await files.remove(files.abs(`${ZIP_DIR}/${doc.id}`)).catch(() => {});
    return upsert(doc.id, {
      status: 'downloaded',
      local_rel: rel,
      local_size: size,
      downloaded_at: nowIso(),
      error: null,
      unreadable: false,
    });
  } catch (e) {
    upsert(doc.id, {
      status: 'failed',
      error: (e as Error)?.message || 'Download failed.',
    });
    throw e;
  }
}

/** Absolute path of a downloaded file that still exists on the device, else null. */
export async function localPath(d: LocalDoc): Promise<string | null> {
  const candidates = [d.local_rel, relPathFor(d.id, d.file_name)].filter(
    (p): p is string => Boolean(p),
  );
  for (const rel of candidates) {
    const abs = files.abs(rel);
    if (await files.exists(abs)) return abs;
  }
  return null;
}

/** Opens a downloaded document in QuickLook; marks it failed if the file has gone. */
export async function openDocument(d: LocalDoc) {
  const abs = await localPath(d);
  if (!abs) {
    upsert(d.id, {
      status: 'failed',
      error: 'The file is no longer on this device.',
    });
    throw new Error('The file is no longer on this device. Download it again.');
  }
  await files.open(abs);
}

/** Unzips a downloaded ZIP once and lists its files (nested folders as "a/b.pdf"). */
export async function zipEntries(d: LocalDoc) {
  const zip = await localPath(d);
  if (!zip) throw new Error('Download the ZIP first.');
  const dest = files.abs(`${ZIP_DIR}/${d.id}`);
  let entries = await files.walk(dest);
  if (!entries.length) {
    try {
      await files.unzip(zip, dest);
    } catch {
      // Not a real ZIP (often the portal's page saved while its CAPTCHA was unsolved):
      // flag it so the tender's Re-download picks it up.
      await files.remove(dest).catch(() => {});
      upsert(d.id, { unreadable: true });
      throw new Error(UNREADABLE_ZIP);
    }
    entries = await files.walk(dest);
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export const UNREADABLE_ZIP = 'This ZIP didn’t download properly.';

/**
 * Saves the given files that aren't on this device yet. `items` may be a subset (new
 * files after an update check), so this never rewrites the tender's document list;
 * callers record the full list with syncTenderDocuments().
 */
export async function downloadAll(
  tender: Pick<ServerTender, 'id' | 'tender_id' | 'title'>,
  items: ServerDocument[],
) {
  const todo = items.filter(it => {
    if (!it.downloadable) return false;
    const local = state.docs.find(d => d.id === it.id);
    return !local || local.status !== 'downloaded' || isCorrupt(local);
  });
  let ok = 0;
  for (const it of todo) {
    try {
      await downloadDocument({
        id: it.id,
        tender_db_id: Number(tender.id),
        file_name: it.name,
        size_bytes: it.size_bytes,
        tender_ref: tender.tender_id,
        tender_title: tender.title,
      });
      ok += 1;
    } catch {
      // Left as failed; its row offers a retry.
    }
  }
  return { ok, total: todo.length };
}

// --- Server jobs: first-time "Request documents", "Re-download", "Check for updates" ---

export type JobResult =
  | { ok: true; newDocuments: number }
  | { ok: false; error: string };

const jobDone = new Map<number, (r: JobResult) => void>();

function setJob(tenderId: number, job: DocJob | null) {
  const jobs = { ...state.jobs };
  if (job) jobs[tenderId] = job;
  else delete jobs[tenderId];
  commit({ jobs });
}

export function lastCheckedAt(
  t: Pick<ServerTender, 'id' | 'last_update_checked_at'>,
) {
  const server = (Number(t.last_update_checked_at) || 0) * 1000;
  const local = state.checks[String(t.id)] || 0;
  return Math.max(server, local) || null;
}

/** Whether "Check for updates" may run now (an hour since this device last checked). */
export function canCheckNow(tenderId: number) {
  const last = state.checks[String(tenderId)];
  return !last || Date.now() - last >= CHECK_COOLDOWN_MS;
}

/**
 * Starts a server job for a tender and polls it. `request`: fetch its documents for the
 * first time. `redownload`: fetch fresh copies of all its files (some came out broken).
 * `update`: look for new corrigendum / pre-bid files. New files are saved to the device.
 */
export async function startJob(
  tender: Pick<ServerTender, 'id' | 'tender_id' | 'title'>,
  kind: JobKind,
  onDone?: (r: JobResult) => void,
) {
  const tid = Number(tender.id);
  const mode = kind === 'request' ? undefined : kind;
  const { job_id } = await api.requestDownloadJob(tid, mode);
  setJob(tid, {
    jobId: job_id,
    kind,
    tenderRef: tender.tender_id,
    tenderTitle: tender.title,
    startedAt: nowIso(),
    knownDocIds: docsForTender(tid).map(d => d.id),
  });
  if (onDone) jobDone.set(tid, onDone);
  poll(tid, 0, 0);
}

async function finishJob(tid: number, job: DocJob) {
  let newDocuments = 0;
  try {
    const page = await api.tenderDocuments(tid, { page_size: 100 });
    const items = page.items ?? [];
    const tender = {
      id: tid,
      tender_id: job.tenderRef,
      title: job.tenderTitle,
    };
    syncTenderDocuments(tender, items);
    const known = new Set(job.knownDocIds);
    const fresh = items.filter(d => !known.has(d.id));
    newDocuments = job.kind === 'update' ? fresh.length : items.length;
    if (job.kind === 'redownload') {
      // The server fetched every file again, so replace every copy on this device:
      // one that looks fine may still be a page saved while the CAPTCHA was unsolved.
      for (const d of docsForTender(tid)) {
        const abs = await localPath(d);
        if (abs) await files.remove(abs).catch(() => {});
        await files.remove(files.abs(`${ZIP_DIR}/${d.id}`)).catch(() => {});
        upsert(d.id, {
          status: 'synced',
          local_rel: null,
          local_size: null,
          unreadable: false,
        });
      }
    }
    // Save to the device what isn't here yet, so it shows on the Downloads page.
    await downloadAll(tender, job.kind === 'update' ? fresh : items);
  } catch {
    // The job itself succeeded; the documents list refetches on its own.
  }
  if (job.kind === 'update')
    commit({ checks: { ...state.checks, [tid]: Date.now() } });
  // The user asked for these (request / re-download), or new files arrived (update).
  if (job.kind !== 'update' || newDocuments > 0) {
    const message =
      job.kind === 'update'
        ? `${newDocuments} new ${
            newDocuments === 1 ? 'file' : 'files'
          } saved for “${job.tenderTitle || job.tenderRef}”.`
        : `Documents for “${
            job.tenderTitle || job.tenderRef
          }” finished downloading.`;
    addAlert({ kind: 'download', message, tenderId: String(tid) });
    // This device asked, so this device says so (the server sends no download push).
    notifyDownload(
      job.kind === 'update' ? 'New documents' : 'Download complete',
      message,
      tid,
    );
  }
  setJob(tid, null);
  jobDone.get(tid)?.({ ok: true, newDocuments });
  jobDone.delete(tid);
}

/** A notification like any other (lock screen, banner, badge), if they're allowed. */
function notifyDownload(title: string, body: string, tid: number) {
  push
    .getPermission()
    .then(p => {
      if (p === 'granted')
        push.notify(
          title,
          body,
          { thread: 'download', tenderId: String(tid) },
          unreadCount(),
        );
    })
    .catch(() => {});
}

function fail(tid: number, error: string) {
  setJob(tid, null);
  jobDone.get(tid)?.({ ok: false, error });
  jobDone.delete(tid);
}

async function poll(tid: number, attempt: number, errors: number) {
  const job = state.jobs[tid];
  if (!job) return;
  try {
    const { status, error } = await api.downloadStatus(tid, job.jobId);
    if (status === 'completed') return finishJob(tid, job);
    if (status === 'failed')
      return fail(tid, error || 'The portal job failed.');
    if (attempt >= MAX_POLLS)
      return fail(tid, 'Timed out waiting for the server.');
    setTimeout(
      () => poll(tid, attempt + 1, 0),
      attempt < QUICK_POLLS && job.kind === 'update' ? QUICK_POLL_MS : POLL_MS,
    );
  } catch (e) {
    if (errors + 1 >= 3)
      return fail(tid, (e as Error)?.message || 'Network error.');
    setTimeout(() => poll(tid, attempt + 1, errors + 1), POLL_MS);
  }
}

/** Picks up jobs that were running when the app closed (no toast: no one is waiting). */
export function resumeJobs() {
  Object.keys(state.jobs).forEach(tid => poll(Number(tid), 0, 0));
}

// --- Clear local cache ---

export async function deleteAllLocalFiles() {
  await files.remove(files.abs(DOCS_DIR)).catch(() => {});
  await files.remove(files.abs(ZIP_DIR)).catch(() => {});
  // Checklist attachments and Docs for Preparation copies (sharedProjects.ts).
  await files.remove(files.abs('attachments')).catch(() => {});
}

// --- CSV (BM Pro's columns); the export itself is in exportCsv.ts ---

const CSV_FIELDS: (keyof ServerTender)[] = [
  'tender_id',
  'title',
  'organization',
  'website_name',
  'location',
  'category',
  'tender_value',
  'emd',
  'published_date',
  'closing_date',
  'status',
];

export function toCsv(rows: Partial<ServerTender>[]) {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    CSV_FIELDS.join(','),
    ...rows.map(r => CSV_FIELDS.map(f => esc(r[f])).join(',')),
  ].join('\n');
}

// --- Hooks ---

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const useDocsForTender = (tenderId: number) =>
  useSyncExternalStore(
    subscribe,
    () => docsForTender(tenderId),
    () => docsForTender(tenderId),
  );
export const useDownloadHistory = () =>
  useSyncExternalStore(
    subscribe,
    () => history,
    () => history,
  );
export const useActiveDownloads = () =>
  useSyncExternalStore(
    subscribe,
    () => active,
    () => active,
  );
/** One document's row in any state (the history leaves out ones not on the device). */
export const useLocalDoc = (id: number) =>
  useSyncExternalStore(
    subscribe,
    () => state.docs.find(d => d.id === id) ?? null,
    () => state.docs.find(d => d.id === id) ?? null,
  );
export const useDocJob = (tenderId: number) =>
  useSyncExternalStore(
    subscribe,
    () => state.jobs[tenderId] ?? null,
    () => state.jobs[tenderId] ?? null,
  );
