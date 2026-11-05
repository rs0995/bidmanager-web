import React, { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { files } from '../platform';
import { bidAgentApi, changesData } from '../lib/bidAgent';
import type { AgentFile, ChatMessage, ChatState } from '../lib/bidAgent';
import { adoptServerPrepDoc, serverPrepRel } from '../lib/sharedProjects';
import { syncNow } from '../lib/sync';
import { demoReply, demoSuggestions } from '../fixtures/bidAgent';

// The Bid Agent chat for a tender. Live: messages come from the server (polled only
// while the agent works); answers that saved files or changed the checklist trigger a
// sync so Ready for Bid and Docs for Preparation update. Demo: scripted answers.

export type AgentChat = {
  messages: ChatMessage[];
  working: boolean;
  progress: string;
  suggestions: string[];
  aiEnabled: boolean;
  loading: boolean;
  error: string | null;
  send: (text: string) => Promise<void>;
  clear: () => Promise<void>;
};

export type AgentPrep = {
  /** Files in the tender's Docs for Preparation on Drive. */
  files: AgentFile[];
  /** Downloads (once) and opens a Drive prep file; resolves with a message, if any. */
  open: (projectId: number | null, file: Pick<AgentFile, 'file_id' | 'name'> & { size?: number | null }) => Promise<string | void>;
  /** Deletes a Drive-only prep file. */
  remove: (file: AgentFile) => Promise<void>;
};

type Source = {
  useChat: (tenderId: string) => AgentChat;
  usePrep: (tenderId: string) => AgentPrep;
};

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

type DemoThread = { messages: ChatMessage[]; working: boolean };
const demoThreads = new Map<string, DemoThread>();
const demoListeners = new Set<() => void>();
// One shared empty thread: useSyncExternalStore needs the same object back each time.
const EMPTY_THREAD: DemoThread = { messages: [], working: false };
const demoGet = (id: string) => demoThreads.get(id) ?? EMPTY_THREAD;
const demoSet = (id: string, t: DemoThread) => {
  demoThreads.set(id, t);
  demoListeners.forEach(fn => fn());
};

function useDemoChat(tenderId: string): AgentChat {
  const thread = useSyncExternalStore(
    fn => {
      demoListeners.add(fn);
      return () => demoListeners.delete(fn);
    },
    () => demoGet(tenderId),
  );
  return {
    messages: thread.messages,
    working: thread.working,
    progress: thread.working ? 'Working…' : '',
    suggestions: demoSuggestions,
    aiEnabled: true,
    loading: false,
    error: null,
    send: async text => {
      const cur = demoGet(tenderId);
      const id = (cur.messages[cur.messages.length - 1]?.id ?? 0) + 1;
      const user: ChatMessage = { id, role: 'user', text, at: Date.now() / 1000 };
      demoSet(tenderId, { messages: [...cur.messages, user], working: true });
      await wait(600);
      const reply: ChatMessage = { ...demoReply(text), id: id + 1, at: Date.now() / 1000 };
      demoSet(tenderId, { messages: [...demoGet(tenderId).messages, reply], working: false });
    },
    clear: async () => demoSet(tenderId, { messages: [], working: false }),
  };
}

const demoSource: Source = {
  useChat: useDemoChat,
  usePrep: () => ({ files: [], open: async (_projectId, f) => `“${f.name}” opens on the phone.`, remove: async () => {} }),
};

function merge(prev: ChatState | undefined, incoming: ChatState): ChatState {
  const known = new Set((prev?.messages ?? []).map(m => m.id));
  const added = incoming.messages.filter(m => !known.has(m.id));
  return { ...incoming, messages: [...(prev?.messages ?? []), ...added] };
}

function useLiveChat(tenderId: string): AgentChat {
  const qc = useQueryClient();
  const key = useMemo(() => ['agentChat', tenderId], [tenderId]);
  const afterAnswer = (added: ChatMessage[]) => {
    if (added.some(m => m.role === 'assistant' && changesData(m))) {
      syncNow().catch(() => {});
      qc.invalidateQueries({ queryKey: ['agentPrep', tenderId] });
    }
  };
  const q = useQuery({
    queryKey: key,
    enabled: Boolean(tenderId),
    queryFn: async () => {
      const prev = qc.getQueryData<ChatState>(key);
      const since = prev?.messages.length ? prev.messages[prev.messages.length - 1].id : 0;
      const r = await bidAgentApi.chat(tenderId, since);
      const merged = merge(prev, r);
      if (prev) afterAnswer(r.messages.filter(m => !prev.messages.some(p => p.id === m.id)));
      return merged;
    },
    refetchInterval: query => ((query.state.data as ChatState | undefined)?.status === 'working' ? 1500 : false),
  });
  const data = q.data;
  return {
    messages: data?.messages ?? [],
    working: data?.status === 'working',
    progress: data?.progress ?? '',
    suggestions: data?.suggestions ?? [],
    aiEnabled: data?.ai_enabled ?? true,
    loading: q.isLoading,
    error: q.error ? (q.error as Error).message : null,
    send: async text => {
      const prev = qc.getQueryData<ChatState>(key);
      const since = prev?.messages.length ? prev.messages[prev.messages.length - 1].id : 0;
      const r = await bidAgentApi.send(tenderId, text, since);
      qc.setQueryData(key, merge(prev, r));
    },
    clear: async () => {
      const r = await bidAgentApi.clear(tenderId);
      qc.setQueryData(key, r);
    },
  };
}

function useLivePrep(tenderId: string): AgentPrep {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['agentPrep', tenderId],
    enabled: Boolean(tenderId),
    queryFn: () => bidAgentApi.files(tenderId, 'prep').then(r => r.items),
    staleTime: 60 * 1000,
  });
  return {
    files: q.data ?? [],
    open: async (projectId, file) => {
      const rel = serverPrepRel(projectId ?? 0, file.file_id, file.name);
      const abs = files.abs(rel);
      if (!(await files.exists(abs).catch(() => false))) {
        await bidAgentApi.download(file.file_id, rel);
      }
      if (projectId) adoptServerPrepDoc(projectId, file, rel);
      await files.open(abs);
    },
    remove: async file => {
      await bidAgentApi.deletePrep(tenderId, file.file_id);
      qc.invalidateQueries({ queryKey: ['agentPrep', tenderId] });
    },
  };
}

const liveSource: Source = { useChat: useLiveChat, usePrep: useLivePrep };

const BidAgentContext = createContext<Source | null>(null);

export function BidAgentProvider({ mode, children }: { mode: 'demo' | 'live'; children: React.ReactNode }) {
  const value = useMemo(() => (mode === 'live' ? liveSource : demoSource), [mode]);
  return <BidAgentContext.Provider value={value}>{children}</BidAgentContext.Provider>;
}

export function useBidAgent(): Source {
  const ctx = useContext(BidAgentContext);
  if (!ctx) throw new Error('useBidAgent must be used inside BidAgentProvider');
  return ctx;
}
