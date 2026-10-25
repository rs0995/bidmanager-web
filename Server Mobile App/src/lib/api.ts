import { Platform } from 'react-native';
import type {
  CaptchaStats,
  Captcha,
  ClientUser,
  Health,
  Job,
  JobStart,
  LogsPage,
  Metrics,
  OrgDetail,
  OrgRole,
  OrgSummary,
  Organization,
  Permissions,
  SavedJob,
  SavedJobInput,
  SavedJobScope,
  Settings,
  SuppressedSite,
  Tender,
  UserDetail,
  Website,
} from './types';

// Port of apiFetch / createApi from Server UI/BidManagerControl.jsx, limited to
// the endpoints the eight mobile sections use. Same contract: JSON in and out,
// `x-admin-key` on every request, 30 s timeout, and the server's `detail` /
// `message` as the error text.

const TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

type Opts = { method?: string; body?: unknown };

const trimBase = (base: string) => String(base || '').replace(/\/+$/, '');

// Browsers enforce CORS and the server only allows the desktop's origin, so the
// browser preview sends requests through the Vite dev server (web/vite.config.ts),
// which forwards them to the target. Native apps call the server directly.
function requestUrl(base: string, path: string) {
  return Platform.OS === 'web' ? `/__bm_proxy${path}` : `${trimBase(base)}${path}`;
}

