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
