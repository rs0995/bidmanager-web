import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Lock, MessageSquare, Plus, RotateCcw, Save, Search, Sparkles, Trash2, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { Spinner } from './ui/shared';
import { ChatThread, useAgentChat } from './AgentChatPanel';

/* Bid Agent page (sidebar): chat about any tender, project or not, and train the
   agent. Left: search the server's tenders by ID or title, and recent chats.
   Right: the chat, or the training tabs (standing instructions, what it learned
   from corrections, reference documents, checklist templates). Training is shared
   by the organisation; only its admins change it. */

const TABS = [
  { k: 'chat', label: 'Chat' },
  { k: 'instructions', label: 'Instructions' },
  { k: 'learned', label: 'Learned' },
  { k: 'references', label: 'Reference documents' },
  { k: 'templates', label: 'Checklist templates' },
];

const changesData = (m) => (m.cards || []).some((c) => c.type === 'files' || c.type === 'checklist');

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

export default function BidAgentPage({ onNavigate }) {
  const [tab, setTab] = useState('chat');
  const [tender, setTender] = useState(null); // { id, tender_id, title }
  return (
    <div className="flex h-full min-h-0 flex-col p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-white"><Sparkles size={17} /></div>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Bid Agent</h1>
          <p className="text-xs text-[var(--text-muted)]">Ask about any tender: qualification criteria, forms, the documents checklist. Teach it how your team works.</p>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-[var(--border)]">
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={cn('rounded-t-md px-3 py-1.5 text-xs', tab === t.k ? 'bg-[var(--surface-2)] font-semibold' : 'text-[var(--text-muted)] hover:text-[var(--text)]')}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'chat' ? <ChatTab tender={tender} setTender={setTender} />
          : tab === 'instructions' ? <InstructionsTab />
            : tab === 'learned' ? <LearnedTab />
              : tab === 'references' ? <ReferencesTab />
                : <TemplatesTab onNavigate={onNavigate} />}
      </div>
    </div>
  );
}

function ChatTab({ tender, setTender }) {
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim());
  const search = useQuery({
    queryKey: ['bid-agent-search', q],
    queryFn: () => api.searchServerTenders(q),
    enabled: q.length >= 2,
  });
  const recent = useQuery({ queryKey: ['bid-agent-recent'], queryFn: api.getBidAgentRecent });
  const results = q.length >= 2 ? (search.data?.items || []) : [];
  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 md:grid-cols-[300px_1fr]">
      <div className="flex min-h-0 flex-col gap-3">
        <label className="relative block">
          <Search size={13} className="absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
          <input className="input-field h-8 w-full text-xs" style={{ paddingLeft: 30 }} placeholder="Tender ID or title" value={query}
            onChange={(e) => setQuery(e.target.value)} aria-label="Search tenders" />
        </label>
        <div className="card min-h-0 flex-1 overflow-auto p-1">
          {q.length >= 2 && (
            <>
              <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Tenders</div>
              {search.isLoading ? <div className="p-3"><Spinner size={13} /></div> : results.length ? results.map((t) => (
                <TenderRow key={t.id} active={tender?.id === t.id} title={t.title} sub={`${t.tender_id} · ${String(t.org_chain || t.organization || '').split('||')[0]}`}
                  onClick={() => setTender({ id: t.id, tender_id: t.tender_id, title: t.title })} />
              )) : <p className="px-2 py-2 text-xs text-[var(--text-muted)]">{search.error?.message || 'No tender matches.'}</p>}
            </>
          )}
          <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Recent chats</div>
          {recent.isLoading ? <div className="p-3"><Spinner size={13} /></div> : (recent.data?.items || []).length ? recent.data.items.map((r) => (
            <TenderRow key={r.id} icon active={tender?.id === r.id} title={r.title || r.tender_id} sub={r.last}
              onClick={() => setTender({ id: r.id, tender_id: r.tender_id, title: r.title })} />
          )) : <p className="px-2 py-2 text-xs text-[var(--text-muted)]">No chats yet. Search a tender above.</p>}
        </div>
      </div>
      <div className="card flex min-h-[420px] flex-col overflow-hidden">
        {tender ? <TenderChat key={tender.id} tender={tender} /> : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-[var(--text-muted)]">
            <MessageSquare size={22} />
            Pick a tender on the left to chat about it. It doesn't need to be a project; saving files or checklist rows makes one.
          </div>
        )}
      </div>
    </div>
  );
}

