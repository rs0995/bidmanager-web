/**
 * API client for the BidManager FastAPI backend.
 * Local dev uses the Vite proxy. Hosted builds can set VITE_API_BASE_URL.
 */

const runtimeBase = new URLSearchParams(window.location.search).get('apiBase') || '';
const BASE = (runtimeBase || import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res.json();
}

type RouteMethods = Record<string, Set<string>>;
type BackendRouteSet = {
  ok: boolean;
  methods: RouteMethods;
};

let _routeSetPromise: Promise<BackendRouteSet> | null = null;

function _pathMethods(paths: any): RouteMethods {
  const out: RouteMethods = {};
  for (const [path, def] of Object.entries(paths || {})) {
    const m = new Set<string>();
    const obj = def as Record<string, unknown>;
    for (const key of Object.keys(obj || {})) {
      const lower = key.toLowerCase();
      if (['get', 'post', 'patch', 'put', 'delete', 'options', 'head'].includes(lower)) m.add(lower);
    }
    out[String(path)] = m;
  }
  return out;
}

function _hasMethod(routeSet: BackendRouteSet | null, candidates: string[], method: string): boolean {
  if (!routeSet?.ok) return false;
  const m = method.toLowerCase();
  for (const p of candidates) {
    const methods = routeSet.methods[p];
    if (methods && methods.has(m)) return true;
  }
  return false;
}

async function _detectBackendRouteSet(): Promise<BackendRouteSet> {
  try {
    const res = await fetch(`${BASE}/openapi.json`, { method: 'GET' });
    if (!res.ok) return { ok: false, methods: {} };
    const doc = await res.json();
    return { ok: true, methods: _pathMethods((doc as any)?.paths || {}) };
  } catch {
    return { ok: false, methods: {} };
  }
}

