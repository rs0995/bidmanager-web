import { request } from './http';

// Typed /client/* API, ported from BM Pro's lib/api.js. Field names are the server's
// (Server UI/server/client_api.py: _public_tender, _public_organization, ...).

export type ServerTender = {
  id: number;
  website_id: number;
  website_name: string;
  website_url: string;
  organization: string;
  tender_id: string;
  title: string;
  work_description: string;
  tender_value: string;
  emd: string;
  closing_date: string;
  opening_date: string;
  published_date: string;
  pre_bid_meeting_date: string;
  location: string;
  category: string;
  status: string;
  is_archived: boolean;
  has_documents: boolean;
  document_count: number;
  prebid_count: number;
  corrigendum_count: number;
  last_update_checked_at: number | null;
  last_status_checked_at: number | null;
  tender_url: string;
};

export type ServerOrg = {
  id: number;
  website_id: number;
  website_name: string;
  name: string;
  tenders_url: string;
  tender_count: number;
  scrape_enabled: boolean;
  has_saved_job: boolean;
  last_scraped_at: number;
  is_available: boolean;
};

export type ServerDocument = {
  id: number;
  name: string;
  type: string;
  size_bytes: number;
  downloaded_at: string;
  status: string;
  downloadable: boolean;
};

export type Page<T> = {
  items: T[];
  page: number;
  page_size: number;
  total: number;
  pages: number;
};

export type Stats = {
  total_tenders: number;
  active_tenders: number;
  archived_tenders: number;
  websites: number;
  documents: number;
  top_categories: { category: string; count: number }[];
};

export type LoginResponse = {
  user_id: number;
  email: string;
  display_name: string;
  token: string;
  /** Account type, organisation and sections (as GET /client/me); older servers omit it. */
  account?: AccountInfo;
};

// --- Accounts & organisations (Server UI/server/org_access.py) ---

/** The sections an organisation can turn on or off per member (captcha is always on). */
export type SectionPerms = {
  active: boolean;
  archived: boolean;
  bookmarks: boolean;
  projects: boolean;
  /** Search a tender ID on a NIC portal; off unless the operator or an org admin turns it on. */
  portal_search: boolean;
};

/** One search of a NIC portal's Tender Status page (GET /client/portal-search/…). */
export type PortalSearch = {
  id: number;
  website_id: number;
  website_name: string;
  tender_id: string;
  job_id: string;
  status: 'pending' | 'found' | 'not_found' | 'failed';
  job_status?: string;
  /** The portal's tender stage when found, e.g. "AOC". */
  stage?: string | null;
  tender_db_id?: number | null;
  /** true: this search added the tender; false: an existing one was updated. */
  created?: boolean | null;
  is_archived?: boolean | null;
  error?: string | null;
  created_at: number;
  finished_at?: number | null;
  /** The tender, or null when it is outside this account's sections. */
  tender?: ServerTender | null;
};

export type SearchPortal = { id: number; name: string; url: string };

export type JoinRequest = {
  id: number;
  user_id: number;
  org_id: number;
  status: string;
  note: string;
  created_at: number;
  decided_at: number | null;
  org_name: string;
  email: string;
  display_name: string;
};

export type AccountInfo = {
  account_type: 'individual' | 'organisation';
  org: { id: number; name: string; role: 'admin' | 'member' } | null;
  permissions: SectionPerms;
  pending_request: JoinRequest | null;
};

export type MeResponse = AccountInfo & {
  user_id: number;
  email: string;
  display_name: string;
};

export type OrgMember = {
  user_id: number;
  role: 'admin' | 'member';
  joined_at: number;
  email: string;
  display_name: string;
  status: string;
  last_seen_at: number | null;
  permissions: SectionPerms;
};

export type OrgDetail = {
  id: number;
  name: string;
  join_code: string;
  status: string;
  created_at: number;
  members: OrgMember[];
  pending_requests: JoinRequest[];
};

export type SyncResponse = {
  data: SyncBlob | null;
  updated_at: number | null;
};

/** The whole-user blob shared with BM Pro and the desktop Client UI. */
export type SyncBlob = {
  bookmarks?: number[];
  bookmarkedOrgs?: string[];
  bookmarkedOrgIds?: number[];
  projects?: SharedProject[];
  checklist?: SharedChecklistItem[];
  notificationPrefs?: {
    notifyOrgAlertsOn: boolean;
    notifyTenderAlertsOn: boolean;
    reminderDays: number[];
    /** When the preferences were last changed (ms). The newer copy wins. */
    updatedAt?: number;
  };
  [key: string]: unknown;
};