function TenderRow({ title, sub, active, icon, onClick }) {
  return (
    <button onClick={onClick} className={cn('flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left', active ? 'bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-1)]')}>
      {icon && <MessageSquare size={12} className="mt-0.5 shrink-0 text-[var(--accent)]" />}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-xs font-medium">{title}</span>
        <span className="block truncate text-[10px] text-[var(--text-muted)]">{sub}</span>
      </span>
    </button>
  );
}

function TenderChat({ tender }) {
  const qc = useQueryClient();
  const chat = useAgentChat(tender.id, async (answers) => {
    qc.invalidateQueries({ queryKey: ['bid-agent-recent'] });
    if (answers.some(changesData)) await api.pullUserData().catch(() => {});
  });
  const openFile = (f) => api.saveAgentFile(f.file_id, f.name, '').catch(() => {});
  return (
    <>
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <Sparkles size={14} className="text-[var(--accent)]" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{tender.title || tender.tender_id}</span>
        <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{tender.tender_id}</span>
        {chat.messages.length > 0 && !chat.busy && (
          <button title="Clear the conversation" onClick={chat.clear} className="text-[var(--text-muted)] hover:text-[var(--text)]"><RotateCcw size={13} /></button>
        )}
      </div>
      <ChatThread chat={chat} onOpenFile={openFile} />
    </>
  );
}

function InstructionsTab() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['bid-agent-instructions'], queryFn: api.getBidAgentInstructions });
  const [text, setText] = useState('');
  const [state, setState] = useState('');
  useEffect(() => { if (data) setText(data.text || ''); }, [data]);
  if (error) return <p className="text-sm text-rose-400">{error.message}</p>;
  if (isLoading) return <Spinner size={16} />;
  const save = async () => {
    setState('saving');
    try {
      qc.setQueryData(['bid-agent-instructions'], await api.saveBidAgentInstructions(text));
      setState('saved'); setTimeout(() => setState(''), 1800);
    } catch (e) { setState(e.message); }
  };
  return (
    <div className="card max-w-3xl space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Standing instructions</h2>
        <p className="text-xs text-[var(--text-muted)]">The agent follows these in every chat, e.g. “Save the prequal as Excel”, “Answer in one line”, “We bid as JV lead, check JV criteria too”.</p>
      </div>
      <textarea className="input-field min-h-[180px] w-full py-2 text-sm" value={text} readOnly={!data.can_edit}
        onChange={(e) => setText(e.target.value)} placeholder="One instruction per line" aria-label="Standing instructions" />
      {data.can_edit ? (
        <div className="flex items-center gap-2">
          <button className="btn-primary h-8 gap-1 text-xs" onClick={save} disabled={state === 'saving' || text.trim() === (data.text || '').trim()}>
            <Save size={12} />{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Save'}
          </button>
          {state && !['saving', 'saved'].includes(state) && <span className="text-xs text-rose-400">{state}</span>}
        </div>
      ) : <span className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]"><Lock size={12} />Only your organisation's admins can change these.</span>}
    </div>
  );
}

function LearnedTab() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['bid-agent-learnings'], queryFn: api.getBidAgentLearnings });
  const [err, setErr] = useState('');
  if (error) return <p className="text-sm text-rose-400">{error.message}</p>;
  if (isLoading) return <Spinner size={16} />;
  const run = async (p) => {
    setErr('');
    try { const r = await p; qc.setQueryData(['bid-agent-learnings'], (old) => ({ ...old, items: r.items })); } catch (e) { setErr(e.message); }
  };
  const items = data.items || [];
  return (
    <div className="card max-w-3xl p-2">
      {err && <p className="p-2 text-xs text-rose-400">{err}</p>}
      {items.length ? items.map((l) => (
        <div key={l.id} className="flex items-start gap-3 border-b border-[var(--border)] px-2 py-2 last:border-0">
          <div className="min-w-0 flex-1">
            <div className={cn('text-[13px]', !l.active && 'text-[var(--text-muted)] line-through')}>{l.text}</div>
            <div className="text-[11px] text-[var(--text-muted)]">{l.employer_key ? `For ${l.employer_key} tenders` : 'For every tender'}{l.active ? '' : ' · paused'}</div>
          </div>
          {data.can_edit && (
            <>
              <button className="text-xs font-semibold text-[var(--accent)]" onClick={() => run(api.updateBidAgentLearning(l.id, { active: !l.active }))}>{l.active ? 'Pause' : 'Use'}</button>
              <button title="Forget" aria-label="Forget" className="text-[var(--text-muted)] hover:text-rose-400" onClick={() => run(api.deleteBidAgentLearning(l.id))}><Trash2 size={13} /></button>
            </>
          )}
        </div>
      )) : (
        <p className="p-3 text-xs text-[var(--text-muted)]">
          Nothing yet. Correct the agent in a chat and say “remember …” (e.g. “remember: for MMRDA the criteria are in the NIT”), and it keeps it here.
        </p>
      )}
    </div>
  );
}

