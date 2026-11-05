import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUp, CheckCircle2, ChevronDown, ChevronRight, Clock, FileSpreadsheet, FileText,
  RotateCcw, Sparkles,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { Spinner } from './ui/shared';

/* Bid Agent chat, above the project's Ready Docs checklist.
   The user asks in their own words ("show the prequal", "save it as PDF",
   "extract form FIN-3.2", "prepare the checklist") and the agent does it on the
   server: tables appear here, files are saved to the tender's folder on Drive
   (and, on the desktop, downloaded into the project's Working Docs folder), and
   checklist rows with the forms attached arrive through sync. */

const SAVED_KEY = 'bm.bidAgent.savedFiles';
const readSaved = () => { try { return new Set(JSON.parse(localStorage.getItem(SAVED_KEY) || '[]')); } catch { return new Set(); } };
const writeSaved = (set) => { try { localStorage.setItem(SAVED_KEY, JSON.stringify([...set].slice(-2000))); } catch { /* ignore */ } };
const changesData = (m) => (m.cards || []).some((c) => c.type === 'files' || c.type === 'checklist');

export default function AgentChatPanel({ project, resolveProjectFolder, folderFor, onDataChanged, pushToast }) {
  const qc = useQueryClient();
  const tenderId = String(project?.source_tender_id || '').trim();
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('bm.bidAgent.open') !== '0'; } catch { return true; } });
  const [text, setText] = useState('');
  const [messages, setMessages] = useState([]);
  const [state, setState] = useState({ status: 'idle', progress: '', suggestions: [], ai_enabled: true });
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const lastId = useRef(0);

  useEffect(() => { try { localStorage.setItem('bm.bidAgent.open', open ? '1' : '0'); } catch { /* ignore */ } }, [open]);

  const { data: tenderDbId, isLoading: resolving } = useQuery({
    queryKey: ['bid-agent-tender', tenderId],
    queryFn: () => api.resolveTenderRowId({ tender_id: tenderId }),
    enabled: Boolean(tenderId),
  });

  // Saves new files from an answer into <project>/Working Docs (desktop, once per file).
  const saveToWorkingDocs = async (msgs) => {
    const files = msgs.flatMap((m) => (m.cards || []).filter((c) => c.type === 'files').flatMap((c) => c.files || []));
    if (!files.length || !window.bidmanagerDesktop?.downloadFile) return;
    const saved = readSaved();
    const todo = files.filter((f) => !saved.has(f.file_id));
    if (!todo.length) return;
    const base = await resolveProjectFolder().catch(() => '');
    if (!base) return;
    const dir = folderFor(base, 'Working Docs');
    for (const f of todo) {
      try {
        await api.saveAgentFile(f.file_id, f.name, dir);
        saved.add(f.file_id);
      } catch (e) {
        pushToast?.({ type: 'error', message: `Couldn't save ${f.name}: ${e.message}` });
      }
    }
    writeSaved(saved);
    pushToast?.({ type: 'success', message: `Saved to Working Docs: ${todo.map((f) => f.name).join(', ')}` });
  };

  const apply = async (r, { initial = false } = {}) => {
    const known = new Set(messages.map((m) => m.id));
    const added = (r.messages || []).filter((m) => !known.has(m.id));
    if (added.length) {
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        return [...prev, ...added.filter((m) => !ids.has(m.id))];
      });
      lastId.current = Math.max(lastId.current, ...added.map((m) => m.id));
    }
    setState({ status: r.status, progress: r.progress, suggestions: r.suggestions || [], ai_enabled: r.ai_enabled });
    if (!initial) {
      const answers = added.filter((m) => m.role === 'assistant');
      if (answers.some(changesData)) {
        await api.pullUserData().catch(() => {});
        qc.invalidateQueries({ queryKey: ['project-checklist', project.id] });
        onDataChanged?.();
        saveToWorkingDocs(answers);
      }
    }
  };

  // Initial load, then poll only while the agent works.
  useEffect(() => {
    if (!tenderDbId) return undefined;
    let stop = false;
    lastId.current = 0;
    setMessages([]);
    api.getBidChat(tenderDbId, 0).then((r) => !stop && apply(r, { initial: true })).catch((e) => !stop && setError(e.message));
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderDbId]);

  useEffect(() => {
    if (!tenderDbId || state.status !== 'working') return undefined;
    let stop = false;
    const timer = setInterval(() => {
      api.getBidChat(tenderDbId, lastId.current).then((r) => !stop && apply(r)).catch(() => {});
    }, 1500);
    return () => { stop = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderDbId, state.status, messages.length]);

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages.length, state.status]);

  const send = async (msg) => {
    const body = String(msg || '').trim();
    if (!body || !tenderDbId || sending || state.status === 'working') return;
    setSending(true); setError('');
    try {
      const r = await api.sendBidChat(tenderDbId, body, lastId.current);
      setText('');
      await apply(r);
      setOpen(true);
    } catch (e) {
      setError(e?.detail?.message || e?.message || String(e));
    } finally { setSending(false); }
  };

  const clear = async () => {
    if (!tenderDbId) return;
    try {
      const r = await api.clearBidChat(tenderDbId);
      setMessages([]); lastId.current = 0;
      setState((s) => ({ ...s, status: r.status }));
    } catch (e) { setError(e.message); }
  };

  const openFile = async (f) => {
    try {
      const base = await resolveProjectFolder().catch(() => '');
      const dir = base ? folderFor(base, 'Working Docs') : '';
      const { path } = await api.saveAgentFile(f.file_id, f.name, dir);
      if (path && window.bidmanagerDesktop?.openPath) await window.bidmanagerDesktop.openPath(path);
    } catch (e) { pushToast?.({ type: 'error', message: e.message }); }
  };

  const busy = sending || state.status === 'working';
  const asked = useMemo(() => new Set(messages.filter((m) => m.role === 'user').map((m) => m.text)), [messages]);
  const chips = (state.suggestions || []).filter((s) => !asked.has(s)).slice(0, 5);

  if (!tenderId) return null;
  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface-0)]">
      <button className="flex w-full items-center gap-2 px-5 py-2 text-left" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={14} className="text-[var(--text-muted)]" /> : <ChevronRight size={14} className="text-[var(--text-muted)]" />}
        <Sparkles size={14} className="text-[var(--accent)]" />
        <span className="text-sm font-semibold">Bid Agent</span>
        <span className="truncate text-[11px] text-[var(--text-muted)]">
          {busy ? (state.progress || 'Working…') : state.ai_enabled ? 'Ask for the prequal, tender forms or the documents checklist' : 'Basic mode: AI reading is off on the server'}
        </span>
        {busy && <Spinner size={12} className="ml-1 text-[var(--accent)]" />}
        {open && messages.length > 0 && !busy && (
          <span role="button" tabIndex={0} title="Clear the conversation" onClick={(e) => { e.stopPropagation(); clear(); }}
            className="ml-auto text-[var(--text-muted)] hover:text-[var(--text)]"><RotateCcw size={13} /></span>
        )}
      </button>
      {open && (
        <div className="px-5 pb-3">
          {resolving ? <div className="py-3"><Spinner size={14} /></div> : !tenderDbId ? (
            <p className="py-2 text-xs text-[var(--text-muted)]">This tender is no longer on the server.</p>
          ) : (
            <>
              {messages.length > 0 && (
                <div ref={listRef} className="mb-2 max-h-[340px] space-y-2 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
                  {messages.map((m) => <Message key={m.id} m={m} onOpenFile={openFile} />)}
                  {busy && (
                    <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]"><Spinner size={11} />{state.progress || 'Working…'}</div>
                  )}
                </div>
              )}
              {error && <div className="mb-2 text-xs text-rose-400">{error}</div>}
              {!busy && chips.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {chips.map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--text)]">{s}</button>
                  ))}
                </div>
              )}
              <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
                <input value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
                  placeholder="Ask the Bid Agent… e.g. “save the prequal as PDF”, “extract form FIN-3.2”, “prepare the checklist”"
                  className="input-field h-9 flex-1 text-sm" />
                <button type="submit" disabled={busy || !text.trim()} className="btn-primary h-9 w-9 justify-center p-0" title="Send">
                  {busy ? <Spinner size={13} /> : <ArrowUp size={15} />}
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Message({ m, onOpenFile }) {
  const mine = m.role === 'user';
  return (
    <div className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
      {m.text && (
        <div className={cn('max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-1.5 text-[13px]',
          mine ? 'bg-[var(--accent)] text-white' : m.error ? 'bg-rose-500/10 text-rose-400' : 'bg-[var(--surface-2)] text-[var(--text)]')}>
          {m.text}
        </div>
      )}
      {(m.cards || []).map((c, i) => <CardView key={i} card={c} onOpenFile={onOpenFile} />)}
    </div>
  );
}