async function getBackendRouteSet(): Promise<BackendRouteSet> {
  if (!_routeSetPromise) _routeSetPromise = _detectBackendRouteSet();
  return _routeSetPromise;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface Website {
  id: number;
  name: string;
  url: string;
  status_url: string;
}

export interface Organization {
  id: number;
  website_id: number;
  name: string;
  tender_count: number;
  is_selected: boolean;
}

export interface Tender {
  id: number;
  website_id: number;
  org_chain: string | null;
  tender_id: string | null;
  title: string | null;
  work_description: string | null;
  tender_value: string | null;
  emd: string | null;
  closing_date: string | null;
  opening_date: string | null;
  published_date: string | null;
  pre_bid_meeting_date: string | null;
  location: string | null;
  tender_category: string | null;
  status: string | null;
  is_archived: boolean;
  is_downloaded: boolean;
  is_bookmarked: boolean;
  tender_url: string | null;
  folder_path: string | null;
}

export interface Project {
  id: number;
  title: string | null;
  client_name: string | null;
  source_tender_id: string | null;
  project_value: string | null;
  prebid: string | null;
  deadline: string | null;
  status: string | null;
  description: string | null;
  folder_path: string | null;
}

export interface Template {
  id: number;
  template_no: number | null;
  organization: string;
  template_name: string;
  description: string | null;
  notes: string | null;
}

export interface TemplateItem {
  id: number;
  template_id: number;
  sr_no: number | null;
  req_file_name: string | null;
  description: string | null;
  subfolder: string | null;
}

export interface DashboardStats {
  active_tenders: number;
  archived_tenders: number;
  active_projects: number;
  bookmarked_tenders: number;
  total_pipeline_value: number;
  websites: Array<{
    id: number;
    name: string;
    orgs: number;
    active_tenders: number;
    selected_orgs: number;
  }>;
  upcoming_deadlines: Array<{
    tender_id: string;
    title: string;
    closing_date: string;
    org_chain: string;
  }>;
}

export interface JobResponse {
  job_id: string;
  status: string;
}

export interface ProjectTenderFetchFile {
  file_name: string;
  file_type: string;
  local_path: string;
  downloaded_at: string;
}

export interface ProjectTenderFetchResult {
  found: boolean;
  source: string;
  tender: Tender | null;
  files: ProjectTenderFetchFile[];
  message?: string | null;
  scraper_started?: boolean;
}

export interface RestoreProjectsResult {
  root_folder: string;
  scanned_folders: number;
  created_projects: number;
  updated_projects: number;
  restored_checklist_items: number;
}

export interface ProjectsRootFolderResult {
  root_folder: string;
}

export interface StorageItem {
  name: string;
  rel_path: string;
  is_dir: boolean;
  size_bytes: number;
  modified_at: string;
}

export interface StorageListResult {
  root_folder: string;
  current_rel_path: string;
  parent_rel_path: string;
  items: StorageItem[];
}

export interface ChecklistItem {
  id: number;
  project_id: number;
  sr_no: number;
  req_file_name: string | null;
  description: string | null;
  subfolder: string | null;
  linked_file_path: string | null;
  status: string;
}

export interface CaptchaPending {
  request_id: string;
  image_base64: string;
  context: string;
}

export interface ClearDataResult {
  organizations: number;
  active_tenders: number;
  archived_tenders: number;
  downloaded_files: number;
}

// ── API Functions ──────────────────────────────────────────────────────────

export const api = {
  initRouteSet: async () => {
    await getBackendRouteSet();
    return true;
  },
  getRouteSet: async () => getBackendRouteSet(),

  // Health
  health: () => request<{ status: string; version: string }>('/health'),

  // Websites
  listWebsites: () => request<Website[]>('/v1/websites'),
  createWebsite: (data: { name: string; url: string; status_url?: string }) =>
    request<Website>('/v1/websites', { method: 'POST', body: JSON.stringify(data) }),
  deleteWebsite: (id: number) =>
    request('/v1/websites/' + id, { method: 'DELETE' }),

  // Organizations
  listOrganizations: (websiteId: number, search = '') =>
    request<Organization[]>(`/v1/websites/${websiteId}/organizations?search=${encodeURIComponent(search)}`),
  toggleOrganization: (orgId: number, isSelected: boolean) =>
    request(`/v1/organizations/${orgId}`, { method: 'PATCH', body: JSON.stringify({ is_selected: isSelected }) }),

  // Tenders
  listTenders: (websiteId: number, params: {
    archived?: boolean;
    search?: string;
    org?: string;
    location?: string;
    category?: string;
    bookmarked?: boolean;
    sort?: string;
    order?: 'asc' | 'desc';
    page?: number;
    limit?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.archived !== undefined) qs.set('archived', String(params.archived));
    if (params.search) qs.set('search', params.search);
    if (params.org) qs.set('org', params.org);
    if (params.location) qs.set('location', params.location);
    if (params.category) qs.set('category', params.category);
    if (params.bookmarked !== undefined) qs.set('bookmarked', String(params.bookmarked));
    if (params.sort) qs.set('sort', params.sort);
    if (params.order) qs.set('order', params.order);
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    return request<Tender[]>(`/v1/websites/${websiteId}/tenders?${qs}`);
  },
  patchTender: (id: number, data: { is_downloaded?: boolean; is_bookmarked?: boolean }) =>
    request(`/v1/tenders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  archiveTender: (id: number) =>
    request(`/v1/tenders/${id}/archive`, { method: 'POST' }),
  downloadSingleTender: async (id: number, mode: 'full' | 'update' = 'full') => {
    const errors: string[] = [];
    const attempts: Array<() => Promise<JobResponse>> = [
      () =>
        request<JobResponse>(`/v1/tenders/${id}/download`, {
          method: 'POST',
          body: JSON.stringify({ mode }),
        }),
      () => request<JobResponse>(`/v1/tenders/${id}/download?mode=${encodeURIComponent(mode)}`, { method: 'GET' }),
      () => request<JobResponse>(`/v1/tenders/${id}/download`, { method: 'GET' }),
    ];

    for (const run of attempts) {
      try {
        return await run();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(msg);
      }
    }
    throw new Error(errors.join(' | '));
  },

  // Async Jobs
  fetchOrganizations: (websiteId: number) =>
    request<JobResponse>(`/v1/websites/${websiteId}/organizations/fetch`, { method: 'POST' }),
  fetchTenders: (websiteId: number) =>
    request<JobResponse>(`/v1/websites/${websiteId}/tenders/fetch`, { method: 'POST' }),
  fetchTendersForOrgs: (websiteId: number, orgIds: number[]) =>
    request<JobResponse>(`/v1/websites/${websiteId}/tenders/fetch-selected`, {
      method: 'POST',
      body: JSON.stringify({ org_ids: orgIds }),
    }),
  downloadTenders: async (websiteId: number) => {
    const errors: string[] = [];
    const attempts: Array<() => Promise<JobResponse>> = [
      () => request<JobResponse>(`/v1/websites/${websiteId}/tenders/download`, { method: 'POST' }),
      () => request<JobResponse>(`/v1/websites/${websiteId}/tenders/download`, { method: 'GET' }),
    ];
    for (const run of attempts) {
      try {
        return await run();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(msg);
      }
    }
    throw new Error(errors.join(' | '));
  },
  downloadTenderResults: (websiteId: number) =>
    request<JobResponse>(`/v1/websites/${websiteId}/tenders/download-results`, { method: 'POST' }),
  checkTenderStatus: (websiteId: number) =>
    request<JobResponse>(`/v1/websites/${websiteId}/tenders/check-status`, { method: 'POST' }),
  checkArchivedTenderStatus: (websiteId: number) =>
    request<JobResponse>(`/v1/websites/${websiteId}/tenders/check-status-archived`, { method: 'POST' }),
  archiveCompletedTenders: (websiteId: number) =>
    request<JobResponse>(`/v1/websites/${websiteId}/tenders/archive-completed`, { method: 'POST' }),
  getJob: (jobId: string) => request<any>(`/v1/jobs/${jobId}`),
  getLiveLogs: (limit = 400, sinceSeq = 0) =>
    request<{ lines: string[]; next_seq?: number }>(
      `/v1/logs/live?limit=${encodeURIComponent(String(limit))}&since_seq=${encodeURIComponent(String(sinceSeq))}`
    ),
  getPendingCaptcha: () => request<CaptchaPending | null>('/v1/captcha/pending'),
  submitCaptcha: (requestId: string, text: string) =>
    request('/v1/captcha/respond', {
      method: 'POST',
      body: JSON.stringify({ request_id: requestId, text }),
    }),
  fetchTenderForProject: (tenderId: string, scrapeOnMiss = true) =>
    request<ProjectTenderFetchResult>('/v1/tenders/project-fetch', {
      method: 'POST',
      body: JSON.stringify({ tender_id: tenderId, scrape_on_miss: scrapeOnMiss }),
    }),
  clearSavedData: async (data: { clear_orgs: boolean; clear_active: boolean; clear_archived: boolean }) => {
    const ensureJson = async (res: Response) => {
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      const raw = await res.text();
      if (!res.ok) throw new Error(`API ${res.status}: ${raw}`);
      if (!ct.includes('application/json')) {
        throw new Error(
          'Clear API returned HTML instead of JSON. Restart backend/desktop app to load latest API routes.'
        );
      }
      return JSON.parse(raw) as { ok: boolean; result: ClearDataResult };
    };

    try {
      const postRes = await fetch(`${BASE}/v1/data/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return await ensureJson(postRes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('API 405')) {
        const qs = new URLSearchParams({
          clear_orgs: String(Boolean(data.clear_orgs)),
          clear_active: String(Boolean(data.clear_active)),
          clear_archived: String(Boolean(data.clear_archived)),
        });
        const getRes = await fetch(`${BASE}/v1/data/clear?${qs}`, { method: 'GET' });
        return await ensureJson(getRes);
      }
      throw err;
    }
  },

  // Projects
  listProjects: (search = '', status = '') =>
    request<Project[]>(`/v1/projects?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`),
  createProject: (data: Omit<Project, 'id' | 'folder_path'>) =>
    request<Project>('/v1/projects', { method: 'POST', body: JSON.stringify(data) }),
  getProject: (id: number) => request<Project>(`/v1/projects/${id}`),
  ensureProjectFolder: async (id: number) => {
    try {
      return await request<{ ok: boolean; folder_path: string }>(`/v1/projects/${id}/ensure-folder`, { method: 'POST' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('API 404') && !msg.includes('API 405')) throw err;
      // Backward compatibility: older backend may not have /ensure-folder.
      const proj = await request<Project>(`/v1/projects/${id}`);
      if (String(proj.folder_path || '').trim()) {
        return { ok: true, folder_path: String(proj.folder_path || '').trim() };
      }
      await request(`/v1/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: String(proj.title || ''),
          source_tender_id: String(proj.source_tender_id || ''),
          status: String(proj.status || 'Active'),
        }),
      });
      const refreshed = await request<Project>(`/v1/projects/${id}`);
      return { ok: true, folder_path: String(refreshed.folder_path || '').trim() };
    }
  },
  fetchProjectFromActive: async (projectId: number) => {
    try {
      return await request<ProjectTenderFetchResult>(`/v1/projects/${projectId}/fetch-from-active`, { method: 'POST' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('API 405')) throw err;
      return request<ProjectTenderFetchResult>(`/v1/projects/${projectId}/fetch-from-active`, { method: 'GET' });
    }
  },
  checkProjectCorrigendum: async (projectId: number) => {
    try {
      return await request<ProjectTenderFetchResult>(`/v1/projects/${projectId}/check-corrigendum`, { method: 'POST' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('API 405')) throw err;
      return request<ProjectTenderFetchResult>(`/v1/projects/${projectId}/check-corrigendum`, { method: 'GET' });
    }
  },
  getProjectsRootFolder: (archived = false) => request<ProjectsRootFolderResult>(`/v1/projects/root-folder?archived=${archived ? 'true' : 'false'}`),
  updateProject: (id: number, data: Partial<Project>) =>
    request(`/v1/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  archiveProject: async (id: number) => {
    try {
      return await request(`/v1/projects/${id}/archive`, { method: 'POST' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('API 405')) {
        // Backward compatibility with older backend builds that lack /archive route.
        return request(`/v1/projects/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'Archived' }),
        });
      }
      throw err;
    }
  },
  deleteProject: (id: number) =>
    request(`/v1/projects/${id}`, { method: 'DELETE' }),
  restoreProjectsFromFolders: async () => {
    try {
      return await request<RestoreProjectsResult>('/v1/projects/restore-from-folders', { method: 'POST' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('API 405')) {
        return request<RestoreProjectsResult>('/v1/projects/restore-from-folders', { method: 'GET' });
      }
      throw err;
    }
  },
  listChecklist: (projectId: number) =>
    request<ChecklistItem[]>(`/v1/projects/${projectId}/checklist`),
  createChecklistItem: (
    projectId: number,
    data: {
      sr_no?: number;
      req_file_name?: string;
      description?: string;
      subfolder?: string;
      linked_file_path?: string;
      status?: string;
    }
  ) =>
    request<ChecklistItem>(`/v1/projects/${projectId}/checklist`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateChecklistItem: (
    itemId: number,
    data: Partial<{
      sr_no: number;
      req_file_name: string;
      description: string;
      subfolder: string;
      linked_file_path: string;
      status: string;
    }>
  ) =>
    request(`/v1/checklist/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteChecklistItem: (itemId: number) =>
    request(`/v1/checklist/${itemId}`, { method: 'DELETE' }),
  listServerStorage: (relPath = '') =>
    request<StorageListResult>(`/v1/server/storage?rel_path=${encodeURIComponent(relPath)}`),
  deleteServerFolder: (relPath: string) =>
    request('/v1/server/storage/folder', {
      method: 'DELETE',
      body: JSON.stringify({ rel_path: relPath }),
    }),
  deleteOlderServerFiles: (days: number, relPath = '') =>
    request<{ deleted_files: number; deleted_dirs: number }>('/v1/server/storage/delete-older', {
      method: 'POST',
      body: JSON.stringify({ days, rel_path: relPath }),
    }),

  // Templates
  listTemplates: (organization = '') =>
    request<Template[]>(`/v1/templates?organization=${encodeURIComponent(organization)}`),
  createTemplate: (data: { template_no?: number; organization: string; template_name: string; description?: string; notes?: string }) =>
    request<Template>('/v1/templates', { method: 'POST', body: JSON.stringify(data) }),
  updateTemplate: (id: number, data: Partial<{ template_no: number; organization: string; template_name: string; description: string; notes: string }>) =>
    request<Template>(`/v1/templates/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTemplate: (id: number) =>
    request(`/v1/templates/${id}`, { method: 'DELETE' }),
  listTemplateItems: (templateId: number) =>
    request<TemplateItem[]>(`/v1/templates/${templateId}/items`),
  createTemplateItem: (templateId: number, data: { req_file_name?: string; description?: string; subfolder?: string }) =>
    request<TemplateItem>(`/v1/templates/${templateId}/items`, { method: 'POST', body: JSON.stringify(data) }),
  deleteTemplateItem: (itemId: number) =>
    request(`/v1/template-items/${itemId}`, { method: 'DELETE' }),
  saveProjectAsTemplate: (projectId: number, data: { template_no?: number; organization: string; template_name: string; description?: string; notes?: string }) =>
    request<Template>(`/v1/projects/${projectId}/save-as-template`, { method: 'POST', body: JSON.stringify(data) }),
  applyTemplateToProject: (projectId: number, templateId: number) =>
    request<{ ok: boolean; added: number }>(`/v1/projects/${projectId}/apply-template/${templateId}`, { method: 'POST' }),

  // Dashboard
  dashboardStats: () => request<DashboardStats>('/v1/stats/dashboard'),

  // Settings
  getSettings: () => request<Record<string, string>>('/v1/settings'),
  updateSettings: (data: Record<string, string>) =>
    request('/v1/settings', { method: 'PATCH', body: JSON.stringify(data) }),
};
