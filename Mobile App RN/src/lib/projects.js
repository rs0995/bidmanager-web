import { useSyncExternalStore } from "react";
import { getRaw, setRaw } from "./kv.js";
import { schedulePush } from "./sync.js";
import { addAlert } from "./alerts.js";

// Local-first projects + checklist. Field names are made to match the
// desktop Client UI rows EXACTLY, because both apps read/write the same
// /client/sync projects/checklist blob fields.
//   Project:        { id, title, client_name, source_tender_id,
//                      source_tender_db_id, project_value, emd, deadline,
//                      prebid, status, description }
//   Checklist item: { id, project_id, sr_no, req_file_name, description,
//                      subfolder, status: "Pending" | "Completed",
//                      attachment }
//
// File attachments are NOT fully persisted: only {name, size, type, uri}
// metadata is stored, and the live picked-asset reference is kept in an
// in-memory Map keyed by checklist item id, so a preview only reliably
// works for files attached this session (same limitation as the web app,
// which could not persist a File object across reloads either).
const PROJECTS_KEY = "bm.projects";
const CHECKLIST_KEY = "bm.checklist";
const DEFAULT_FOLDERS = ["Ready Docs", "Tender Docs", "Working Docs"];

const fileObjects = new Map();

const listeners = new Set();
function emit() {
  listeners.forEach((fn) => fn());
}

function readJSON(key, fallback) {
  try {
    const raw = getRaw(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key, value) {
  setRaw(key, JSON.stringify(value));
}

let projectsCache = readJSON(PROJECTS_KEY, []);
let checklistCache = readJSON(CHECKLIST_KEY, []);
let nextProjectId = 1 + projectsCache.reduce((m, p) => Math.max(m, p.id), 0);
let nextItemId = 1 + checklistCache.reduce((m, c) => Math.max(m, c.id), 0);
let checklistViewCache = new Map();

export function rehydrateProjects() {
  projectsCache = readJSON(PROJECTS_KEY, []);
  checklistCache = readJSON(CHECKLIST_KEY, []);
  nextProjectId = 1 + projectsCache.reduce((m, p) => Math.max(m, p.id), 0);
  nextItemId = 1 + checklistCache.reduce((m, c) => Math.max(m, c.id), 0);
  checklistViewCache = new Map();
  emit();
}

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

export function getChecklist(projectId) {
  const key = Number(projectId);
  if (!checklistViewCache.has(key)) {
    const rows = checklistCache.filter((row) => row.project_id === key);
    rows.sort((a, b) => (a.sr_no || 0) - (b.sr_no || 0));
    checklistViewCache.set(key, rows);
  }
  return checklistViewCache.get(key);
}
export function getProject(id) {
  return projectsCache.find((row) => row.id === Number(id)) || null;
}

export function createProjectFromTender(tender) {
  const project = {
    id: nextProjectId++,
    title: tender.title || tender.tender_id || "Untitled project",
    client_name: tender.organization || tender.website_name || "",
    source_tender_id: tender.tender_id || "",
    source_tender_db_id: tender.id ?? null,
    project_value: tender.tender_value || 0,
    emd: tender.emd || 0,
    deadline: tender.closing_date || null,
    prebid: tender.pre_bid_meeting_date || null,
    status: "Active",
    description: tender.work_description || "",
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
  updateProject(id, { status: "Archived" });
}

export function folderNames(projectId) {
  const used = getChecklist(projectId).map((row) => row.subfolder);
  return [...new Set([...DEFAULT_FOLDERS, ...used])];
}

export function addChecklistItem(projectId, { req_file_name, subfolder, description }) {
  const siblings = getChecklist(projectId);
  const item = {
    id: nextItemId++,
    project_id: Number(projectId),
    sr_no: siblings.length + 1,
    req_file_name,
    subfolder: subfolder || DEFAULT_FOLDERS[0],
    description: description || "",
    status: "Pending",
    attachment: null,
  };
  checklistCache = [...checklistCache, item];
  persist();
  return item;
}

export function setChecklistItemStatus(itemId, status) {
  let justCompleted = false;
  checklistCache = checklistCache.map((row) => {
    if (row.id !== Number(itemId)) return row;
    justCompleted = status === "Completed" && row.status !== "Completed";
    return { ...row, status };
  });
  persist();
  if (justCompleted) maybeNotifyProjectComplete(itemId);
}

function maybeNotifyProjectComplete(itemId) {
  const item = checklistCache.find((row) => row.id === Number(itemId));
  if (!item) return;
  const siblings = getChecklist(item.project_id);
  if (siblings.length > 0 && siblings.every((row) => row.status === "Completed")) {
    const project = getProject(item.project_id);
    addAlert({ kind: "success", message: `"${project?.title || "Project"}" checklist reached 100%.` });
  }
}

// asset: a document-picker result shaped { name, size, mimeType, uri }.
export function attachFile(itemId, asset) {
  fileObjects.set(Number(itemId), asset);
  checklistCache = checklistCache.map((row) => (
    row.id === Number(itemId)
      ? { ...row, attachment: { name: asset.name, size: asset.size, type: asset.mimeType, uri: asset.uri }, status: "Completed" }
      : row
  ));
  persist();
  maybeNotifyProjectComplete(itemId);
}

export function removeAttachment(itemId) {
  fileObjects.delete(Number(itemId));
  checklistCache = checklistCache.map((row) => (
    row.id === Number(itemId) ? { ...row, attachment: null, status: "Pending" } : row
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

export function mergeFromServer(serverProjects, serverChecklist) {
  if (Array.isArray(serverProjects)) {
    projectsCache = serverProjects.map((row) => ({ ...row }));
    nextProjectId = 1 + projectsCache.reduce((m, p) => Math.max(m, Number(p.id) || 0), 0);
  }
  if (Array.isArray(serverChecklist)) {
    const localById = new Map(checklistCache.map((row) => [row.id, row]));
    checklistCache = serverChecklist.map((row) => {
      const local = localById.get(row.id);
      return { ...row, attachment: local?.attachment ?? row.attachment ?? null };
    });
    nextItemId = 1 + checklistCache.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0);
  }
  persist(false);
}

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
