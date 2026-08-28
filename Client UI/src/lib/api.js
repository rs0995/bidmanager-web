import { getState, nextId, updateState } from './db.js';
import { useAppStore } from './store';
import { DEFAULT_SERVER_URL } from './cloud-config.js';

const desktop = () => window.bidmanagerDesktop;
const leaf = (value) => String(value || 'Project').replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Project';
const joinPath = (...parts) => parts.filter(Boolean).join('\\').replace(/[\\/]+/g, '\\');
const valueNumber = (value) => Number(String(value || '').replace(/[^0-9.]/g, '')) || 0;

function filterRows(rows, search, fields) {
  const q = String(search || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => fields.some((key) => String(row[key] ?? '').toLowerCase().includes(q)));
}

function normalizeServerUrl(value) {
  const raw = String(value || DEFAULT_SERVER_URL).trim().replace(/\/+$/, '');
  let parsed;
  try { parsed = new URL(raw); } catch (_) { throw new Error('Enter a valid backend URL.'); }
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Backend URL must use HTTP or HTTPS.');
  return raw;
}

// Set by signIn() when "Remember me" is unchecked: holds the session's auth
// profile in memory only, so it never reaches IndexedDB and disappears the
// next time the app launches. Takes priority over persisted settings.
let sessionAuth = null;

async function connection(overrides = {}) {
  const settings = await getState().then((state) => state.settings);
  return {
    server_url: normalizeServerUrl(overrides.server_url ?? settings.server_url),
    auth_token: String(overrides.auth_token ?? sessionAuth?.auth_token ?? settings.auth_token ?? '').trim(),
  };
}

// Thrown when the server rejects the request as unauthenticated (401, no/expired
// token) or forbidden (403, suspended account) — the UI catches this by name to
// clear local auth state and return to the sign-in screen, distinct from an
// ordinary network/validation error.
export class AuthError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'AuthError';
    this.reason = reason || 'unauthorized';
  }
}

async function requestClient(route, options = {}, overrides = {}, { requireAuth = true } = {}) {
  if (!String(route).startsWith('/client/')) throw new Error('Only /client/* API routes are allowed.');
  const config = await connection(overrides);
  if (requireAuth && !config.auth_token) throw new AuthError('Sign in to continue.', 'unauthorized');
  const method = String(options.method || 'GET').toUpperCase();
  if (desktop()?.clientApiRequest) {
    const result = await desktop().clientApiRequest({
      baseUrl: config.server_url,
      clientKey: config.auth_token,
      route,
      method,
      body: options.body,
    });
    if (!result?.ok) {
      if (result?.status === 401 || result?.status === 403) {
        throw new AuthError(result?.message || 'Sign in again.', result?.reason || 'unauthorized');
      }
      throw new Error(result?.message || 'Could not reach the client API.');
    }
    return result.data;
  }
  const headers = { Accept: 'application/json' };
  if (config.auth_token) headers['x-client-key'] = config.auth_token;
  const fetchOptions = { method, headers };
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(options.body ?? {});
  }
  const response = await fetch(`${config.server_url}${route}`, fetchOptions);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.detail;
    const message = (detail && typeof detail === 'object' ? detail.message : detail)
      || `Client API returned HTTP ${response.status}.`;
    if (response.status === 401 || response.status === 403) {
      throw new AuthError(message, (detail && typeof detail === 'object' ? detail.reason : null) || 'unauthorized');
    }
    throw new Error(message);
  }
  return payload;
}

// Wraps updateState() for mutations that touch cloud-synced data (bookmarks,
// templates, projects, checklist) — after the local write lands, it schedules
// a debounced push to /client/sync so other devices pick it up. Rapid edits
// collapse into one push instead of one per keystroke/toggle; failures are
// swallowed (offline-tolerant, matches the app's existing sync posture) and
// never block the caller, since the local write already succeeded.
let _syncPushTimer = null;
function updateSyncedState(mutator) {
  const result = updateState(mutator);
  clearTimeout(_syncPushTimer);
  _syncPushTimer = setTimeout(() => { api.pushUserData().catch(() => {}); }, 2000);
  return result;
}

function normalizeTender(row) {
  return {
    ...row,
    org_chain: row.org_chain ?? row.organization ?? '',
    tender_category: row.tender_category ?? row.category ?? '',
  };
}

