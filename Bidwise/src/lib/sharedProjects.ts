import { useSyncExternalStore } from 'react';
import type { SharedChecklistItem, SharedProject, ServerTender } from './api';
import { readJSON, writeJSON } from './kv';
import { schedulePush } from './pushQueue';
import { addAlert } from './alerts';
import { files } from '../platform/files';

// Projects + checklist, local-first, in the EXACT row format the desktop Client UI and
// BM Pro use: all three apps read and write the same /client/sync projects/checklist.
// Ported from BM Pro's lib/projects.js. Never add fields to these rows. Fields other
// apps own (the desktop's checklist_folders, an attachment's device) are kept as they come.
//
//   Project:        { id, title, client_name, source_tender_id, source_tender_db_id,
//                     project_value, emd, deadline, prebid, status, description }
//   Checklist item: { id, project_id, sr_no, req_file_name, description, subfolder,
//                     status: "Pending" | "Completed", attachment }
//
// Bidwise-only data ("Docs for Preparation") lives under its own local key and does
// not sync, so the other apps never see rows they don't understand.

const PROJECTS_KEY = 'bw.projects';
const CHECKLIST_KEY = 'bw.checklist';
const PREP_KEY = 'bw.prepDocs';
export const PROJECT_KEYS = [PROJECTS_KEY, CHECKLIST_KEY, PREP_KEY];

/** The desktop's default checklist folder; Bidwise's Ready for Bid items go here. */
export const READY_SUBFOLDER = 'Ready Docs';

/** Desktop statuses: "Active" while preparing; Bidwise adds "Submitted". */
export const STATUS_ACTIVE = 'Active';
export const STATUS_SUBMITTED = 'Submitted';
export const STATUS_ARCHIVED = 'Archived';

export type PrepDocRow = {
  id: string;
  name: string;
  size?: number | null;
  /** Path relative to Documents (attachments/prep/<projectId>/<id>/<name>). */
  rel?: string;
};

export type PickedAsset = {
  name: string;
  size?: number | null;
  mimeType?: string | null;
  uri: string;
};

type State = {
  projects: SharedProject[];
  checklist: SharedChecklistItem[];
  prep: Record<string, PrepDocRow[]>;
};

let state: State = { projects: [], checklist: [], prep: {} };
let nextProjectId = 1;
let nextItemId = 1;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach(fn => fn());

const maxId = (rows: { id: number }[]) =>
  rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);

export function rehydrateProjects() {
  state = {
    projects: readJSON<SharedProject[]>(PROJECTS_KEY, []),
    checklist: readJSON<SharedChecklistItem[]>(CHECKLIST_KEY, []),
    prep: readJSON<Record<string, PrepDocRow[]>>(PREP_KEY, {}),
  };
  nextProjectId = 1 + maxId(state.projects);
  nextItemId = 1 + maxId(state.checklist);
  emit();
}

function commit(next: Partial<State>, pushToServer = true) {
  state = { ...state, ...next };
  if (next.projects) writeJSON(PROJECTS_KEY, state.projects);
  if (next.checklist) writeJSON(CHECKLIST_KEY, state.checklist);
  if (next.prep) writeJSON(PREP_KEY, state.prep);
  emit();
  if (pushToServer && (next.projects || next.checklist)) schedulePush();
}

export const getProjectsState = () => state;

export function checklistFor(projectId: number): SharedChecklistItem[] {
  return state.checklist
    .filter(r => r.project_id === projectId)
    .sort((a, b) => (a.sr_no || 0) - (b.sr_no || 0));
}

/** Portal tender IDs compare without case or surrounding spaces. */
export const normRef = (ref: string | null | undefined) =>
  String(ref ?? '')
    .trim()
    .toUpperCase();

/**
 * The project already made from a tender, archived ones included: same server tender
 * (`source_tender_db_id`) or same portal tender ID (`source_tender_id`), so a project
 * started on the desktop or in BM Pro without the server id still counts.
 */
export function findProjectForTender(
  dbId: number | string | null | undefined,
  ref?: string | null,
): SharedProject | undefined {
  const id = dbId != null && String(dbId) !== '' ? String(dbId) : null;
  const r = normRef(ref);
  return state.projects.find(
    p =>
      (id !== null && String(p.source_tender_db_id ?? '') === id) ||
      (r !== '' && normRef(p.source_tender_id) === r),
  );
}

