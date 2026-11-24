import React, { createContext, useContext, useMemo, useState, useSyncExternalStore } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { files, picker } from '../platform';
import { bidAgentApi, changesData } from '../lib/bidAgent';
import type { AgentFile, ChatMessage, ChatState, Learning, RecentChat, ReferenceDoc } from '../lib/bidAgent';
import { adoptServerPrepDoc, serverPrepRel } from '../lib/sharedProjects';
import { syncNow } from '../lib/sync';
import { demoReply, demoSuggestions, demoTraining } from '../fixtures/bidAgent';
import { getTender } from '../fixtures/tenders';

// The Bid Agent chat for a tender. Live: messages come from the server (polled only
// while the agent works); answers that saved files or changed the checklist trigger a
// sync so Ready for Bid and Docs for Preparation update. Demo: scripted answers.

export type AgentChat = {
  messages: ChatMessage[];
  working: boolean;
  progress: string;
  /** The reply as it is being written, while the agent works. */
  partial: string;
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

/** The agent's training: standing instructions, learned notes, reference documents. */
export type AgentTraining = {
  loading: boolean;
  error: string | null;
  canEdit: boolean;
  instructions: string;
  saveInstructions: (text: string) => Promise<void>;
  learnings: Learning[];
  setLearningActive: (id: number, active: boolean) => Promise<void>;
  deleteLearning: (id: number) => Promise<void>;
  references: ReferenceDoc[];
  /** Picks a document on the phone and uploads it; false when cancelled. */
  addReference: () => Promise<boolean>;
  deleteReference: (fileId: number) => Promise<void>;
};

type Source = {
  useChat: (tenderId: string) => AgentChat;
  usePrep: (tenderId: string) => AgentPrep;
  /** Tenders the account chatted about, newest first. */
  useRecent: () => { items: RecentChat[]; loading: boolean };
  useTraining: () => AgentTraining;
  /** Is the agent working on any tender (the tab bar button's dot)? */
  useBusy: () => boolean;
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
    partial: '',
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

const subscribeDemo = (fn: () => void) => {
  demoListeners.add(fn);
  return () => {
    demoListeners.delete(fn);
  };
};
let demoRecentCache: { key: string; items: RecentChat[] } = { key: '', items: [] };
function demoRecent(): RecentChat[] {
  const rows = [...demoThreads.entries()].filter(([, th]) => th.messages.length);
  const key = rows.map(([id, th]) => `${id}:${th.messages.length}`).join('|');
  if (key === demoRecentCache.key) return demoRecentCache.items;
  const items = rows
    .map(([id, th]) => {
      const last = th.messages[th.messages.length - 1];
      return {
        id: 0,
        tender_id: id,
        title: getTender(id)?.title ?? id,
        organisation: getTender(id)?.org ?? '',
        closing_date: '',
        last: last.text,
        count: th.messages.length,
        updated_at: last.at,
      };
    })
    .sort((a, b) => b.updated_at - a.updated_at);
  demoRecentCache = { key, items };
  return items;
}

function useDemoTraining(): AgentTraining {
  const [state, setState] = useState(demoTraining);
  return {
    loading: false,
    error: null,
    canEdit: true,
    instructions: state.instructions,
    saveInstructions: async text => setState(s => ({ ...s, instructions: text })),
    learnings: state.learnings,
    setLearningActive: async (id, active) =>
      setState(s => ({ ...s, learnings: s.learnings.map(l => (l.id === id ? { ...l, active: active ? 1 : 0 } : l)) })),
    deleteLearning: async id => setState(s => ({ ...s, learnings: s.learnings.filter(l => l.id !== id) })),
    references: state.references,
    addReference: async () => {
      setState(s => ({
        ...s,
        references: [
          ...s.references,
          { file_id: Date.now(), name: 'Bank solvency certificate.pdf', label: '', created_at: Date.now() / 1000, size: 182000, type: 'application/pdf' },
        ],
      }));
      return true;
    },
    deleteReference: async fileId => setState(s => ({ ...s, references: s.references.filter(r => r.file_id !== fileId) })),
  };
}

const demoSource: Source = {
  useChat: useDemoChat,
  usePrep: () => ({ files: [], open: async (_projectId, f) => `“${f.name}” opens on the phone.`, remove: async () => {} }),
  useRecent: () => ({ items: useSyncExternalStore(subscribeDemo, demoRecent), loading: false }),
  useTraining: useDemoTraining,
  useBusy: () => useSyncExternalStore(subscribeDemo, () => [...demoThreads.values()].some(th => th.working)),
};

function merge(prev: ChatState | undefined, incoming: ChatState): ChatState {
  const known = new Set((prev?.messages ?? []).map(m => m.id));
  const added = incoming.messages.filter(m => !known.has(m.id));
  return { ...incoming, messages: [...(prev?.messages ?? []), ...added] };
}

type QC = ReturnType<typeof useQueryClient>;
const chatKey = (tenderId: string) => ['agentChat', tenderId];

/** One poll of a tender's chat, merged into the cache (also used by useBusy). */
async function fetchChat(qc: QC, tenderId: string): Promise<ChatState> {
  const key = chatKey(tenderId);
  const prev = qc.getQueryData<ChatState>(key);
  const since = prev?.messages.length ? prev.messages[prev.messages.length - 1].id : 0;
  const r = await bidAgentApi.chat(tenderId, since);
  const merged = merge(prev, r);
  if (prev) {
    const added = r.messages.filter(m => !prev.messages.some(p => p.id === m.id));
    if (added.some(m => m.role === 'assistant' && changesData(m))) {
      syncNow().catch(() => {});
      qc.invalidateQueries({ queryKey: ['agentPrep', tenderId] });
    }
    if (added.some(m => m.role === 'assistant')) qc.invalidateQueries({ queryKey: ['agentRecent'] });
  }
  return merged;
}

// The reply streams in: poll quickly while the agent works.
const pollWhileWorking = (query: { state: { data: unknown } }) =>
  (query.state.data as ChatState | undefined)?.status === 'working' ? 900 : false;

function useLiveChat(tenderId: string): AgentChat {
  const qc = useQueryClient();
  const key = useMemo(() => chatKey(tenderId), [tenderId]);
  const q = useQuery({
    queryKey: key,
    enabled: Boolean(tenderId),
    queryFn: () => fetchChat(qc, tenderId),
    refetchInterval: pollWhileWorking,
  });
  const data = q.data;
  return {
    messages: data?.messages ?? [],
    working: data?.status === 'working',
    progress: data?.progress ?? '',
    partial: data?.status === 'working' ? data?.partial ?? '' : '',
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

function useLiveRecent() {
  const q = useQuery({
    queryKey: ['agentRecent'],
    queryFn: () => bidAgentApi.recent().then(r => r.items),
    staleTime: 30 * 1000,
  });
  return { items: q.data ?? [], loading: q.isLoading };
}

function useLiveTraining(): AgentTraining {
  const qc = useQueryClient();
  const ins = useQuery({ queryKey: ['agentInstructions'], queryFn: bidAgentApi.instructions });
  const learn = useQuery({ queryKey: ['agentLearnings'], queryFn: bidAgentApi.learnings });
  const refs = useQuery({ queryKey: ['agentReferences'], queryFn: () => bidAgentApi.references().then(r => r.items) });
  const err = ins.error || learn.error || refs.error;
  const setLearnings = (items: Learning[]) =>
    qc.setQueryData(['agentLearnings'], (old: { items: Learning[]; can_edit: boolean } | undefined) => ({
      can_edit: old?.can_edit ?? false,
      items,
    }));
  return {
    loading: ins.isLoading || learn.isLoading || refs.isLoading,
    error: err ? (err as Error).message : null,
    canEdit: ins.data?.can_edit ?? false,
    instructions: ins.data?.text ?? '',
    saveInstructions: async text => {
      qc.setQueryData(['agentInstructions'], await bidAgentApi.saveInstructions(text));
    },
    learnings: learn.data?.items ?? [],
    setLearningActive: async (id, active) => {
      setLearnings((await bidAgentApi.setLearning(id, { active })).items);
    },
    deleteLearning: async id => {
      setLearnings((await bidAgentApi.deleteLearning(id)).items);
    },
    references: refs.data ?? [],
    addReference: async () => {
      const f = await picker.pickDocument();
      if (!f) return false;
      const abs = decodeURI(f.uri.replace(/^file:\/\//, ''));
      qc.setQueryData(['agentReferences'], await bidAgentApi.uploadReference(abs, f.name, f.mimeType));
      return true;
    },
    deleteReference: async fileId => {
      qc.setQueryData(['agentReferences'], (await bidAgentApi.deleteReference(fileId)).items);
    },
  };
}

function useLiveBusy(): boolean {
  const qc = useQueryClient();
  const cache = qc.getQueryCache();
  const working = useSyncExternalStore(
    fn => cache.subscribe(fn),
    () =>
      cache
        .findAll({ queryKey: ['agentChat'] })
        .filter(q => (q.state.data as ChatState | undefined)?.status === 'working')
        .map(q => String(q.queryKey[1]))
        .join('|'),
  );
  const ids = working ? working.split('|') : [];
  // Keeps polling chats that are still working after their screen closed.
  useQueries({
    queries: ids.map(id => ({ queryKey: chatKey(id), queryFn: () => fetchChat(qc, id), refetchInterval: 2500 })),
  });
  return ids.length > 0;
}

const liveSource: Source = {
  useChat: useLiveChat,
  usePrep: useLivePrep,
  useRecent: useLiveRecent,
  useTraining: useLiveTraining,
  useBusy: useLiveBusy,
};

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
