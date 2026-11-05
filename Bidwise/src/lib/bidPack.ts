import { files } from '../platform';
import { getToken } from './auth';
import { AuthError, BACKEND_URL, request } from './http';

// Bid packs (server: bid_agent_server/, routes in API_CHANGES.md §5). The server reads
// a tender's downloaded documents, finds the qualification criteria and bidding forms,
// checks the criteria against the organisation's company profile and builds editable
// Word / Excel forms. One bid pack per tender, shared by the organisation.

export type BidPackStatus = 'none' | 'running' | 'completed' | 'failed';
export type CheckStatus = 'Meets' | 'Shortfall' | 'Check' | 'Data missing' | 'Manual check';

export type BidSection = {
  role: string;
  label: string;
  found: boolean;
  locations: { file: string; start_page: number; end_page: number }[];
};

export type BidCheck = {
  ref: string;
  subject: string;
  requirement: string;
  required: string;
  actual: string;
  status: CheckStatus | string;
  forms: string[];
  remarks: string;
};

export type BidForm = {
  code: string;
  title: string;
  file: string;
  start_page: number;
  end_page: number;
  source: string;
};

export type BidPackFile = {
  name: string;
  kind: 'workbook' | 'form' | 'zip';
  code?: string;
  title?: string;
};

export type BidPackResult = {
  tender: { employer: string; reference: string; title: string };
  org_name: string;
  key_sections: BidSection[];
  compliance: BidCheck[];
  forms: BidForm[];
  missing_forms: string[];
  criteria: {
    criteria: { ref: string; subject: string; requirement: string; forms: string[] }[];
    personnel: { position: string; count: string; qualification: string; experience: string }[];
    equipment: { type: string; min_units: string; max_age_years: string }[];
  };
  llm: { used: boolean };
};

export type BidPack = {
  status: BidPackStatus;
  error?: string;
  updated_at?: number;
  logs: string[];
  next: number;
  result: BidPackResult | null;
  files: BidPackFile[];
};

export type BidAgentStatus = {
  ai_enabled: boolean;
  owner: 'organisation' | 'individual';
  can_edit_profile: boolean;
};

export const bidPackApi = {
  status: () => request<BidAgentStatus>('/client/bid-agent/status'),
  get: (tenderId: string, since = 0) =>
    request<BidPack>(
      `/client/tenders/${encodeURIComponent(tenderId)}/bid-pack?since=${since}`,
    ),
  start: (tenderId: string) =>
    request<BidPack>(`/client/tenders/${encodeURIComponent(tenderId)}/bid-pack`, {
      method: 'POST',
    }),
  /** Downloads a generated file to Documents/bidpacks/<tender>/ and returns its path. */
  async download(tenderId: string, name: string): Promise<string> {
    const token = getToken();
    if (!token) throw new AuthError('Sign in to continue.');
    const safe = name.replace(/[\\/:*?"<>|]+/g, ' ');
    const abs = files.abs(`bidpacks/${tenderId}/${safe}`);
    await files.download(
      `${BACKEND_URL}/client/tenders/${encodeURIComponent(tenderId)}/bid-pack/files/${encodeURIComponent(name)}`,
      abs,
      { 'x-client-key': token },
    );
    return abs;
  },
};

/** Counts per result, for the summary chips. */
export function checkCounts(checks: BidCheck[]) {
  const out = { meets: 0, gaps: 0, review: 0 };
  for (const c of checks) {
    if (c.status === 'Meets') out.meets += 1;
    else if (c.status === 'Shortfall') out.gaps += 1;
    else if (c.status !== 'Manual check') out.review += 1;
  }
  return out;
}
