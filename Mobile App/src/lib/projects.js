import { useSyncExternalStore } from 'react';
import { schedulePush } from './sync.js';
import { addAlert } from './alerts.js';

// Local-first projects + checklist, mirroring the shape of the desktop
// Client UI's `project`/`checklist` rows (Client UI/src/lib/api.js) closely
// enough that /client/sync's shared blob can carry them cross-device (see
// sync.js). There is no /client/* endpoint for projects — same as desktop.
//
// File attachments are NOT persisted (a File object can't survive
// localStorage/JSON): only {name, size, type} metadata is stored, and the
// live File is kept in an in-memory Map keyed by checklist item id, so a
// preview only works for files attached this session. This is called out
// in the UI rather than pretended away.
const PROJECTS_KEY = 'bm.projects';
const CHECKLIST_KEY = 'bm.checklist';
const DEFAULT_FOLDERS = ['Ready Docs', 'Tender Docs', 'Working Docs'];

const fileObjects = new Map(); // checklist item id -> File

const listeners = new Set();
function emit() {
  listeners.forEach((fn) => fn());
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

let projectsCache = readJSON(PROJECTS_KEY, []);
let checklistCache = readJSON(CHECKLIST_KEY, []);
let nextProjectId = 1 + projectsCache.reduce((m, p) => Math.max(m, p.id), 0);
let nextItemId = 1 + checklistCache.reduce((m, c) => Math.max(m, c.id), 0);

function persist(pushToServer = true) {
  writeJSON(PROJECTS_KEY, projectsCache);
  writeJSON(CHECKLIST_KEY, checklistCache);
  checklistViewCache = new Map();
  emit();
  if (pushToServer) schedulePush();
}

export function getProjects() {
  return projectsCache;
}

// getSnapshot for useSyncExternalStore must be referentially stable between
// real changes (see the store.js comment / this session's earlier
// black-screen bug), so per-project checklist views are memoized and only
// recomputed when checklistCache itself changes (checklistViewCache is
// cleared in persist()).
let checklistViewCache = new Map();
export function getChecklist(projectId) {
  const key = Number(projectId);
  if (!checklistViewCache.has(key)) {
    checklistViewCache.set(key, checklistCache.filter((row) => row.project_id === key));
  }
  return checklistViewCache.get(key);
}
export function getProject(id) {
  return projectsCache.find((row) => row.id === Number(id)) || null;
}

export function createProjectFromTender(tender) {
  const project = {
    id: nextProjectId++,
    title: tender.title || tender.tender_id || 'Untitled project',
    client: tender.organization || tender.website_name || '',
    source_tender_id: tender.tender_id || '',
    project_value: tender.tender_value || 0,
    emd: tender.emd || 0,
    deadline: tender.closing_date || null,
    prebid: tender.pre_bid_meeting_date || null,
    status: 'Active',
    description: tender.work_description || '',
  };
  projectsCache = [...projectsCache, project];
  persist();
  return project;
}

export function updateProject(id, patch) {
  projectsCache = projectsCache.map((row) => (row.id === Number(id) ? { ...row, ...patch } : row));
  persist();
}

export function archiveProject(id) {
  updateProject(id, { status: 'Archived' });
}

export function folderNames(projectId) {
  const used = getChecklist(projectId).map((row) => row.folder);
  return [...new Set([...DEFAULT_FOLDERS, ...used])];
}

export function addChecklistItem(projectId, { name, folder, note }) {
  const item = {
    id: nextItemId++,
    project_id: Number(projectId),
    name,
    folder: folder || DEFAULT_FOLDERS[0],
    note: note || '',
    done: false,
    attachment: null, // { name, size, type } — see fileObjects for the live File
  };
  checklistCache = [...checklistCache, item];
  persist();
  return item;
}

export function toggleChecklistItem(itemId, done) {
  let justCompleted = false;
  checklistCache = checklistCache.map((row) => {
    if (row.id !== Number(itemId)) return row;
    justCompleted = done && !row.done;
    return { ...row, done };
  });
  persist();
  maybeNotifyProjectComplete(itemId, justCompleted);
}

function maybeNotifyProjectComplete(itemId) {
  const item = checklistCache.find((row) => row.id === Number(itemId));
  if (!item) return;
  const siblings = getChecklist(item.project_id);
  if (siblings.length > 0 && siblings.every((row) => row.done)) {
    const project = getProject(item.project_id);
    addAlert({ kind: 'success', message: `"${project?.title || 'Project'}" checklist reached 100%.` });
  }
}

export function attachFile(itemId, file) {
  fileObjects.set(Number(itemId), file);
  checklistCache = checklistCache.map((row) => (
    row.id === Number(itemId)
      ? { ...row, attachment: { name: file.name, size: file.size, type: file.type }, done: true }
      : row
  ));
  persist();
}

export function removeAttachment(itemId) {
  fileObjects.delete(Number(itemId));
  checklistCache = checklistCache.map((row) => (
    row.id === Number(itemId) ? { ...row, attachment: null, done: false } : row
  ));
  persist();
}

export function getAttachedFile(itemId) {
  return fileObjects.get(Number(itemId)) || null;
}

export function deleteChecklistItem(itemId) {
  fileObjects.delete(Number(itemId));
  checklistCache = checklistCache.filter((row) => row.id !== Number(itemId));
  persist();
}

// Called by sync.js when a /client/sync pull brings in projects/checklist
// from another device. Local-only fields (attachment metadata refers to a
// File that only exists on the device that attached it) are dropped on pull
// from a foreign write, but preserved when the row is this device's own.
export function mergeFromServer(serverProjects, serverChecklist) {
  // Additive merge, not a replace: a project/checklist row created locally
  // seconds ago may not have round-tripped through a successful push yet
  // (schedulePush debounces 2s and silently swallows failures), so a pull
  // that races ahead of it must not delete it. Anything the server DOES
  // know about wins (it's the merged, cross-device truth); anything only
  // known locally is kept alongside it.
  if (Array.isArray(serverProjects)) {
    const localById = new Map(projectsCache.map((row) => [row.id, row]));
    const merged = serverProjects.map((row) => ({ ...localById.get(row.id), ...row }));
    const serverIds = new Set(serverProjects.map((row) => row.id));
    const localOnly = projectsCache.filter((row) => !serverIds.has(row.id));
    projectsCache = [...merged, ...localOnly];
    nextProjectId = 1 + projectsCache.reduce((m, p) => Math.max(m, p.id), 0);
  }
  if (Array.isArray(serverChecklist)) {
    const localById = new Map(checklistCache.map((row) => [row.id, row]));
    const merged = serverChecklist.map((row) => {
      const local = localById.get(row.id);
      // Keep this device's own attachment metadata (the File itself only
      // lives in fileObjects on the device that attached it).
      return { ...row, attachment: local?.attachment ?? row.attachment ?? null };
    });
    const serverIds = new Set(serverChecklist.map((row) => row.id));
    const localOnly = checklistCache.filter((row) => !serverIds.has(row.id));
    checklistCache = [...merged, ...localOnly];
    nextItemId = 1 + checklistCache.reduce((m, c) => Math.max(m, c.id), 0);
  }
  persist(false);
}

// What actually travels through /client/sync — attachment metadata (name/
// size/type) is fine to sync (it's just informational text), the File
// object obviously never leaves this device.
export function forSync() {
  return { projects: projectsCache, checklist: checklistCache };
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useProjects() {
  return useSyncExternalStore(subscribe, getProjects, getProjects);
}
export function useChecklist(projectId) {
  return useSyncExternalStore(subscribe, () => getChecklist(projectId), () => getChecklist(projectId));
}
export function useProject(id) {
  return useSyncExternalStore(subscribe, () => getProject(id), () => getProject(id));
}