/** Project row exactly as the desktop Client UI and BM Pro store it. */
export type SharedProject = {
  id: number;
  title: string;
  client_name: string;
  source_tender_id: string;
  source_tender_db_id: number | null;
  project_value: string | number;
  emd: string | number;
  deadline: string | null;
  prebid: string | null;
  status: string;
  description: string;
  /** Extra checklist folders made in the desktop's Manage Folders. Kept as-is. */
  checklist_folders?: string[];
};

/** Checklist row exactly as the desktop Client UI and BM Pro store it. */
export type SharedChecklistItem = {
  id: number;
  project_id: number;
  sr_no: number;
  req_file_name: string;
  description: string;
  subfolder: string;
  status: 'Pending' | 'Completed';
  attachment: {
    name: string;
    size?: number | null;
    type?: string | null;
    uri?: string;
    /** "phone": the uri is a file on the phone that attached it (BM Pro / Bidwise). */
    device?: string;
  } | null;
};

export type ChangesResponse = {
  now: number;
  tenders: (Partial<ServerTender> & {
    id: number;
    changed_fields?: string[];
  })[];
  new_by_org: Record<
    string,
    { id: number; title?: string; tender_id?: string }[]
  >;
};

type Params = Record<string, string | number | boolean | null | undefined>;

/** Drops empty values so they don't reach the query string. */
export function clean(params: Params = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === 'any') continue;
    out[k] = String(v);
  }
  return out;
}

const qs = (params: Params) => new URLSearchParams(clean(params)).toString();

