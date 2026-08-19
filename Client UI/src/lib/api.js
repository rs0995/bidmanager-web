import { getState, nextId, updateState } from './db.js';

const desktop = () => window.bidmanagerDesktop;
const DEFAULT_SERVER_URL = 'https://bidmanager-backend-426342323597.asia-south1.run.app';
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

async function connection(overrides = {}) {
  const settings = await getState().then((state) => state.settings);
  return {
    server_url: normalizeServerUrl(overrides.server_url ?? settings.server_url),
    client_api_key: String(overrides.client_api_key ?? settings.client_api_key ?? '').trim(),
  };
}

async function requestClient(route, options = {}, overrides = {}) {
  if (!String(route).startsWith('/client/')) throw new Error('Only /client/* API routes are allowed.');
  const config = await connection(overrides);
  if (!config.client_api_key) throw new Error('Enter the client API key in Settings.');
  const method = String(options.method || 'GET').toUpperCase();
  if (desktop()?.clientApiRequest) {
    const result = await desktop().clientApiRequest({
      baseUrl: config.server_url,
      clientKey: config.client_api_key,
      route,
      method,
      body: options.body,
    });
    if (!result?.ok) throw new Error(result?.message || 'Could not reach the client API.');
    return result.data;
  }
  const headers = { Accept: 'application/json', 'x-client-key': config.client_api_key };
  const fetchOptions = { method, headers };
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(options.body ?? {});
  }
  const response = await fetch(`${config.server_url}${route}`, fetchOptions);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.detail || `Client API returned HTTP ${response.status}.`);
  return payload;
}

function normalizeTender(row) {
  return {
    ...row,
    org_chain: row.org_chain ?? row.organization ?? '',
    tender_category: row.tender_category ?? row.category ?? '',
  };
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
  return { websites, tenders, server_stats: serverStats };
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
    await updateState((state) => {
      state.tenders = state.tenders.map((row) => row.id === id ? (result = { ...row, ...patch }) : row);
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
    await updateState((state) => {
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
    await updateState((state) => {
      state.projects = state.projects.map((row) => row.id === Number(id) ? (result = { ...row, ...patch }) : row);
      return state;
    });
    return result;
  },
  archiveProject: (id) => api.updateProject(id, { status: 'Archived' }),
  deleteProject: async (id) => updateState((state) => {
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
    await updateState((state) => {
      const siblings = state.checklist.filter((row) => row.project_id === Number(projectId));
      result = { id: nextId(state.checklist), project_id: Number(projectId), sr_no: data.sr_no || siblings.length + 1, req_file_name: '', description: '', subfolder: 'Ready Docs', linked_file_path: '', status: 'Pending', ...data };
      state.checklist.push(result);
      return state;
    });
    return result;
  },
  updateChecklistItem: async (id, patch) => updateState((state) => {
    state.checklist = state.checklist.map((row) => row.id === Number(id) ? { ...row, ...patch } : row);
    return state;
  }),
  deleteChecklistItem: async (id) => updateState((state) => {
    state.checklist = state.checklist.filter((row) => row.id !== Number(id));
    return state;
  }),

  listTemplates: async (organization = '') => filterRows((await getState()).templates, organization, ['organization']),
  createTemplate: async (data) => {
    let result;
    await updateState((state) => {
      result = { id: nextId(state.templates), template_no: null, description: '', notes: '', ...data };
      state.templates.push(result);
      return state;
    });
    return result;
  },
  updateTemplate: async (id, patch) => {
    let result;
    await updateState((state) => {
      state.templates = state.templates.map((row) => row.id === Number(id) ? (result = { ...row, ...patch }) : row);
      return state;
    });
    return result;
  },
  deleteTemplate: async (id) => updateState((state) => {
    state.templates = state.templates.filter((row) => row.id !== Number(id));
    state.templateItems = state.templateItems.filter((row) => row.template_id !== Number(id));
    return state;
  }),
  listTemplateItems: async (templateId) => (await getState()).templateItems.filter((row) => row.template_id === Number(templateId)).sort((a, b) => a.sr_no - b.sr_no),
  createTemplateItem: async (templateId, data) => {
    let result;
    await updateState((state) => {
      const siblings = state.templateItems.filter((row) => row.template_id === Number(templateId));
      result = { id: nextId(state.templateItems), template_id: Number(templateId), sr_no: siblings.length + 1, req_file_name: '', description: '', subfolder: 'Ready Docs', ...data };
      state.templateItems.push(result);
      return state;
    });
    return result;
  },
  deleteTemplateItem: async (id) => updateState((state) => {
    state.templateItems = state.templateItems.filter((row) => row.id !== Number(id));
    return state;
  }),
  saveProjectAsTemplate: async (projectId, data) => {
    const template = await api.createTemplate(data);
    const items = await api.listChecklist(projectId);
    for (const item of items) await api.createTemplateItem(template.id, item);
    return template;
  },
  applyTemplateToProject: async (projectId, templateId) => {
    const items = await api.listTemplateItems(templateId);
    for (const item of items) await api.createChecklistItem(projectId, item);
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

  getSettings: async () => (await getState()).settings,
  updateSettings: async (patch) => updateState((state) => { state.settings = { ...state.settings, ...patch }; return state; }),
  listServerStorage: async (relPath = '') => {
    const state = await getState();
    const linked = state.checklist.filter((row) => row.linked_file_path).map((row) => ({
      name: String(row.linked_file_path).split(/[\\/]/).pop(), rel_path: row.linked_file_path, is_dir: false, size_bytes: 0, modified_at: '',
    }));
    return { root_folder: state.settings.parent_dir || '', current_rel_path: relPath, parent_rel_path: '', items: linked };
  },
  deleteServerFolder: async () => { throw new Error('Folder deletion is available through the operating system.'); },

  syncFromServer: async (overrides = {}) => {
    const config = await connection(overrides);
    const snapshot = await downloadServerSnapshot(config);
    let result;
    await updateState((state) => {
      const bookmarks = new Map(state.tenders.map((row) => [String(row.tender_id || row.id), Boolean(row.is_bookmarked)]));
      state.websites = Array.isArray(snapshot.websites) ? snapshot.websites : state.websites;
      state.tenders = snapshot.tenders.map((row) => ({
        ...row,
        is_bookmarked: bookmarks.get(String(row.tender_id || row.id)) ?? false,
      }));
      state.settings = {
        ...state.settings,
        server_url: config.server_url,
        client_api_key: config.client_api_key,
        last_sync_at: new Date().toISOString(),
      };
      result = { tenders: state.tenders.length, websites: state.websites.length, syncedAt: state.settings.last_sync_at };
      return state;
    });
    return result;
  },
};