function ReferencesTab() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['bid-agent-references'], queryFn: api.getBidAgentReferences });
  const status = useQuery({ queryKey: ['bid-agent-instructions'], queryFn: api.getBidAgentInstructions });
  const canEdit = Boolean(status.data?.can_edit);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (error) return <p className="text-sm text-rose-400">{error.message}</p>;
  if (isLoading) return <Spinner size={16} />;
  const upload = async (arg) => {
    setBusy(true); setErr('');
    try { const r = await api.uploadBidAgentReference(arg); qc.setQueryData(['bid-agent-references'], r); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const add = async () => {
    const bridge = window.bidmanagerDesktop;
    if (bridge?.pickPath && bridge?.uploadFile) {
      const pick = await bridge.pickPath({ file: true, title: 'Select a reference document' });
      if (pick?.ok && pick.path) upload({ filePath: pick.path });
    }
  };
  const remove = async (id) => {
    setErr('');
    try { qc.setQueryData(['bid-agent-references'], await api.deleteBidAgentReference(id)); } catch (e) { setErr(e.message); }
  };
  const items = data.items || [];
  return (
    <div className="max-w-3xl space-y-3">
      <p className="text-xs text-[var(--text-muted)]">Documents you submit with most bids (GST, PAN, ISO certificates, solvency, standard formats). Ask the agent to attach them, e.g. “attach the GST certificate to its checklist row”. Stored on Drive in “Bid Agent Library”.</p>
      <div className="card p-2">
        {items.length ? items.map((r) => (
          <div key={r.file_id} className="flex items-center gap-2 border-b border-[var(--border)] px-2 py-2 last:border-0">
            <FileText size={14} className="text-[var(--accent)]" />
            <span className="min-w-0 flex-1 truncate text-[13px]">{r.name}</span>
            <span className="text-[11px] text-[var(--text-muted)]">{Math.max(1, Math.round((r.size || 0) / 1024))} KB</span>
            {canEdit && <button title={`Remove ${r.name}`} className="text-[var(--text-muted)] hover:text-rose-400" onClick={() => remove(r.file_id)}><Trash2 size={13} /></button>}
          </div>
        )) : <p className="p-3 text-xs text-[var(--text-muted)]">No reference documents yet.</p>}
      </div>
      {err && <p className="text-xs text-rose-400">{err}</p>}
      {canEdit && (window.bidmanagerDesktop?.uploadFile ? (
        <button className="btn-secondary h-8 gap-1 text-xs" onClick={add} disabled={busy}>{busy ? <Spinner size={12} /> : <Plus size={12} />}Add a document</button>
      ) : (
        <label className="btn-secondary inline-flex h-8 cursor-pointer gap-1 text-xs">
          {busy ? <Spinner size={12} /> : <Upload size={12} />}Add a document
          <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload({ file: f }); }} />
        </label>
      ))}
    </div>
  );
}

function TemplatesTab({ onNavigate }) {
  return (
    <div className="card max-w-3xl space-y-2 p-4 text-[13px]">
      <h2 className="text-sm font-semibold">Checklist templates</h2>
      <p className="text-[var(--text-muted)]">
        When you ask the agent to prepare the documents checklist, it starts from your checklist template whose
        organisation matches the tender's employer (e.g. “GMRC”), or else a template named <b>Bid Agent default</b>,
        then adds what this tender asks for and attaches the files it prepared.
      </p>
      {onNavigate && <button className="btn-secondary h-8 text-xs" onClick={() => onNavigate('templates')}>Open Templates</button>}
    </div>
  );
}