export async function apiFetch<T>(
  base: string,
  adminKey: string,
  path: string,
  { method = 'GET', body }: Opts = {},
): Promise<T> {
  if (!base) throw new ApiError('No server URL set');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(requestUrl(base, path), {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(adminKey ? { 'x-admin-key': adminKey } : {}),
        ...(Platform.OS === 'web' ? { 'x-bm-target': trimBase(base) } : {}),
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const e = err as Error;
    if (e?.name === 'AbortError') throw new ApiError(`Request timed out: ${path}`);
    throw new ApiError(`Could not reach the server: ${e?.message || e}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    const d = data as { detail?: unknown; message?: unknown } | null;
    const detail = d?.detail ?? d?.message;
    const message =
      typeof detail === 'string'
        ? detail
        : detail
        ? JSON.stringify(detail)
        : `${res.status} ${res.statusText}`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

const q = encodeURIComponent;

export function createApi(base: string, adminKey: string) {
  const get = <T>(path: string) => apiFetch<T>(base, adminKey, path);
  const post = <T>(path: string, body?: unknown) =>
    apiFetch<T>(base, adminKey, path, { method: 'POST', body });

  return {
    /* Server */
    async health(): Promise<Health> {
      const raw = await get<Partial<Health>>('/admin/health');
      return {
        status: raw.status || 'unknown',
        provider: raw.provider || '',
        label: raw.label || '',
        version: raw.version || '',
        revision: raw.revision || '',
        region: raw.region || '',
        service: raw.service || '',
        uptimeSeconds: raw.uptimeSeconds ?? 0,
        checks: raw.checks || [],
      };
    },
    async metrics(): Promise<Metrics> {
      const raw = await get<Partial<Metrics>>('/admin/metrics');
      return {
        requests1h: raw.requests1h ?? 0,
        p95: raw.p95 ?? null,
        p99: raw.p99 ?? null,
        errorRate: raw.errorRate ?? 0,
        cpuPct: raw.cpuPct ?? null,
        memPct: raw.memPct ?? null,
        jobsRunning: raw.jobsRunning ?? 0,
        jobsQueued: raw.jobsQueued ?? 0,
        jobsFailed: raw.jobsFailed ?? 0,
      };
    },
    /** Toggles the scheduler; returns the new paused state. */
    togglePauseScheduler: () =>
      post<{ paused: boolean }>('/admin/server/pause-scheduler'),
    drain: () =>
      post<{ draining: boolean; activeJobs: number }>('/admin/server/drain'),

    /* Settings (also the source of scheduler_paused / drain_mode) */
    async config(): Promise<Settings> {
      return (await get<{ settings: Settings }>('/admin/config')).settings;
    },
    /** Partial update: only the given keys change on the server. */
    async saveConfig(settings: Settings): Promise<Settings> {
      const raw = await apiFetch<{ settings: Settings }>(
        base,
        adminKey,
        '/admin/config',
        { method: 'PUT', body: { settings } },
      );
      return raw.settings;
    },

    /* Jobs */
    async jobs(): Promise<Job[]> {
      const raw = await get<{ jobs: Partial<Job>[] }>('/admin/jobs');
      return (raw.jobs || []).map(j => ({
        id: String(j.id),
        status: j.status === 'completed' ? 'done' : String(j.status || ''),
        action: j.action || '',
        kind: j.kind || '',
        tenderId: j.tenderId || '',
        portal: j.portal || '',
        startedAt: j.startedAt ?? null,
        progress: j.progress ?? 0,
        error: j.error || '',
        source: j.source || '',
      }));
    },
    cancelJob: (id: string) => post(`/admin/jobs/${q(id)}/cancel`),
    retryJob: (id: string) => post<JobStart>(`/admin/jobs/${q(id)}/retry`),
    purgeJobs: () => post<{ removed: number }>('/admin/jobs/purge'),

    /* Captchas */
    async captchas(): Promise<Captcha[]> {
      const raw = await get<{ captchas: Partial<Captcha>[] }>(
        '/admin/captchas/pending',
      );
      return (raw.captchas || []).filter(Boolean).map(c => ({
        id: String(c.id),
        jobId: c.jobId || '',
        portal: c.portal || '',
        image: c.image || '',
        reason: c.reason || 'Manual captcha required',
        receivedAt: c.receivedAt ?? Date.now(),
        expiresAt: c.expiresAt ?? Date.now(),
      }));
    },
    async captchaStats(): Promise<CaptchaStats> {
      const raw = await get<Partial<CaptchaStats>>('/admin/captchas/stats');
      return {
        pending: raw.pending ?? 0,
        manualFallback: !!raw.manualFallback,
      };
    },
    answerCaptcha: (id: string, answer: string) =>
      post(`/admin/captchas/${q(id)}/answer`, { answer }),
    refreshCaptcha: (id: string) =>
      post<{ id: string; image: string }>(`/admin/captchas/${q(id)}/refresh`),
    skipCaptcha: (id: string, action: 'requeue' | 'abandon') =>
      post(`/admin/captchas/${q(id)}/skip`, { action }),

    /* Scraper */
    websites: () => get<Website[]>('/v1/websites'),
    addWebsite: (name: string, url: string, statusUrl: string) =>
      post<Website>('/v1/websites', { name, url, status_url: statusUrl }),
    /** Renames a website / changes its URLs; its organizations and tenders are kept. */
    updateWebsite: (websiteId: number, name: string, url: string, statusUrl: string) =>
      apiFetch<Website>(base, adminKey, `/v1/websites/${websiteId}`, {
        method: 'PUT',
        body: { name, url, status_url: statusUrl },
      }),
    /** Deletes the website and all of its organizations, tenders and download records. */
    deleteWebsite: (websiteId: number) =>
      apiFetch<{ ok: true }>(base, adminKey, `/v1/websites/${websiteId}`, {
        method: 'DELETE',
      }),
    refreshOrganizationList: (websiteId: number) =>
      post<JobStart>('/admin/jobs/scrape', {
        website_id: websiteId,
        refresh_organizations: true,
      }),
    organizations: (websiteId: number) =>
      get<Organization[]>(`/v1/websites/${websiteId}/organizations`),
    tenders(websiteId: number, archived: boolean) {
      const params = new URLSearchParams({
        archived: String(archived),
        limit: '1000',
        sort: 'closing_date',
        order: archived ? 'desc' : 'asc',
      });
      return get<Tender[]>(`/v1/websites/${websiteId}/tenders?${params}`);
    },
    scrapeOrganizations: (websiteId: number, orgIds: number[]) =>
      post<JobStart>(`/v1/websites/${websiteId}/tenders/fetch-selected`, {
        org_ids: orgIds,
        download_after: false,
      }),
    refreshTenders: (websiteId: number, tenderIds: number[]) =>
      post<JobStart>(`/v1/websites/${websiteId}/tenders/refresh-batch`, {
        tender_ids: tenderIds,
      }),
    downloadTenders: (websiteId: number, tenderIds: number[]) =>
      post<JobStart>(`/v1/websites/${websiteId}/tenders/download-batch`, {
        tender_ids: tenderIds,
        all_tenders: false,
        mode: 'auto',
      }),
    async savedJobs(): Promise<SavedJob[]> {
      return (await get<{ jobs: SavedJob[] }>('/admin/custom-jobs?owner=*')).jobs || [];
    },
    savedJobScope: (id: number) =>
      get<SavedJobScope>(`/admin/custom-jobs/${id}/scope`),
    saveJob: (input: SavedJobInput, id?: number) =>
      apiFetch<{ ok: true; id: number }>(
        base,
        adminKey,
        id ? `/admin/custom-jobs/${id}` : '/admin/custom-jobs',
        { method: id ? 'PUT' : 'POST', body: input },
      ),
    runSavedJob: (id: number, owner: string) =>
      post<{ queued_count: number }>(
        `/admin/custom-jobs/${id}/run?owner=${q(owner)}`,
      ),
    deleteSavedJob: (id: number, owner: string) =>
      apiFetch(base, adminKey, `/admin/custom-jobs/${id}?owner=${q(owner)}`, {
        method: 'DELETE',
      }),
    setSavedJobSchedule: (id: number, enabled: boolean) =>
      post<{ enabled: boolean }>(`/admin/custom-jobs/${id}/schedule`, {
        enabled,
      }),
    async suppressedSites(): Promise<SuppressedSite[]> {
      return (
        (await get<{ items: SuppressedSite[] }>('/admin/bookmark-scrape/suppressed'))
          .items || []
      );
    },
    resumeBookmarkScrape: (websiteId: number) =>
      post('/admin/bookmark-scrape/resume', { website_id: websiteId }),

    /* Archive */
    fetchTenderStatus: (tenderDbId: number) =>
      post<JobStart & { id?: string }>(`/v1/tenders/${tenderDbId}/fetch-status`),

    /* Users */
    async users(): Promise<ClientUser[]> {
      return (await get<{ items: ClientUser[] }>('/admin/users')).items || [];
    },
    user: (id: number) => get<UserDetail>(`/admin/users/${id}`),
    suspendUser: (id: number) => post(`/admin/users/${id}/suspend`),
    reactivateUser: (id: number) => post(`/admin/users/${id}/reactivate`),
    resetUserSync: (id: number) => post(`/admin/users/${id}/reset-sync`),
    /** Partial update: only the sections passed change. */
    setUserPermissions: (id: number, changes: Partial<Permissions>) =>
      apiFetch<{ user_id: number; permissions: Permissions }>(
        base,
        adminKey,
        `/admin/users/${id}/permissions`,
        { method: 'PUT', body: changes },
      ),

    /* Organisations */
    /** null when the server predates organisations (the route 404s). */
    async orgs(): Promise<OrgSummary[] | null> {
      try {
        return (await get<{ items: OrgSummary[] }>('/admin/orgs')).items || [];
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    org: (id: number) => get<OrgDetail>(`/admin/orgs/${id}`),
    createOrg: (name: string, adminUserId: number) =>
      post<OrgDetail>('/admin/orgs', { name, admin_user_id: adminUserId }),
    renameOrg: (id: number, name: string) =>
      apiFetch<OrgDetail>(base, adminKey, `/admin/orgs/${id}`, {
        method: 'PUT',
        body: { name },
      }),
    /** retain: members keep a copy of the org's bookmarks; false wipes their data. */
    dissolveOrg: (id: number, retain: boolean) =>
      apiFetch<{ ok: true; members_released: number; retained: boolean }>(
        base,
        adminKey,
        `/admin/orgs/${id}?retain=${retain}`,
        { method: 'DELETE' },
      ),
    regenerateJoinCode: (id: number) =>
      post<{ join_code: string }>(`/admin/orgs/${id}/join-code/regenerate`),
    addOrgMember: (id: number, userId: number, role: OrgRole) =>
      post<{ ok: true }>(`/admin/orgs/${id}/members`, { user_id: userId, role }),
    approveJoinRequest: (id: number, requestId: number) =>
      post(`/admin/orgs/${id}/join-requests/${requestId}/approve`, {}),
    rejectJoinRequest: (id: number, requestId: number) =>
      post(`/admin/orgs/${id}/join-requests/${requestId}/reject`),
    setMemberRole: (id: number, userId: number, role: OrgRole) =>
      apiFetch<{ user_id: number; role: OrgRole }>(
        base,
        adminKey,
        `/admin/orgs/${id}/members/${userId}/role`,
        { method: 'PUT', body: { role } },
      ),
    delinkMember: (id: number, userId: number, retain: boolean) =>
      post<{ ok: true; retained: boolean }>(
        `/admin/orgs/${id}/members/${userId}/delink`,
        { retain },
      ),

    /* Logs */
    logs: (sinceSeq: number) =>
      get<LogsPage>(`/admin/logs/live?since_seq=${sinceSeq}&limit=400`),
  };
}

export type Api = ReturnType<typeof createApi>;