async function downloadServerOrganizations(overrides = {}) {
  const organizations = [];
  let page = 1;
  let pages = 1;
  do {
    const payload = await requestClient(
      `/client/organizations?page=${page}&page_size=100`, {}, overrides,
    );
    if (!payload || !Array.isArray(payload.items)) break;
    organizations.push(...payload.items.map((row) => ({ id: row.id, website_id: row.website_id, name: row.name })));
    pages = Math.max(0, Number(payload.pages) || 0);
    page += 1;
    if (page > 1000) break;
  } while (page <= pages);
  return organizations;
}

async function downloadServerSnapshot(overrides = {}) {
  await requestClient('/client/health', {}, overrides);
  const tenders = [];
  let page = 1;
  let pages = 1;
  do {
    const payload = await requestClient(
      `/client/tenders?page=${page}&page_size=100&sort_by=id&sort_order=asc`, {}, overrides,
    );
    if (!payload || !Array.isArray(payload.items)) throw new Error('Invalid tender-list response from server.');
    tenders.push(...payload.items.map(normalizeTender));
    pages = Math.max(0, Number(payload.pages) || 0);
    page += 1;
    if (page > 1000) throw new Error('Server pagination exceeded the safe import limit.');
  } while (page <= pages);
  const serverStats = await requestClient('/client/stats', {}, overrides);
  // Best-effort: the org cache only feeds the bookmark->id lookup for cloud
  // sync (see pushUserData) — a failure here shouldn't block a tender sync.
  const organizations = await downloadServerOrganizations(overrides).catch(() => []);
  const websiteMap = new Map();
  tenders.forEach((tender) => {
    const id = Number(tender.website_id);
    if (!Number.isFinite(id)) return;
    const current = websiteMap.get(id) || { id, name: tender.website_name || `Website ${id}`, orgs: 0, active_tenders: 0, selected_orgs: 0 };
    if (!tender.is_archived) current.active_tenders += 1;
    websiteMap.set(id, current);
  });
  const websites = [...websiteMap.values()].map((website) => ({
    ...website,
    orgs: new Set(tenders.filter((t) => Number(t.website_id) === website.id).map((t) => t.org_chain).filter(Boolean)).size,
  }));
  return { websites, tenders, organizations, server_stats: serverStats };
}

