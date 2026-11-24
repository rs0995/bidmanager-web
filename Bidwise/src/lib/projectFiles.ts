import { api } from './api';
import type { ServerFile, SharedChecklistItem } from './api';
import { getToken } from './auth';
import { signedUrl } from './documents';
import { BACKEND_URL } from './http';
import { readJSON, writeJSON } from './kv';
import {
  adoptServerCopy,
  ATTACHMENTS_DIR,
  getProjectsState,
  setFileHooks,
  setItemServerFile,
} from './sharedProjects';
import { onSynced, pushNow } from './sync';
import { files } from '../platform/files';

// Checklist files on the server (Server UI/server/API_CHANGES.md §3): the file attached
// to a checklist row is uploaded, so every device of the account or organisation can
// open it. One file per row and the first upload wins: a device that loses (409
// file_exists) downloads the winner and uses it. The row's `server_file` is the
// server's; this phone keeps its downloaded copies in a local-only map.

const COPIES_KEY = 'bw.serverFiles';
export const PROJECT_FILE_KEYS = [COPIES_KEY];

export const REPLACED_NOTE =
  'Another device attached a file to this row first — using that one.';

type Copies = Record<string, { fileId: number; rel: string }>;
const readCopies = () => readJSON<Copies>(COPIES_KEY, {});

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
const safeName = (name: string, itemId: number) =>
  (name || `file-${itemId}`).replace(/[/\\]/g, '-');
const relFor = (itemId: number, name: string) =>
  `${ATTACHMENTS_DIR}/${itemId}/${safeName(name, itemId)}`;
const rowOf = (itemId: number) =>
  getProjectsState().checklist.find(r => r.id === itemId);

type ErrorBody = {
  detail?: string | { reason?: string; message?: string; file?: ServerFile };
};
const detailOf = (json: unknown) => {
  const d = (json as ErrorBody | null)?.detail;
  return typeof d === 'object' && d ? d : { message: d || undefined };
};

/** This phone's own attached file for the row, if it is here. */
async function ownFile(row: SharedChecklistItem): Promise<string | null> {
  const a = row.attachment;
  if (!a || a.device !== 'phone') return null;
  const candidates = [
    a.uri ? decodeURI(a.uri.replace(/^file:\/\//, '')) : '',
    files.abs(relFor(row.id, a.name)),
  ].filter(Boolean);
  for (const p of candidates) {
    if (await files.exists(p).catch(() => false)) return p;
  }
  return null;
}

/** This phone's downloaded copy of the row's server file (null if stale or gone). */
export async function localCopy(
  row: SharedChecklistItem,
): Promise<string | null> {
  const c = readCopies()[String(row.id)];
  if (!c || !row.server_file || c.fileId !== row.server_file.id) return null;
  const abs = files.abs(c.rel);
  return (await files.exists(abs).catch(() => false)) ? abs : null;
}

function forget(itemId: number) {
  const copies = readCopies();
  if (!(String(itemId) in copies)) return;
  delete copies[String(itemId)];
  writeJSON(COPIES_KEY, copies);
}

/** Downloads a server file into attachments/<itemId>/ and remembers the copy. */
async function downloadTo(file: ServerFile, itemId: number): Promise<string> {
  const { url } = await api.projectFileDownload(file.id);
  const rel = relFor(itemId, file.name);
  const abs = files.abs(rel);
  await files.download(signedUrl(url), abs);
  writeJSON(COPIES_KEY, {
    ...readCopies(),
    [String(itemId)]: { fileId: file.id, rel },
  });
  return abs;
}

/** The row's file on this phone, downloading the server's copy when needed. */
export async function ensureItemFile(
  row: SharedChecklistItem,
): Promise<string | null> {
  const own = await ownFile(row);
  if (own) return own;
  const copy = await localCopy(row);
  if (copy) return copy;
  return row.server_file ? downloadTo(row.server_file, row.id) : null;
}

/**
 * Uploads the row's file from this phone. Resolves REPLACED_NOTE when another device's
 * file won (that file is now the row's here too); rejects with the server's message.
 */
export async function uploadItemFile(
  itemId: number,
): Promise<string | undefined> {
  const first = rowOf(itemId);
  if (!first || first.server_file) return undefined;
  const abs = await ownFile(first);
  const token = getToken();
  if (!abs || !token) return undefined;
  // The server only takes a file for a row it has.
  await pushNow().catch(() => false);
  let pushedAgain = false;
  let busy = 0;
  for (;;) {
    const row = rowOf(itemId);
    if (!row) return undefined; // deleted meanwhile
    const { status, json } = await files.upload(
      `${BACKEND_URL}/client/project-files`,
      { 'x-client-key': token, Accept: 'application/json' },
      {
        checklist_item_id: String(itemId),
        project_id: String(row.project_id),
        device: 'phone',
      },
      {
        abs,
        name: row.attachment?.name || `file-${itemId}`,
        type: row.attachment?.type,
      },
    );
    if (status >= 200 && status < 300) {
      setItemServerFile(itemId, (json as { file: ServerFile }).file);
      return undefined;
    }
    const d = detailOf(json);
    if (status === 404 && d.reason === 'row_not_found' && !pushedAgain) {
      pushedAgain = true;
      await pushNow().catch(() => false);
      continue;
    }
    if (status === 409 && d.reason === 'upload_in_progress' && busy < 3) {
      busy += 1;
      await sleep(3000);
      continue;
    }
    if (status === 409 && d.reason === 'file_exists' && d.file) {
      // First upload wins: use that file here too, in place of ours.
      const theirs = await downloadTo(d.file, itemId);
      if (theirs !== abs) await files.remove(abs).catch(() => {});
      adoptServerCopy(itemId, d.file, theirs);
      return REPLACED_NOTE;
    }
    throw new Error(d.message || `Upload failed (HTTP ${status}).`);
  }
}

/** Deletes the row's file on the server (best effort). */
export async function deleteItemFile(row: SharedChecklistItem) {
  if (!row.server_file) return;
  await api.deleteProjectFile(row.server_file.id).catch(() => {});
}

let backfilling: Promise<void> | null = null;

/**
 * Uploads files attached on this phone before the server kept them (or whose upload
 * failed): every row with this phone's file and no server_file. One at a time.
 */
export function backfillUploads(): Promise<void> {
  if (backfilling) return backfilling;
  backfilling = (async () => {
    const waiting = getProjectsState().checklist.filter(
      r => !r.server_file && r.attachment?.device === 'phone',
    );
    for (const r of waiting) {
      await uploadItemFile(r.id).catch(() => undefined);
    }
  })().finally(() => {
    backfilling = null;
  });
  return backfilling;
}

setFileHooks({
  upload: uploadItemFile,
  remove: deleteItemFile,
  localCopy,
  forget,
});
// After each sync: upload what is still waiting.
onSynced(() => {
  backfillUploads().catch(() => {});
});
