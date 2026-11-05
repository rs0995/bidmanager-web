import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUp, Check, CheckCircle2, Clock, Copy, FileSpreadsheet, FileText, MessageSquare,
  RotateCcw, Sparkles, X,
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
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [messages, setMessages] = useState([]);
  const [state, setState] = useState({ status: 'idle', progress: '', suggestions: [], ai_enabled: true });
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const lastId = useRef(0);


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

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages.length, state.status, open]);

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
  const last = [...messages].reverse().find((m) => m.role === 'assistant');
  return (
    <>
      {/* One line above the checklist; the chat itself opens in a window. */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-0)] px-5 py-2">
        <Sparkles size={14} className="shrink-0 text-[var(--accent)]" />
        <span className="shrink-0 text-sm font-semibold">Bid Agent</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-muted)]">
          {busy ? (state.progress || 'Working…') : last ? last.text : state.ai_enabled ? 'Ask for the prequal, tender forms or the documents checklist' : 'Basic mode: AI reading is off on the server'}
        </span>
        {busy && <Spinner size={12} className="text-[var(--accent)]" />}
        <button className="btn-primary h-7 gap-1 px-3 text-xs" onClick={() => setOpen(true)}>
          <MessageSquare size={12} />{messages.length ? 'Open chat' : 'Ask the agent'}
        </button>
      </div>
      {open && (
        <ChatWindow onClose={() => setOpen(false)} title={project?.title || tenderId} busy={busy} progress={state.progress}
          aiEnabled={state.ai_enabled} onClear={messages.length && !busy ? clear : null}>
          {resolving ? <div className="p-4"><Spinner size={14} /></div> : !tenderDbId ? (
            <p className="p-4 text-xs text-[var(--text-muted)]">This tender is no longer on the server.</p>
          ) : (
            <>
              <div ref={listRef} className="min-h-0 flex-1 cursor-text select-text space-y-2 overflow-auto p-3">
                {messages.length === 0 && (
                  <p className="py-6 text-center text-xs text-[var(--text-muted)]">
                    Ask in your own words, e.g. “fetch the qualification criteria”, “the criteria are on pages 12–14”, “save the prequal as PDF”, “extract form FIN-3.2”, “prepare the checklist”.
                  </p>
                )}
                {messages.map((m) => <Message key={m.id} m={m} onOpenFile={openFile} />)}
                {busy && (
                  <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]"><Spinner size={11} />{state.progress || 'Working…'}</div>
                )}
              </div>
              <div className="border-t border-[var(--border)] p-3">
                {error && <div className="mb-2 text-xs text-rose-400">{error}</div>}
                {!busy && chips.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {chips.map((s) => (
                      <button key={s} onClick={() => send(s)} className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--text)]">{s}</button>
                    ))}
                  </div>
                )}
                <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
                  <textarea value={text} onChange={(e) => setText(e.target.value)} disabled={busy} rows={2}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }}
                    placeholder="Ask the Bid Agent… (Enter to send, Shift+Enter for a new line)"
                    className="input-field min-h-[38px] flex-1 resize-none py-2 text-sm" />
                  <button type="submit" disabled={busy || !text.trim()} className="btn-primary h-9 w-9 justify-center p-0" title="Send">
                    {busy ? <Spinner size={13} /> : <ArrowUp size={15} />}
                  </button>
                </form>
              </div>
            </>
          )}
        </ChatWindow>
      )}
    </>
  );
}

const WINDOW_KEY = 'bm.bidAgent.window';

/* A floating window inside the tab: drag it by its title bar, resize it from
   the corner. Its size and position are remembered. */
function ChatWindow({ title, busy, progress, aiEnabled, onClose, onClear, children }) {
  const [box, setBox] = useState(() => {
    const w = Math.min(720, window.innerWidth - 40);
    const h = Math.min(Math.round(window.innerHeight * 0.75), window.innerHeight - 40);
    const fallback = { x: window.innerWidth - w - 24, y: 64, w, h };
    try {
      const saved = JSON.parse(localStorage.getItem(WINDOW_KEY) || 'null');
      if (saved && saved.w > 300 && saved.h > 240) {
        return {
          w: Math.min(saved.w, window.innerWidth - 20), h: Math.min(saved.h, window.innerHeight - 20),
          x: Math.max(0, Math.min(saved.x, window.innerWidth - 200)), y: Math.max(0, Math.min(saved.y, window.innerHeight - 80)),
        };
      }
    } catch { /* ignore */ }
    return fallback;
  });
  const ref = useRef(null);
  useEffect(() => { try { localStorage.setItem(WINDOW_KEY, JSON.stringify(box)); } catch { /* ignore */ } }, [box]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // CSS resize handle -> remember the new size.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox((b) => (Math.abs(b.w - r.width) > 2 || Math.abs(b.h - r.height) > 2 ? { ...b, w: Math.round(r.width), h: Math.round(r.height) } : b));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const startDrag = (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const sx = e.clientX; const sy = e.clientY; const { x, y } = box;
    const move = (ev) => setBox((b) => ({
      ...b,
      x: Math.max(0, Math.min(window.innerWidth - 120, x + ev.clientX - sx)),
      y: Math.max(0, Math.min(window.innerHeight - 40, y + ev.clientY - sy)),
    }));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return (
    <div ref={ref} role="dialog" aria-label="Bid Agent chat"
      className="fixed z-[75] flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-0)] shadow-2xl"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, resize: 'both', minWidth: 360, minHeight: 280, maxWidth: '100vw', maxHeight: '100vh' }}>
      <div onMouseDown={startDrag} className="flex cursor-move select-none items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <Sparkles size={14} className="text-[var(--accent)]" />
        <span className="text-sm font-semibold">Bid Agent</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-muted)]">
          {busy ? (progress || 'Working…') : aiEnabled ? title : 'Basic mode: AI reading is off on the server'}
        </span>
        {onClear && <button title="Clear the conversation" onClick={onClear} className="text-[var(--text-muted)] hover:text-[var(--text)]"><RotateCcw size={13} /></button>}
        <button title="Close (Esc)" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={15} /></button>
      </div>
      {children}
    </div>
  );
}

function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    setDone(true); setTimeout(() => setDone(false), 1500);
  };
  return (
    <button onClick={copy} title={label} className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text)]">
      {done ? <Check size={11} /> : <Copy size={11} />}{done ? 'Copied' : label}
    </button>
  );
}

const tableText = (card) => [card.columns, ...card.rows].map((r) => r.map((v) => String(v ?? '').replace(/\s+/g, ' ')).join('\t')).join('\n');

function Message({ m, onOpenFile }) {
  const mine = m.role === 'user';
  return (
    <div className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
      {m.text && (
        <div className={cn('max-w-[85%] select-text whitespace-pre-wrap rounded-xl px-3 py-1.5 text-[13px]',
          mine ? 'bg-[var(--accent)] text-white' : m.error ? 'bg-rose-500/10 text-rose-400' : 'bg-[var(--surface-2)] text-[var(--text)]')}>
          {m.text}
        </div>
      )}
      {!mine && m.text && <div className="mt-0.5 px-1"><CopyButton text={m.text} /></div>}
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
        <div className="flex items-center gap-2 px-2.5 pt-2 text-[11px] font-semibold text-[var(--text-muted)]">
          <span className="flex-1">{card.title}</span>
          <CopyButton text={tableText(card)} label="Copy table" />
        </div>
        <table className="data-table select-text text-[11px]">
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