export function createProjectFromTender(t: ServerTender): SharedProject {
  const project: SharedProject = {
    id: nextProjectId++,
    title: t.title || t.tender_id || 'Untitled project',
    client_name: t.organization || t.website_name || '',
    source_tender_id: t.tender_id || '',
    source_tender_db_id: t.id ?? null,
    project_value: t.tender_value || 0,
    emd: t.emd || 0,
    deadline: t.closing_date || null,
    prebid: t.pre_bid_meeting_date || null,
    status: STATUS_ACTIVE,
    description: t.work_description || '',
  };
  commit({ projects: [...state.projects, project] });
  return project;
}

export function updateProject(id: number, patch: Partial<SharedProject>) {
  commit({
    projects: state.projects.map(p => (p.id === id ? { ...p, ...patch } : p)),
  });
}

/**
 * Deletes a project for good: its row, its checklist and its prep docs, with the files
 * saved on this phone. The next sync sends the removed ids, so it goes from the server
 * and the other apps too.
 */
export function deleteProject(id: number) {
  const items = state.checklist.filter(r => r.project_id === id);
  items.forEach(r => files.remove(files.abs(itemDir(r.id))).catch(() => {}));
  files.remove(files.abs(`${ATTACHMENTS_DIR}/prep/${id}`)).catch(() => {});
  const prep = { ...state.prep };
  delete prep[String(id)];
  commit({
    projects: state.projects.filter(p => p.id !== id),
    checklist: state.checklist.filter(r => r.project_id !== id),
    prep,
  });
}

export function addChecklistItem(
  projectId: number,
  reqFileName: string,
  description = '',
  subfolder = READY_SUBFOLDER,
): SharedChecklistItem {
  const item: SharedChecklistItem = {
    id: nextItemId++,
    project_id: projectId,
    sr_no: checklistFor(projectId).length + 1,
    req_file_name: reqFileName,
    description,
    subfolder,
    status: 'Pending',
    attachment: null,
  };
  commit({ checklist: [...state.checklist, item] });
  return item;
}

const mapItem = (
  itemId: number,
  fn: (r: SharedChecklistItem) => SharedChecklistItem,
) => state.checklist.map(r => (r.id === itemId ? fn(r) : r));

/** Raises "checklist complete" when this change finished the project's checklist. */
function maybeComplete(itemId: number, before: SharedChecklistItem[]) {
  const item = state.checklist.find(r => r.id === itemId);
  if (!item) return;
  const done = (rows: SharedChecklistItem[]) => {
    const mine = rows.filter(r => r.project_id === item.project_id);
    return mine.length > 0 && mine.every(r => r.status === 'Completed');
  };
  if (done(state.checklist) && !done(before)) {
    const p = state.projects.find(x => x.id === item.project_id);
    addAlert({
      kind: 'success',
      message: `“${p?.title ?? 'Project'}” is 100% ready for bid.`,
      projectId: String(item.project_id),
    });
  }
}

export function setChecklistStatus(
  itemId: number,
  status: 'Pending' | 'Completed',
) {
  const before = state.checklist;
  commit({ checklist: mapItem(itemId, r => ({ ...r, status })) });
  maybeComplete(itemId, before);
}

// --- Attachments ---
// Picked files are copied into the app's permanent Documents folder (the picker's copy
// lives in caches iOS may clear), so they still open after a restart. Same layout and
// fields as BM Pro: attachments/<itemId>/<name>, with device: "phone" telling other
// apps (and other phones) the stored uri only means something on this phone.

export const ATTACHMENTS_DIR = 'attachments';
const itemDir = (itemId: number) => `${ATTACHMENTS_DIR}/${itemId}`;
const prepDir = (projectId: number, docId: string) =>
  `${ATTACHMENTS_DIR}/prep/${projectId}/${docId}`;
const safeName = (name: string, fallback: string) =>
  (name || fallback).replace(/[/\\]/g, '-');