export const api = {
  defaultServerUrl: DEFAULT_SERVER_URL,
  health: (overrides = {}) => requestClient('/client/health', {}, overrides),
  testConnection: (overrides = {}) => requestClient('/client/health', {}, overrides),
  getTenderDetail: (id, overrides = {}) => requestClient(`/client/tenders/${Number(id)}`, {}, overrides),
  listTenderDocuments: (id, params = {}, overrides = {}) => {
    const query = new URLSearchParams({
      page: String(params.page || 1),
      page_size: String(params.page_size || 25),
      sort_by: String(params.sort_by || 'downloaded_at'),
      sort_order: String(params.sort_order || 'desc'),
    });
    if (params.file_type) query.set('file_type', params.file_type);
    return requestClient(`/client/tenders/${Number(id)}/documents?${query}`, {}, overrides);
  },
  requestDocumentDownload: (tenderId, documentId, overrides = {}) => requestClient(
    `/client/tenders/${Number(tenderId)}/download-request`,
    { method: 'POST', body: { document_id: Number(documentId) } },
    overrides,
  ),
  // Kicks off the server-side scrape/download job for a tender that has no
  // documents yet (see Server UI/server/client_api.py request-download).
  requestTenderDownloadJob: (tenderId, overrides = {}) => requestClient(
    `/client/tenders/${Number(tenderId)}/request-download`,
    { method: 'POST', body: {} },
    overrides,
  ),
  getTenderDownloadStatus: (tenderId, jobId, overrides = {}) => requestClient(
    `/client/tenders/${Number(tenderId)}/download-status?job_id=${encodeURIComponent(jobId)}`,
    {}, overrides,
  ),

  // ── Document download tracking (local-first: one cached row per server
  // document, plus a locally-issued placeholder row while a whole-tender
  // request has no document yet). Every UI button reads client_status/
  // local_path/downloadable straight off these rows — never a derived count.
  listAllDocuments: async () => (await getState()).documents,
  listDocuments: async (tenderDbId) => (
    (await getState()).documents.filter((row) => Number(row.tender_db_id) === Number(tenderDbId))
  ),
  listPendingDocuments: async () => (
    (await getState()).documents.filter((row) => row.client_status === 'requested')
  ),
  upsertDocument: async (patch) => {
    if (!patch || patch.id == null) throw new Error('upsertDocument requires an id.');
    let result;
    await updateState((state) => {
      const idx = state.documents.findIndex((row) => row.id === patch.id);
      const base = idx >= 0 ? state.documents[idx] : {
        file_name: '', file_type: 'document', size_bytes: 0, downloadable: false,
        client_status: 'synced', local_path: null, requested_at: null, downloaded_at: null, error: null,
      };
      result = { ...base, ...patch, updated_at: new Date().toISOString() };
      if (idx >= 0) state.documents[idx] = result; else state.documents.push(result);
      return state;
    });
    return result;
  },
  removeDocument: async (id) => updateState((state) => {
    state.documents = state.documents.filter((row) => row.id !== id);
    return state;
  }),
  // Pulls the real document list for a tender and merges it into the local
  // cache, keyed by server document id. Local-only fields already set on a
  // matching row (client_status/local_path/etc.) are preserved. If the server
  // still has nothing for this tender, the local placeholder row (if any) is
  // left untouched rather than being wiped.
  syncTenderDocuments: async (tender, params = {}, overrides = {}) => {
    const tenderDbId = Number(tender.id);
    const payload = await api.listTenderDocuments(tenderDbId, params, overrides);
    const serverRows = payload.items || [];
    if (serverRows.length === 0) return serverRows;
    await updateState((state) => {
      const others = state.documents.filter((row) => Number(row.tender_db_id) !== tenderDbId);
      const existingById = new Map(
        state.documents.filter((row) => Number(row.tender_db_id) === tenderDbId).map((row) => [row.id, row])
      );
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
          local_path: existing?.local_path || null,
          requested_at: existing?.requested_at || null,
          downloaded_at: existing?.downloaded_at || null,
          updated_at: new Date().toISOString(),
          error: existing?.error || null,
        };
      });
      // Real rows now exist server-side, so the locally-issued placeholder
      // request row (negative id) for this tender is superseded.
      state.documents = [...others, ...merged];
      return state;
    });
    return serverRows;
  },
  // "Request Download" — asks the server to fetch a tender with no documents
  // yet. Records a local placeholder row so the button becomes disabled
  // "Download Requested" and stays that way across restarts, then polls the
  // job in the background and refreshes the real document list once it lands.
  requestTenderDownload: async (tender, overrides = {}) => {
    const { job_id: jobId } = await api.requestTenderDownloadJob(tender.id, overrides);
    const placeholder = await api.upsertDocument({
      id: -Number(tender.id),
      tender_db_id: Number(tender.id),
      tender_id: tender.tender_id || '',
      tender_title: tender.title || '',
      file_name: '', file_type: '', size_bytes: 0, downloadable: false,
      client_status: 'requested',
      local_path: null,
      requested_at: new Date().toISOString(),
      downloaded_at: null,
      error: null,
    });
    api.pollTenderDownloadJob(tender, jobId, overrides, 0);
    return placeholder;
  },
  // Fire-and-forget: polls the server download job every 15s (capped at ~10
  // minutes) until it completes or fails, then refreshes this tender's real
  // document list or marks the placeholder row failed with the server's reason.
  pollTenderDownloadJob: async (tender, jobId, overrides = {}, attempt = 0) => {
    const MAX_ATTEMPTS = 40;
    try {
      const { status, error } = await api.getTenderDownloadStatus(tender.id, jobId, overrides);
      if (status === 'completed') {
        await api.removeDocument(-Number(tender.id));
        await api.syncTenderDocuments(tender, {}, overrides);
        return;
      }
      if (status === 'failed') {
        await api.upsertDocument({ id: -Number(tender.id), client_status: 'failed', error: error || 'Download failed.' });
        return;
      }
      if (attempt >= MAX_ATTEMPTS) {
        await api.upsertDocument({ id: -Number(tender.id), client_status: 'failed', error: 'Timed out waiting for the server.' });
        return;
      }
      setTimeout(() => api.pollTenderDownloadJob(tender, jobId, overrides, attempt + 1), 15000);
    } catch (error) {
      await api.upsertDocument({ id: -Number(tender.id), client_status: 'failed', error: error?.message || String(error) });
    }
  },
  // "Download" — mint a signed URL for an already-available document, then
  // save it to disk via the Electron IPC bridge (or fall back to a plain
  // browser download when running outside Electron, where the destination
  // folder can't be controlled).
  downloadDocument: async (doc, overrides = {}) => {
    await api.upsertDocument({ id: doc.id, client_status: 'downloading', error: null });
    try {
      const { url } = await api.requestDocumentDownload(doc.tender_db_id, doc.id, overrides);
      const bridge = desktop();
      if (bridge?.downloadFile) {
        const settings = (await getState()).settings;
        const parentDir = String(settings.parent_dir || '').trim();
        if (!parentDir) throw new Error('Set a parent folder in Settings before downloading files.');
        const destinationPath = joinPath(parentDir, 'Tender_Downloads', leaf(doc.tender_id), leaf(doc.file_name));
        const result = await bridge.downloadFile({ url, destinationPath });
        if (!result?.ok) throw new Error(result?.message || 'Download failed.');
        return api.upsertDocument({
          id: doc.id, client_status: 'downloaded', local_path: result.path,
          downloaded_at: new Date().toISOString(), error: null,
        });
      }
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = doc.file_name || '';
      anchor.rel = 'noopener';
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return api.upsertDocument({
        id: doc.id, client_status: 'downloaded', local_path: null,
        downloaded_at: new Date().toISOString(), error: null,
      });
    } catch (error) {
      await api.upsertDocument({ id: doc.id, client_status: 'failed', error: error?.message || String(error) });
      throw error;
    }
  },

  listWebsites: async () => (await getState()).websites,
  listTenders: async (websiteId, params = {}) => {
    let rows = (await getState()).tenders;
    if (websiteId != null) rows = rows.filter((row) => Number(row.website_id) === Number(websiteId));
    if (params.archived !== undefined) rows = rows.filter((row) => Boolean(row.is_archived) === Boolean(params.archived));
    if (params.bookmarked !== undefined) rows = rows.filter((row) => Boolean(row.is_bookmarked) === Boolean(params.bookmarked));
    rows = filterRows(rows, params.search, ['tender_id', 'title', 'org_chain', 'location', 'tender_category']);
    return rows.slice(0, Number(params.limit) || rows.length);
  },
  patchTender: async (id, patch) => {
    let result;
    await updateSyncedState((state) => {
      state.tenders = state.tenders.map((row) => row.id === id ? (result = { ...row, ...patch }) : row);
      return state;
    });
    return result;
  },
  countBookmarkedTenders: async () => (await getState()).tenders.filter((row) => row.is_bookmarked).length,

  listBookmarkedOrgs: async () => (await getState()).bookmarkedOrgs || [],
  toggleOrgBookmark: async (orgChain) => {
    const org = String(orgChain || '').trim();
    let result;
    await updateSyncedState((state) => {
      const set = new Set(state.bookmarkedOrgs || []);
      if (set.has(org)) set.delete(org); else set.add(org);
      state.bookmarkedOrgs = [...set];
      result = state.bookmarkedOrgs;
      return state;
    });
    return result;
  },

  listProjects: async (search = '', status = '') => {
    let rows = (await getState()).projects;
    if (status) rows = rows.filter((row) => String(row.status || 'Active').toLowerCase() === String(status).toLowerCase());
    return filterRows(rows, search, ['title', 'client_name', 'source_tender_id', 'description']);
  },
  createProject: async (data) => {
    let result;
    await updateSyncedState((state) => {
      result = { id: nextId(state.projects), folder_path: null, ...data, status: data.status || 'Active' };
      state.projects.push(result);
      return state;
    });
    return result;
  },
  getProject: async (id) => {
    const result = (await getState()).projects.find((row) => row.id === Number(id));
    if (!result) throw new Error('Project not found.');
    return result;
  },
  updateProject: async (id, patch) => {
    let result;
    await updateSyncedState((state) => {
      state.projects = state.projects.map((row) => row.id === Number(id) ? (result = { ...row, ...patch }) : row);
      return state;
    });
    return result;
  },
  archiveProject: (id) => api.updateProject(id, { status: 'Archived' }),
  deleteProject: async (id) => updateSyncedState((state) => {
    state.projects = state.projects.filter((row) => row.id !== Number(id));
    state.checklist = state.checklist.filter((row) => row.project_id !== Number(id));
    return state;
  }),
  getProjectsRootFolder: async (archived = false) => {
    const settings = (await getState()).settings;
    const name = archived ? 'Archived Projects' : 'My_Tender_Projects';
    return { root_folder: settings.parent_dir ? joinPath(settings.parent_dir, name) : '' };
  },
  ensureProjectFolder: async (id) => {
    const project = await api.getProject(id);
    if (project.folder_path) return { ok: true, folder_path: project.folder_path };
    const root = (await api.getProjectsRootFolder(false)).root_folder;
    if (!root) return { ok: false, folder_path: '', message: 'Choose a parent folder in Settings.' };
    const folderPath = joinPath(root, `${id} - ${leaf(project.title)}`);
    const bridge = desktop();
    if (bridge?.ensureProjectFolders) {
      const made = await bridge.ensureProjectFolders(folderPath);
      if (!made?.ok) throw new Error(made?.message || 'Could not create project folder.');
    }
    await api.updateProject(id, { folder_path: folderPath });
    return { ok: true, folder_path: folderPath };
  },
  restoreProjectsFromFolders: async () => ({ root_folder: (await api.getProjectsRootFolder()).root_folder, scanned_folders: 0, created_projects: 0, updated_projects: 0, restored_checklist_items: 0 }),

  listChecklist: async (projectId) => (await getState()).checklist.filter((row) => row.project_id === Number(projectId)).sort((a, b) => a.sr_no - b.sr_no),
  createChecklistItem: async (projectId, data) => {
    let result;
    await updateSyncedState((state) => {
      const siblings = state.checklist.filter((row) => row.project_id === Number(projectId));
      result = { id: nextId(state.checklist), project_id: Number(projectId), sr_no: data.sr_no || siblings.length + 1, req_file_name: '', description: '', subfolder: 'Ready Docs', linked_file_path: '', status: 'Pending', ...data };
      state.checklist.push(result);
      return state;
    });
    return result;
  },
  updateChecklistItem: async (id, patch) => updateSyncedState((state) => {
    state.checklist = state.checklist.map((row) => row.id === Number(id) ? { ...row, ...patch } : row);
    return state;
  }),
  deleteChecklistItem: async (id) => updateSyncedState((state) => {
    state.checklist = state.checklist.filter((row) => row.id !== Number(id));
    return state;
  }),

  listTemplates: async (organization = '') => filterRows((await getState()).templates, organization, ['organization']),
  createTemplate: async (data) => {
    let result;
    await updateSyncedState((state) => {
      result = { id: nextId(state.templates), template_no: null, description: '', notes: '', ...data };
      state.templates.push(result);
      return state;
    });
    return result;
  },
  updateTemplate: async (id, patch) => {
    let result;
    await updateSyncedState((state) => {
      state.templates = state.templates.map((row) => row.id === Number(id) ? (result = { ...row, ...patch }) : row);
      return state;
    });
    return result;
  },
  deleteTemplate: async (id) => updateSyncedState((state) => {
    state.templates = state.templates.filter((row) => row.id !== Number(id));
    state.templateItems = state.templateItems.filter((row) => row.template_id !== Number(id));
    return state;
  }),
  listTemplateItems: async (templateId) => (await getState()).templateItems.filter((row) => row.template_id === Number(templateId)).sort((a, b) => a.sr_no - b.sr_no),
  createTemplateItem: async (templateId, data) => {
    let result;
    await updateSyncedState((state) => {
      const siblings = state.templateItems.filter((row) => row.template_id === Number(templateId));
      result = { id: nextId(state.templateItems), template_id: Number(templateId), sr_no: siblings.length + 1, req_file_name: '', description: '', subfolder: 'Ready Docs', ...data };
      state.templateItems.push(result);
      return state;
    });
    return result;
  },
  deleteTemplateItem: async (id) => updateSyncedState((state) => {
    state.templateItems = state.templateItems.filter((row) => row.id !== Number(id));
    return state;
  }),
  // Only req_file_name/description/subfolder travel between a project's
  // checklist and a template — id, project_id/template_id, linked_file_path,
  // and status are per-project state and must never leak across projects.
  saveProjectAsTemplate: async (projectId, data) => {
    const template = await api.createTemplate(data);
    const items = await api.listChecklist(projectId);
    for (const item of items) {
      await api.createTemplateItem(template.id, {
        req_file_name: item.req_file_name,
        description: item.description,
        subfolder: item.subfolder,
      });
    }
    return template;
  },
  applyTemplateToProject: async (projectId, templateId) => {
    const items = await api.listTemplateItems(templateId);
    for (const item of items) {
      await api.createChecklistItem(projectId, {
        req_file_name: item.req_file_name,
        description: item.description,
        subfolder: item.subfolder,
      });
    }
    return { ok: true, added: items.length };
  },

  dashboardStats: async () => {
    const state = await getState();
    const active = state.tenders.filter((row) => !row.is_archived);
    const upcoming = active.filter((row) => row.closing_date).slice().sort((a, b) => String(a.closing_date).localeCompare(String(b.closing_date))).slice(0, 8);
    const activeProjects = state.projects.filter((row) => String(row.status || 'Active').toLowerCase() === 'active');
    const bookmarkedItems = state.tenders.filter((row) => row.is_bookmarked).slice().sort((a, b) => String(a.closing_date || '').localeCompare(String(b.closing_date || ''))).slice(0, 6);
    return {
      active_tenders: active.length,
      archived_tenders: state.tenders.length - active.length,
      active_projects: activeProjects.length,
      bookmarked_tenders: state.tenders.filter((row) => row.is_bookmarked).length,
      total_pipeline_value: state.projects.reduce((sum, row) => sum + valueNumber(row.project_value), 0),
      websites: state.websites.map((site) => {
        const siteTenders = active.filter((row) => Number(row.website_id) === Number(site.id));
        const derivedOrgs = new Set(siteTenders.map((row) => String(row.org_chain || '').trim()).filter(Boolean)).size;
        return {
          id: site.id,
          name: site.name,
          orgs: Number(site.orgs ?? site.organization_count) || derivedOrgs,
          active_tenders: siteTenders.length,
          selected_orgs: Number(site.selected_orgs) || 0,
        };
      }),
      upcoming_deadlines: upcoming,
      bookmarked_items: bookmarkedItems,
      bids_under_preparation: activeProjects.slice().sort((a, b) => String(a.deadline || '').localeCompare(String(b.deadline || ''))).slice(0, 6),
    };
  },

  getSettings: async () => {
    const settings = (await getState()).settings;
    return sessionAuth ? { ...settings, ...sessionAuth } : settings;
  },
  updateSettings: async (patch) => updateState((state) => { state.settings = { ...state.settings, ...patch }; return state; }),

  // Creates the four standard subfolders under the chosen parent folder up
  // front (Tender_Downloads, My_Tender_Projects, Archived Projects,
  // Checklist_Templates) instead of waiting for each to be needed lazily.
  ensureParentFolders: async (parentDir) => {
    const parent = String(parentDir || '').trim();
    if (!parent) return { ok: false, message: 'Choose a parent folder first.' };
    const bridge = desktop();
    if (!bridge?.ensureDirectory) return { ok: false, message: 'Folder creation is available in the desktop app.' };
    const names = ['Tender_Downloads', 'My_Tender_Projects', 'Archived Projects', 'Checklist_Templates'];
    for (const name of names) {
      const made = await bridge.ensureDirectory(joinPath(parent, name));
      if (!made?.ok) return { ok: false, message: made?.message || `Could not create ${name}.` };
    }
    return { ok: true };
  },

  // ── Account (self-service signup; a suspended account is moderated from
  // the Server UI admin console, not by the client). Registering or logging
  // in issues a fresh per-device token, stored in settings.auth_token.
  registerAccount: (input, overrides = {}) => requestClient(
    '/client/auth/register',
    { method: 'POST', body: { email: input.email, password: input.password, display_name: input.display_name || '' } },
    overrides, { requireAuth: false },
  ),
  loginAccount: (input, overrides = {}) => requestClient(
    '/client/auth/login',
    { method: 'POST', body: { email: input.email, password: input.password } },
    overrides, { requireAuth: false },
  ),
  logoutAccount: (overrides = {}) => requestClient('/client/auth/logout', { method: 'POST' }, overrides),
  changePassword: (input, overrides = {}) => requestClient(
    '/client/auth/change-password',
    { method: 'POST', body: { current_password: input.current_password, new_password: input.new_password } },
    overrides,
  ),
  // remember=false keeps the token in the in-memory sessionAuth var only, so
  // it never reaches IndexedDB and the sign-in screen returns on next launch.
  signIn: async (input, mode = 'login', remember = true) => {
    const result = mode === 'register' ? await api.registerAccount(input) : await api.loginAccount(input);
    const profile = {
      auth_token: result.token,
      user_email: result.email,
      user_id: result.user_id,
      display_name: result.display_name || '',
    };
    if (remember) {
      sessionAuth = null;
      await api.updateSettings(profile);
    } else {
      sessionAuth = profile;
    }
    // Pull this account's cloud data (bookmarks/templates/projects/checklist)
    // right away so a fresh device isn't empty until the next manual sync.
    // sessionAuth/settings.auth_token is already set above either way, so
    // connection() resolves the right token. Best-effort — sign-in already
    // succeeded, so a pull failure shouldn't block the user from getting in.
    await api.pullUserData().catch(() => {});
    return result;
  },
  signOut: async () => {
    try { await api.logoutAccount(); } catch (_) { /* token may already be invalid — clear local state regardless */ }
    sessionAuth = null;
    await api.updateSettings({ auth_token: '', user_email: '', user_id: null, display_name: '' });
  },
  syncFromServer: async (overrides = {}) => {
    const config = await connection(overrides);
    // Flush any pending local bookmark/template/project/checklist edits before
    // pulling fresh tenders below, so nothing unsynced is at risk of being
    // superseded by another device's later pull. Best-effort: a push failure
    // (e.g. offline) shouldn't block the tender sync this function exists for.
    await api.pushUserData(overrides).catch(() => {});
    const snapshot = await downloadServerSnapshot(config);
    let result;
    const notificationsToEmit = [];
    await updateState((state) => {
      const bookmarks = new Map(state.tenders.map((row) => [String(row.tender_id || row.id), Boolean(row.is_bookmarked)]));
      const downloaded = new Map(state.tenders.map((row) => [String(row.tender_id || row.id), Boolean(row.client_downloaded)]));
      // Snapshot of what we had *before* this sync overwrites state.tenders below,
      // so we can diff against it to detect new tenders / corrigendum / prebid changes.
      const priorByKey = new Map(state.tenders.map((row) => [String(row.tender_id || row.id), row]));
      const hadPriorData = state.tenders.length > 0;
      const bookmarkedOrgs = new Set(state.bookmarkedOrgs || []);

      state.websites = Array.isArray(snapshot.websites) ? snapshot.websites : state.websites;
      state.organizations = Array.isArray(snapshot.organizations) ? snapshot.organizations : state.organizations;
      state.tenders = snapshot.tenders.map((row) => ({
        ...row,
        is_bookmarked: bookmarks.get(String(row.tender_id || row.id)) ?? false,
        client_downloaded: downloaded.get(String(row.tender_id || row.id)) ?? false,
      }));

      // Skip on an empty local cache (first sync ever / after a reset) so we don't
      // flood notifications for every tender that already existed on the server.
      if (hadPriorData) {
        const newByOrg = new Map();
        for (const row of state.tenders) {
          const key = String(row.tender_id || row.id);
          const prior = priorByKey.get(key);
          if (!prior) {
            const org = String(row.org_chain || '').trim();
            if (org && bookmarkedOrgs.has(org)) {
              if (!newByOrg.has(org)) newByOrg.set(org, []);
              newByOrg.get(org).push(row);
            }
            continue;
          }
          if (row.is_bookmarked) {
            const label = row.tender_id || row.title || 'a bookmarked tender';
            if (Number(row.corrigendum_count || 0) > Number(prior.corrigendum_count || 0)) {
              notificationsToEmit.push({ type: 'status', message: `New corrigendum for ${label}` });
            }
            if (Number(row.prebid_count || 0) > Number(prior.prebid_count || 0)) {
              notificationsToEmit.push({ type: 'prebid', message: `Pre-bid update for ${label}` });
            }
          }
        }
        for (const [org, list] of newByOrg) {
          if (list.length >= 10) {
            notificationsToEmit.push({ type: 'new', message: `${list.length} new tenders added in ${org}` });
          } else {
            for (const row of list) {
              notificationsToEmit.push({ type: 'new', message: `New tender in ${org}: ${row.title || row.tender_id || 'Untitled'}` });
            }
          }
        }
      }

      state.settings = {
        ...state.settings,
        server_url: config.server_url,
        last_sync_at: new Date().toISOString(),
      };
      result = { tenders: state.tenders.length, websites: state.websites.length, syncedAt: state.settings.last_sync_at };
      return state;
    });
    if (notificationsToEmit.length) {
      const { addNotification } = useAppStore.getState();
      const time = new Date().toLocaleString();
      notificationsToEmit.forEach((n) => addNotification({ type: n.type, message: n.message, time }));
    }
    // Reconcile with whatever another device may have pushed since this
    // device's last sync. Runs after the notification diff above (which
    // intentionally uses this device's own pre-sync bookmark state) and after
    // the push above (so this device's own edits are never clobbered by it).
    await api.pullUserData(overrides).catch(() => {});
    return result;
  },

  // ── Cloud sync (bookmarks, templates, projects, checklist) ──────────
  // Whole-state blob, last-push-wins: the server just stores whatever this
  // device last sent and hands it back verbatim. Device-specific fields
  // (folder_path, linked_file_path — local filesystem paths) never travel.
  // Bookmarking a tender/org also flips on a 3-hour server-side scrape
  // schedule for it, the first time, server-side (see Server UI/server/
  // client_api.py client_push_sync) — nothing to do here for that part.
  pushUserData: async (overrides = {}) => {
    const state = await getState();
    const orgIdByName = new Map((state.organizations || []).map((row) => [row.name, row.id]));
    const bookmarkedOrgs = state.bookmarkedOrgs || [];
    const data = {
      bookmarks: state.tenders.filter((row) => row.is_bookmarked).map((row) => row.id),
      bookmarkedOrgs,
      bookmarkedOrgIds: bookmarkedOrgs.map((name) => orgIdByName.get(name)).filter((id) => Number.isFinite(id)),
      templates: state.templates,
      templateItems: state.templateItems,
      projects: state.projects.map(({ folder_path, ...rest }) => rest),
      checklist: state.checklist.map(({ linked_file_path, ...rest }) => rest),
    };
    return requestClient('/client/sync', { method: 'PUT', body: { data } }, overrides);
  },
  pullUserData: async (overrides = {}) => {
    const response = await requestClient('/client/sync', {}, overrides);
    const data = response?.data || {};
    await updateState((state) => {
      const bookmarkedIds = new Set((data.bookmarks || []).map((value) => Number(value)));
      if (Array.isArray(data.bookmarks)) {
        state.tenders = state.tenders.map((row) => ({ ...row, is_bookmarked: bookmarkedIds.has(Number(row.id)) }));
      }
      if (Array.isArray(data.bookmarkedOrgs)) state.bookmarkedOrgs = data.bookmarkedOrgs;
      if (Array.isArray(data.templates)) state.templates = data.templates;
      if (Array.isArray(data.templateItems)) state.templateItems = data.templateItems;
      if (Array.isArray(data.projects)) {
        const localFolders = new Map(state.projects.map((row) => [row.id, row.folder_path]));
        state.projects = data.projects.map((row) => ({ ...row, folder_path: localFolders.get(row.id) || null }));
      }
      if (Array.isArray(data.checklist)) {
        const localPaths = new Map(state.checklist.map((row) => [row.id, row.linked_file_path]));
        state.checklist = data.checklist.map((row) => ({ ...row, linked_file_path: localPaths.get(row.id) || '' }));
      }
      return state;
    });
    return data;
  },
};
