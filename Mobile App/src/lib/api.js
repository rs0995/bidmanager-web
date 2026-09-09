import { request } from './http.js';

// Drop empty/"any" filter values so they don't end up as literal query params
// (the backend treats an absent param and an "any" sentinel differently).
function clean(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 'any'),
  );
}

export const api = {
  // ── Auth ──────────────────────────────────────────────────────────
  register: (body) => request('/client/auth/register', { method: 'POST', body, auth: false }),
  login: (body) => request('/client/auth/login', { method: 'POST', body, auth: false }),
  logout: () => request('/client/auth/logout', { method: 'POST' }),
  changePassword: (body) => request('/client/auth/change-password', { method: 'POST', body }),

  // ── Health / stats ────────────────────────────────────────────────
  health: () => request('/client/health'),
  stats: () => request('/client/stats'),

  // ── Tenders ───────────────────────────────────────────────────────
  tenders: (params) => request(`/client/tenders?${new URLSearchParams(clean(params))}`),
  tender: (id) => request(`/client/tenders/${Number(id)}`),
  tenderDocuments: (id, params = {}) => request(
    `/client/tenders/${Number(id)}/documents?${new URLSearchParams(clean({ page: 1, page_size: 50, ...params }))}`,
  ),

  // ── Downloads ─────────────────────────────────────────────────────
  // Mints a short-lived (~15 min) signed URL for an already-downloaded file.
  downloadRequest: (tenderId, documentId) => request(
    `/client/tenders/${Number(tenderId)}/download-request`,
    { method: 'POST', body: { document_id: Number(documentId) } },
  ),
  // Kicks off the server-side scrape/download job for a tender with no
  // documents yet.
  requestDownloadJob: (tenderId) => request(
    `/client/tenders/${Number(tenderId)}/request-download`,
    { method: 'POST', body: {} },
  ),
  downloadStatus: (tenderId, jobId) => request(
    `/client/tenders/${Number(tenderId)}/download-status?job_id=${encodeURIComponent(jobId)}`,
  ),

  // ── Organizations (phase 2 — not wired into any screen yet) ────────
  organizations: (params) => request(`/client/organizations?${new URLSearchParams(clean(params))}`),

  // ── Cross-device sync blob (see lib/sync.js for the merge-preserving
  // read-modify-write this app performs against it) ───────────────────
  getSync: () => request('/client/sync'),
  putSync: (data, removed, baseUpdatedAt) => request('/client/sync', {
    method: 'PUT', body: { data, removed, base_updated_at: baseUpdatedAt },
  }),

  // Server-recorded changes to this user's bookmarked tenders/orgs since the
  // epoch-seconds `since` returned as `now` on the previous call.
  changes: (since) => request(`/client/changes?since=${encodeURIComponent(Number(since) || 0)}`),
};