function CardView({ card, onOpenFile }) {
  const [all, setAll] = useState(false);
  if (card.type === 'table') {
    const rows = all ? card.rows : card.rows.slice(0, 8);
    return (
      <div className="mt-1 w-full overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-0)]">
        <div className="px-2.5 pt-2 text-[11px] font-semibold text-[var(--text-muted)]">{card.title}</div>
        <table className="data-table text-[11px]">
          <thead><tr>{card.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{r.map((v, j) => <td key={j} className={cn('align-top', j === 2 && 'min-w-[280px] whitespace-pre-wrap')}>{v == null ? '' : String(v)}</td>)}</tr>
            ))}
          </tbody>
        </table>
        {card.rows.length > 8 && (
          <button className="px-2.5 pb-2 text-[11px] font-semibold text-[var(--accent)]" onClick={() => setAll((v) => !v)}>
            {all ? 'Show less' : `Show all ${card.rows.length}`}
          </button>
        )}
      </div>
    );
  }
  if (card.type === 'files') {
    return (
      <div className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-0)] p-2.5">
        <div className="mb-1 text-[11px] font-semibold text-[var(--text-muted)]">{card.title}{window.bidmanagerDesktop ? ' · also saved in Working Docs' : ''}</div>
        {(card.files || []).map((f) => (
          <button key={f.file_id} onClick={() => onOpenFile(f)} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-[12px] hover:bg-[var(--surface-1)]">
            {/\.xlsx?$/i.test(f.name) ? <FileSpreadsheet size={14} className="text-emerald-400" /> : <FileText size={14} className="text-[var(--accent)]" />}
            <span className="truncate">{f.name}</span>
            {f.folder && <span className="ml-auto shrink-0 text-[10px] text-[var(--text-muted)]">{f.folder}</span>}
          </button>
        ))}
        {card.attached?.length > 0 && (
          <div className="mt-1 text-[11px] text-[var(--text-muted)]">Also attached in Ready Docs: {card.attached.map((a) => a.row).join(', ')}</div>
        )}
      </div>
    );
  }
  const rows = all ? card.rows : card.rows.slice(0, 10);
  return (
    <div className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-0)] p-2.5">
      <div className="mb-1 text-[11px] font-semibold text-[var(--text-muted)]">Added to Ready Docs</div>
      {rows.map((r) => (
        <div key={r.id} className="flex items-start gap-2 py-0.5 text-[12px]">
          {r.file ? <CheckCircle2 size={13} className="mt-0.5 text-emerald-400" /> : <Clock size={13} className="mt-0.5 text-amber-400" />}
          <span className="flex-1">{r.name}{!r.added && <span className="text-[var(--text-muted)]"> · already in the list</span>}</span>
          <span className="shrink-0 text-[11px] text-[var(--text-muted)]">{r.file ? `Attached: ${r.file}` : 'Pending'}</span>
        </div>
      ))}
      {card.rows.length > 10 && (
        <button className="text-[11px] font-semibold text-[var(--accent)]" onClick={() => setAll((v) => !v)}>{all ? 'Show less' : `Show all ${card.rows.length}`}</button>
      )}
    </div>
  );
}
