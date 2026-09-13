import { request } from "./http.js";

function clean(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== "any"),
  );
}

export const api = {
  register: (body) => request("/client/auth/register", { method: "POST", body, auth: false }),
  login: (body) => request("/client/auth/login", { method: "POST", body, auth: false }),
  logout: () => request("/client/auth/logout", { method: "POST" }),
  changePassword: (body) => request("/client/auth/change-password", { method: "POST", body }),

  health: () => request("/client/health"),
  stats: () => request("/client/stats"),

  tenders: (params) => request(`/client/tenders?${new URLSearchParams(clean(params))}`),
  tender: (id) => request(`/client/tenders/${Number(id)}`),
  tenderDocuments: (id, params = {}) => request(
    `/client/tenders/${Number(id)}/documents?${new URLSearchParams(clean({ page: 1, page_size: 50, ...params }))}`,
  ),

  downloadRequest: (tenderId, documentId) => request(
    `/client/tenders/${Number(tenderId)}/download-request`,
    { method: "POST", body: { document_id: Number(documentId) } },
  ),
  requestDownloadJob: (tenderId) => request(
    `/client/tenders/${Number(tenderId)}/request-download`,
    { method: "POST", body: {} },
  ),
  downloadStatus: (tenderId, jobId) => request(
    `/client/tenders/${Number(tenderId)}/download-status?job_id=${encodeURIComponent(jobId)}`,
  ),

  organizations: (params) => request(`/client/organizations?${new URLSearchParams(clean(params))}`),
  requestOrgTenders: (orgId) => request(`/client/organizations/${Number(orgId)}/request-tenders`, { method: "POST", body: {} }),
  orgRequestStatus: (orgId, jobId) => request(
    `/client/organizations/${Number(orgId)}/request-tenders-status?job_id=${encodeURIComponent(jobId)}`,
  ),

  getSync: () => request("/client/sync"),
  putSync: (data, removed, baseUpdatedAt) => request("/client/sync", {
    method: "PUT", body: { data, removed, base_updated_at: baseUpdatedAt },
  }),

  changes: (since) => request(`/client/changes?since=${encodeURIComponent(Number(since) || 0)}`),
};