export const api = {
  register: (body: {
    email: string;
    password: string;
    display_name?: string;
    /** "organisation" also creates the organisation, with this account as its admin. */
    account_type?: 'individual' | 'organisation';
    org_name?: string;
  }) =>
    request<LoginResponse>('/client/auth/register', {
      method: 'POST',
      body,
      auth: false,
    }),
  login: (body: { email: string; password: string }) =>
    request<LoginResponse>('/client/auth/login', {
      method: 'POST',
      body,
      auth: false,
    }),
  logout: (key?: string) =>
    request('/client/auth/logout', { method: 'POST', key }),
  /** Registers this phone for push (Bidwise's own APNs topic on the server). */
  pushToken: (body: {
    token: string;
    platform: 'ios';
    app: 'bidwise';
    environment: 'production' | 'sandbox';
  }) =>
    request('/client/push-token', {
      method: 'POST',
      body,
    }),
  pushTokenDelete: (token: string, key?: string) =>
    request('/client/push-token', {
      method: 'DELETE',
      body: { token },
      key,
    }),
  /**
   * The app icon badge the server sets on the next push, and the organisations whose
   * new-tender alert is still unread (their pushes keep grouping into one).
   */
  badge: (count: number, unreadOrgs: string[]) =>
    request('/client/badge', {
      method: 'PUT',
      body: { count, unread_orgs: unreadOrgs },
    }),
  changePassword: (body: { current_password: string; new_password: string }) =>
    request('/client/auth/change-password', { method: 'POST', body }),

  health: () => request<{ status: string }>('/client/health'),
  stats: () => request<Stats>('/client/stats'),
  websites: () =>
    request<{ id: number; name: string; url?: string }[]>('/client/websites'),

  tenders: (params: Params) =>
    request<Page<ServerTender>>(`/client/tenders?${qs(params)}`),
  tender: (id: number | string) =>
    request<ServerTender>(`/client/tenders/${Number(id)}`),
  tenderDocuments: (id: number | string, params: Params = {}) =>
    request<Page<ServerDocument>>(
      `/client/tenders/${Number(id)}/documents?${qs({
        page: 1,
        page_size: 50,
        ...params,
      })}`,
    ),
  downloadRequest: (tenderId: number | string, documentId: number) =>
    request<{ url: string; expires_at?: number }>(
      `/client/tenders/${Number(tenderId)}/download-request`,
      { method: 'POST', body: { document_id: Number(documentId) } },
    ),
  requestDownloadJob: (
    tenderId: number | string,
    mode?: 'redownload' | 'update',
  ) =>
    request<{ job_id: string; created?: boolean }>(
      `/client/tenders/${Number(tenderId)}/request-download`,
      {
        method: 'POST',
        body: mode ? { mode } : {},
      },
    ),
  downloadStatus: (tenderId: number | string, jobId: string) =>
    request<{ status: string; error?: string }>(
      `/client/tenders/${Number(
        tenderId,
      )}/download-status?job_id=${encodeURIComponent(jobId)}`,
    ),

  organizations: (params: Params) =>
    request<Page<ServerOrg>>(`/client/organizations?${qs(params)}`),
  /** One-time scrape of an organisation not fetched in the last 24 h (BM Pro's "Request tenders"). */
  requestOrgTenders: (orgId: number) =>
    request<{ job_id: string; status?: string }>(
      `/client/organizations/${Number(orgId)}/request-tenders`,
      { method: 'POST', body: {} },
    ),
  orgRequestStatus: (orgId: number, jobId: string) =>
    request<{ status: string; error?: string }>(
      `/client/organizations/${Number(
        orgId,
      )}/request-tenders-status?job_id=${encodeURIComponent(jobId)}`,
    ),

  // Accounts & organisations. The org admin routes answer 403 to anyone else.
  me: () => request<MeResponse>('/client/me'),
  createOrg: (name: string) =>
    request<OrgDetail>('/client/org', { method: 'POST', body: { name } }),
  requestJoin: (joinCode: string, note = '') =>
    request<{ request: JoinRequest; warning: string }>(
      '/client/org/join-requests',
      { method: 'POST', body: { join_code: joinCode, note } },
    ),
  myJoinRequest: () =>
    request<{ request: JoinRequest | null }>('/client/org/join-requests/mine'),
  cancelJoinRequest: () =>
    request('/client/org/join-requests/mine', { method: 'DELETE' }),
  org: () => request<OrgDetail>('/client/org'),
  renameOrg: (name: string) =>
    request<OrgDetail>('/client/org', { method: 'PUT', body: { name } }),
  regenerateJoinCode: () =>
    request<{ join_code: string }>('/client/org/join-code/regenerate', {
      method: 'POST',
    }),
  approveRequest: (requestId: number, permissions?: Partial<SectionPerms>) =>
    request(`/client/org/join-requests/${Number(requestId)}/approve`, {
      method: 'POST',
      body: permissions ? { permissions } : {},
    }),
  rejectRequest: (requestId: number) =>
    request(`/client/org/join-requests/${Number(requestId)}/reject`, {
      method: 'POST',
    }),
  setMemberPermissions: (userId: number, permissions: Partial<SectionPerms>) =>
    request<{ permissions: SectionPerms }>(
      `/client/org/members/${Number(userId)}/permissions`,
      { method: 'PUT', body: permissions },
    ),
  setMemberRole: (userId: number, role: 'admin' | 'member') =>
    request(`/client/org/members/${Number(userId)}/role`, {
      method: 'PUT',
      body: { role },
    }),
  // NIC portal tender search (the portal_search section; 403 without it).
  portalSearchPortals: () =>
    request<{ allowed: boolean; items: SearchPortal[] }>(
      '/client/portal-search/portals',
    ),
  startPortalSearch: (websiteId: number, tenderId: string) =>
    request<{ search: PortalSearch; job_id: string; created: boolean }>(
      '/client/portal-search',
      { method: 'POST', body: { website_id: websiteId, tender_id: tenderId } },
    ),
  portalSearch: (id: number) =>
    request<{ search: PortalSearch }>(`/client/portal-search/${Number(id)}`),
  portalSearchHistory: (limit = 50) =>
    request<{ items: PortalSearch[] }>(
      `/client/portal-search/history?limit=${Number(limit)}`,
    ),
  deletePortalSearch: (id: number) =>
    request(`/client/portal-search/history/${Number(id)}`, {
      method: 'DELETE',
    }),
  clearPortalSearchHistory: () =>
    request('/client/portal-search/history', { method: 'DELETE' }),
  /** `retain`: keep the org's bookmarks in their account; otherwise it is wiped. */
  delinkMember: (userId: number, retain: boolean) =>
    request(`/client/org/members/${Number(userId)}/delink`, {
      method: 'POST',
      body: { retain },
    }),

  getSync: () => request<SyncResponse>('/client/sync'),
  putSync: (
    data: SyncBlob,
    removed: Record<string, (number | string)[]>,
    baseUpdatedAt: number,
  ) =>
    request<{ updated_at: number }>('/client/sync', {
      method: 'PUT',
      body: { data, removed, base_updated_at: baseUpdatedAt },
    }),
  changes: (since: number) =>
    request<ChangesResponse>(
      `/client/changes?since=${encodeURIComponent(Number(since) || 0)}`,
    ),

  captchaPending: () =>
    request<{
      request_id: string;
      image_base64: string;
      context?: string;
    } | null>('/client/captcha/pending'),
  answerCaptcha: (id: string, text: string) =>
    request(`/client/captcha/${id}/answer`, { method: 'POST', body: { text } }),
};
