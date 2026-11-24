import { files } from '../platform';
import { api } from './api';
import { getToken } from './auth';
import { signedUrl } from './documents';
import { AuthError, BACKEND_URL, request } from './http';

// The Bid Agent chat (server: Server UI/server/bid_agent, API_CHANGES.md §5). Each
// message runs one agent turn on the server; it saves files into the tender's folder
// on Drive (Docs for Preparation) and fills the Ready for Bid checklist, which reaches
// this phone through the usual sync.

export type ChatCard =
  | { type: 'table'; title: string; columns: string[]; rows: (string | number | null)[][] }
  | {
      type: 'files';
      title: string;
      folder: string;
      files: { file_id: number; name: string; kind: string; folder?: string }[];
      attached: { row: string; file: string }[];
    }
  | {
      type: 'checklist';
      title: string;
      folder: string;
      rows: { id: number; name: string; added: boolean; file: string }[];
    };

export type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  cards?: ChatCard[];
  at: number;
  error?: boolean;
};

export type ChatState = {
  messages: ChatMessage[];
  next: number;
  status: 'idle' | 'working';
  progress: string;
  /** The reply as it is being written (while working). */
  partial?: string;
  ai_enabled: boolean;
  suggestions: string[];
};

export type AgentFile = {
  file_id: number;
  name: string;
  kind: string; // prequalification | form | user
  folder: string; // "Docs for Preparation" | "Ready Docs"
  checklist_item_id: string | null;
  size: number;
  created_at: number;
};

/** A tender the account chatted with the agent about (GET /client/bid-agent/recent). */
export type RecentChat = {
  id: number;
  tender_id: string;
  title: string;
  organisation: string;
  closing_date: string;
  last: string;
  count: number;
  updated_at: number;
};

/** Something the agent learned from a correction ("remember …"). */
export type Learning = {
  id: number;
  employer_key: string;
  text: string;
  source: string;
  tender_id: number | null;
  created_at: number;
  active: number;
};

/** A reference document (certificate, standard format) the agent can attach. */
export type ReferenceDoc = {
  file_id: number;
  name: string;
  label: string;
  created_at: number;
  size: number;
  type: string;
};

const base = (tenderId: string) => `/client/tenders/${encodeURIComponent(tenderId)}/bid-agent`;

export const bidAgentApi = {
  chat: (tenderId: string, since = 0) => request<ChatState>(`${base(tenderId)}/chat?since=${since}`),
  send: (tenderId: string, message: string, since = 0) =>
    request<ChatState>(`${base(tenderId)}/chat?since=${since}`, { method: 'POST', body: { message } }),
  clear: (tenderId: string) => request<ChatState>(`${base(tenderId)}/chat`, { method: 'DELETE' }),
  files: (tenderId: string, folder: 'prep' | 'ready' | '' = '') =>
    request<{ items: AgentFile[] }>(`${base(tenderId)}/files?folder=${folder}`),
  /** Uploads a Docs for Preparation file from this phone to the tender folder on Drive. */
  async uploadPrep(tenderId: string, abs: string, name: string, type?: string | null): Promise<number> {
    const token = getToken();
    if (!token) throw new AuthError('Sign in to continue.');
    const { status, json } = await files.upload(
      `${BACKEND_URL}${base(tenderId)}/prep-files`,
      { 'x-client-key': token },
      {},
      { abs, name, type },
    );
    if (status < 200 || status >= 300) throw new Error(`Upload failed (HTTP ${status}).`);
    return Number((json as { file?: { id?: number } })?.file?.id);
  },
  deletePrep: (tenderId: string, fileId: number) =>
    request(`${base(tenderId)}/prep-files/${Number(fileId)}`, { method: 'DELETE' }),
  recent: () => request<{ items: RecentChat[] }>('/client/bid-agent/recent'),
  instructions: () => request<{ text: string; can_edit: boolean }>('/client/bid-agent/instructions'),
  saveInstructions: (text: string) =>
    request<{ text: string; can_edit: boolean }>('/client/bid-agent/instructions', { method: 'PUT', body: { text } }),
  learnings: () => request<{ items: Learning[]; can_edit: boolean }>('/client/bid-agent/learnings'),
  setLearning: (id: number, patch: { active?: boolean; text?: string }) =>
    request<{ items: Learning[] }>(`/client/bid-agent/learnings/${Number(id)}`, { method: 'PATCH', body: patch }),
  deleteLearning: (id: number) =>
    request<{ items: Learning[] }>(`/client/bid-agent/learnings/${Number(id)}`, { method: 'DELETE' }),
  references: () => request<{ items: ReferenceDoc[] }>('/client/bid-agent/references'),
  async uploadReference(abs: string, name: string, type?: string | null): Promise<ReferenceDoc[]> {
    const token = getToken();
    if (!token) throw new AuthError('Sign in to continue.');
    const { status, json } = await files.upload(
      `${BACKEND_URL}/client/bid-agent/references`,
      { 'x-client-key': token },
      {},
      { abs, name, type },
    );
    if (status < 200 || status >= 300) throw new Error(`Upload failed (HTTP ${status}).`);
    return ((json as { items?: ReferenceDoc[] })?.items ?? []) as ReferenceDoc[];
  },
  deleteReference: (fileId: number) =>
    request<{ items: ReferenceDoc[] }>(`/client/bid-agent/references/${Number(fileId)}`, { method: 'DELETE' }),
  /** Downloads a server file (project-files) to `rel` under Documents; returns the path. */
  async download(fileId: number, rel: string): Promise<string> {
    const { url } = await api.projectFileDownload(fileId);
    const abs = files.abs(rel);
    await files.download(signedUrl(url), abs);
    return abs;
  },
};

/** Did this answer change the checklist or save files (so the phone should sync)? */
export function changesData(m: ChatMessage) {
  return (m.cards ?? []).some(c => c.type === 'files' || c.type === 'checklist');
}