export async function attachToItem(itemId: number, a: PickedAsset) {
  const name = safeName(a.name, `attachment-${itemId}`);
  const dest = files.abs(`${itemDir(itemId)}/${name}`);
  await files.remove(files.abs(itemDir(itemId))).catch(() => {});
  let uri = dest;
  try {
    await files.copy(a.uri, dest);
  } catch {
    uri = a.uri; // keep the picker's copy rather than lose the attachment
  }
  const before = state.checklist;
  commit({
    checklist: mapItem(itemId, r => ({
      ...r,
      status: 'Completed',
      attachment: {
        name: a.name,
        size: a.size ?? null,
        type: a.mimeType ?? null,
        uri,
        device: 'phone',
      },
    })),
  });
  maybeComplete(itemId, before);
}

export function removeAttachment(itemId: number) {
  files.remove(files.abs(itemDir(itemId))).catch(() => {});
  commit({
    checklist: mapItem(itemId, r => ({
      ...r,
      status: 'Pending',
      attachment: null,
    })),
  });
}

/**
 * Where an attachment is on this phone, or why it can't be opened: attached on another
 * device, or the copy is gone. Checks the stored path, then the standard location
 * (iOS can move the app's folder between updates).
 */
export async function attachmentPath(
  row: SharedChecklistItem,
): Promise<{ path: string } | { reason: 'elsewhere' | 'missing' }> {
  const a = row.attachment;
  if (!a) return { reason: 'missing' };
  if (a.device !== 'phone') return { reason: 'elsewhere' };
  const candidates = [
    a.uri ? decodeURI(a.uri.replace(/^file:\/\//, '')) : '',
    files.abs(`${itemDir(row.id)}/${safeName(a.name, `attachment-${row.id}`)}`),
  ].filter(Boolean);
  for (const path of candidates) {
    if (await files.exists(path).catch(() => false)) return { path };
  }
  return { reason: 'missing' };
}

export async function addPrepDoc(projectId: number, a: PickedAsset) {
  const key = String(projectId);
  const id = `prep${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const rel = `${prepDir(projectId, id)}/${safeName(a.name, 'document')}`;
  await files.copy(a.uri, files.abs(rel));
  const row: PrepDocRow = { id, name: a.name, size: a.size ?? null, rel };
  commit({ prep: { ...state.prep, [key]: [...(state.prep[key] ?? []), row] } });
}

export function removePrepDoc(projectId: number, docId: string) {
  files.remove(files.abs(prepDir(projectId, docId))).catch(() => {});
  const key = String(projectId);
  commit({
    prep: {
      ...state.prep,
      [key]: (state.prep[key] ?? []).filter(d => d.id !== docId),
    },
  });
}

/** Absolute path of a prep doc still on this phone, else null. */
export async function prepDocPath(projectId: number, docId: string) {
  const d = (state.prep[String(projectId)] ?? []).find(x => x.id === docId);
  if (!d?.rel) return null;
  const abs = files.abs(d.rel);
  return (await files.exists(abs).catch(() => false)) ? abs : null;
}

/**
 * Applies the server's rows. Attachments stay as this device last saw them, because
 * the picked file only exists here (same rule as BM Pro).
 */
export function mergeFromServer(
  projects: SharedProject[] | undefined,
  checklist: SharedChecklistItem[] | undefined,
) {
  const next: Partial<State> = {};
  if (Array.isArray(projects)) {
    next.projects = projects.map(p => ({ ...p }));
    nextProjectId = 1 + maxId(next.projects);
  }
  if (Array.isArray(checklist)) {
    const local = new Map(state.checklist.map(r => [r.id, r]));
    next.checklist = checklist.map(r => ({
      ...r,
      attachment: local.get(r.id)?.attachment ?? r.attachment ?? null,
    }));
    nextItemId = 1 + maxId(next.checklist);
  }
  // A sync that changes nothing must not re-render every project screen.
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  if (next.projects && same(next.projects, state.projects))
    delete next.projects;
  if (next.checklist && same(next.checklist, state.checklist))
    delete next.checklist;
  if (!next.projects && !next.checklist) return;
  commit(next, false);
}

export const forSync = () => ({
  projects: state.projects,
  checklist: state.checklist,
});

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const useProjectsState = () =>
  useSyncExternalStore(subscribe, getProjectsState, getProjectsState);
