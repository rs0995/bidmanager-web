import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, CheckCircle2, ClipboardList, Download, FileSpreadsheet, FileText,
  FolderArchive, Pencil, Sparkles, X,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { Badge, Spinner } from './ui/shared';

/* Bid Agent panel (project workspace).
   The server prepares a "bid pack" from the tender's downloaded documents:
   section map, qualification criteria vs the company profile, and editable
   Word/Excel bid forms. Routes: Server UI/server/API_CHANGES.md §5. */

const statusVariant = (s) => (s === 'Meets' ? 'success' : s === 'Shortfall' ? 'danger' : s === 'Manual check' ? 'muted' : 'warning');

export default function BidAgentPanel({ project, onClose }) {
  const qc = useQueryClient();
  const desktop = typeof window !== 'undefined' ? window.bidmanagerDesktop : null;
  const tenderId = String(project?.source_tender_id || '').trim();
  const [tab, setTab] = useState('overview');
  const [pack, setPack] = useState(null);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(null);
  const [busyFile, setBusyFile] = useState('');
  const next = useRef(0);

  const { data: tenderDbId, isLoading: resolving } = useQuery({
    queryKey: ['bid-pack-tender', tenderId],
    queryFn: () => api.resolveTenderRowId({ tender_id: tenderId }),
    enabled: Boolean(tenderId),
  });
  const { data: status } = useQuery({ queryKey: ['bid-agent-status'], queryFn: api.getBidAgentStatus, staleTime: 60000 });

  const running = pack?.status === 'running';

  // Load once, then poll while the server is preparing.
  useEffect(() => {
    if (!tenderDbId) return undefined;
    let stop = false;
    let timer = null;
    next.current = 0;
    setLogs([]);
    const tick = async () => {
      try {
        const r = await api.getBidPack(tenderDbId, next.current);
        if (stop) return;
        next.current = r.next || 0;
        if (r.logs?.length) setLogs((prev) => [...prev, ...r.logs].slice(-300));
        setPack(r);
        if (r.status === 'running') timer = setTimeout(tick, 1500);
        else if (r.status === 'failed') setError(r.error || 'Preparation failed.');
      } catch (e) {
        if (!stop) setError(e?.message || String(e));
      }
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [tenderDbId, pack?.status === 'running' ? 'running' : 'idle']);

  const start = async (fn) => {
    setError(''); setNotice(''); setLogs([]); next.current = 0;
    try {
      const r = await fn();
      setPack(r);
    } catch (e) {
      setError(e?.detail?.message || e?.message || String(e));
    }
  };

  const result = pack?.result || null;
  const files = pack?.files || [];
  const formFile = (code) => files.find((f) => f.kind === 'form' && f.code === code);

  const download = async (name) => {
    setBusyFile(name); setError('');
    try {
      const { path } = await api.downloadBidPackFile(tenderDbId, name, tenderId);
      if (path && desktop?.openPath) await desktop.openPath(path);
      else if (path) setNotice(`Saved to ${path}`);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusyFile('');
    }
  };

  const addChecklist = async () => {
    setError('');
    try {
      const r = await api.addBidFormsToChecklist(project.id, result);
      setNotice(`${r.added} item(s) added to the checklist under "Bid Forms".`);
      qc.invalidateQueries({ queryKey: ['project-checklist', project.id] });
    } catch (e) { setError(e?.message || String(e)); }
  };

  const counts = useMemo(() => {
    const c = {};
    for (const r of result?.compliance || []) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [result]);

  return (
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
      <div className="flex w-full max-w-6xl flex-col overflow-hidden border border-[var(--border)] bg-[var(--surface-0)] shadow-2xl sm:rounded-xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3">
          <Sparkles size={16} className="text-[var(--accent)]" />
          <h3 className="text-sm font-semibold">Bid Agent</h3>
          {result?.tender?.reference && <Badge variant="muted">{result.tender.reference}</Badge>}
          {result?.org_name && <Badge variant="info">{result.org_name}</Badge>}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button className="btn-primary gap-1 text-xs h-8" disabled={!tenderDbId || running} onClick={() => start(() => api.startBidPack(tenderDbId))}>
              {running ? <Spinner size={12} /> : <Sparkles size={12} />}{result ? 'Prepare again' : 'Prepare bid pack'}
            </button>
            {result && (
              <>
                <button className="btn-secondary gap-1 text-xs h-8" disabled={running} onClick={addChecklist}><ClipboardList size={12} />Add to checklist</button>
                <button className="btn-secondary gap-1 text-xs h-8" disabled={Boolean(busyFile)} onClick={() => download('Bid Forms.zip')}>
                  {busyFile === 'Bid Forms.zip' ? <Spinner size={12} /> : <FolderArchive size={12} />}All files (.zip)
                </button>
              </>
            )}
            <button onClick={onClose} className="ml-1 text-[var(--text-muted)] hover:text-[var(--text)]"><X size={16} /></button>
          </div>
        </div>

        {status && !status.ai_enabled && (
          <div className="flex items-center gap-2 border-b border-[var(--border)] bg-amber-500/10 px-4 py-2 text-xs text-amber-500">
            <AlertCircle size={13} />AI reading is off on the server, so results use keyword and table matching. Check them against the tender.
          </div>
        )}
        {error && <div className="border-b border-[var(--border)] bg-rose-500/10 px-4 py-2 text-xs text-rose-400">{error}</div>}
        {notice && <div className="border-b border-[var(--border)] bg-emerald-500/10 px-4 py-2 text-xs text-emerald-400">{notice}</div>}
        {running && (
          <div className="max-h-40 overflow-auto border-b border-[var(--border)] bg-[var(--surface-1)] px-4 py-2 font-mono text-[11px] text-[var(--text-muted)]">
            {logs.length ? logs.map((l, i) => <div key={i}>{l}</div>) : 'Starting…'}
          </div>
        )}

        {result && (
          <div className="flex gap-1 border-b border-[var(--border)] px-4 pt-2">
            {[
              ['overview', 'Sections'],
              ['compliance', `Compliance${counts.Shortfall ? ` (${counts.Shortfall} gaps)` : ''}`],
              ['criteria', `Criteria (${result.criteria?.criteria?.length || 0})`],
              ['forms', `Forms (${result.forms?.length || 0})`],
            ].map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={cn('rounded-t-md px-3 py-1.5 text-xs', tab === k ? 'bg-[var(--surface-2)] font-semibold text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]')}>
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {!tenderId ? (
            <Empty>This project isn't linked to a tender. Add the Tender ID in the project details first.</Empty>
          ) : resolving || !pack ? (
            <div className="flex justify-center py-16"><Spinner size={20} /></div>
          ) : !tenderDbId ? (
            <Empty>This tender is no longer on the server.</Empty>
          ) : !result ? (
            <Empty>
              <p className="mb-2 text-[var(--text)]">The Bid Agent reads this tender's downloaded documents on the server.</p>
              <p>It finds the instructions, data sheet, qualification criteria and bidding forms (whatever the employer calls them), checks the criteria against your Company Profile, and prepares editable Word forms and an Excel workbook.</p>
              <p className="mt-2 text-[11px]">Download the tender documents first if you haven't.</p>
            </Empty>
          ) : tab === 'overview' ? (
            <Overview result={result} onEdit={setEditing} />
          ) : tab === 'compliance' ? (
            <ComplianceTable rows={result.compliance || []} />
          ) : tab === 'criteria' ? (
            <CriteriaView criteria={result.criteria} />
          ) : (
            <FormsView result={result} files={files} formFile={formFile} busyFile={busyFile} onDownload={download} />
          )}
        </div>

        {result && (
          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] px-4 py-2 text-[11px] text-[var(--text-muted)]">
            {pack.updated_at && <span>Prepared {new Date(pack.updated_at * 1000).toLocaleString()}</span>}
            <span>{result.llm?.used ? 'AI reading on' : 'AI reading off'}</span>
            <span>Forms fill from your Company Profile each time you download them.</span>
          </div>
        )}
      </div>

      {editing && status?.roles && (
        <SegmentEditor
          doc={editing}
          roles={status.roles}
          onClose={() => setEditing(null)}
          onSave={(segments) => {
            const file = editing.file;
            setEditing(null);
            start(() => api.correctBidPackSections(tenderDbId, file, segments));
          }}
        />
      )}
    </div>
  );
}

function Empty({ children }) {
  return <div className="mx-auto max-w-xl py-12 text-center text-sm text-[var(--text-muted)]">{children}</div>;
}

function SectionHeading({ children }) {
  return <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{children}</h4>;
}

function Overview({ result, onEdit }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {(result.key_sections || []).map((k) => (
          <div key={k.role} className={cn('rounded-lg border p-3', k.found ? 'border-[var(--border)]' : 'border-dashed border-amber-500/40')}>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
              {k.found ? <CheckCircle2 size={12} className="text-emerald-400" /> : <AlertCircle size={12} className="text-amber-400" />}
              {k.label}
            </div>
            {k.found ? k.locations.map((l, i) => (
              <div key={i} className="truncate text-[11px] text-[var(--text-muted)]" title={l.file}>{l.file} · p{l.start_page}-{l.end_page}</div>
            )) : <div className="text-[11px] text-[var(--text-muted)]">Not found</div>}
          </div>
        ))}
      </div>
      <div>
        <SectionHeading>Documents</SectionHeading>
        <table className="data-table">
          <thead><tr><th>File</th><th>Pages</th><th>Sections</th><th></th></tr></thead>
          <tbody>
            {(result.documents || []).map((d) => (
              <tr key={d.file}>
                <td className="max-w-[360px] truncate" title={d.file}>{d.file}{d.needs_ocr && <Badge variant="warning" className="ml-1">scanned</Badge>}</td>
                <td>{d.pages}</td>
                <td>
                  {d.error ? <span className="text-rose-400">{d.error}</span> : (d.segments || []).map((s, i) => (
                    <span key={i} className="mr-1 inline-block"><Badge variant={s.role === 'other' ? 'muted' : 'default'}>{s.label} p{s.start_page}-{s.end_page}</Badge></span>
                  ))}
                </td>
                <td>{!d.error && <button className="btn-ghost h-7 gap-1 px-2 text-[11px]" onClick={() => onEdit(d)}><Pencil size={11} />Correct</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">Corrections are remembered for this employer's next tenders.</p>
      </div>
    </div>
  );
}

function ComplianceTable({ rows }) {
  if (!rows.length) return <p className="text-sm text-[var(--text-muted)]">No criteria were found.</p>;
  return (
    <table className="data-table">
      <thead><tr><th>Ref</th><th>Criterion</th><th>Required</th><th>Ours</th><th>Result</th><th>Evidence</th><th>Remarks</th></tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.ref}</td>
            <td className="max-w-[260px]" title={r.requirement}>{r.subject || String(r.requirement || '').slice(0, 80)}</td>
            <td>{r.required}</td>
            <td>{r.actual}</td>
            <td><Badge variant={statusVariant(r.status)}>{r.status}</Badge></td>
            <td className="text-[11px]">{(r.forms || []).join(', ')}</td>
            <td className="max-w-[280px] text-[11px] text-[var(--text-muted)]">{r.remarks}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CriteriaView({ criteria }) {
  const c = criteria || {};
  return (
    <div className="space-y-5">
      {c.notes?.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-[var(--text-muted)]">{c.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      {c.similar_work_definition && <p className="text-xs"><b>Similar work:</b> {c.similar_work_definition}</p>}
      <table className="data-table">
        <thead><tr><th>Ref</th><th>Subject</th><th>Requirement</th><th>Single</th><th>JV all</th><th>JV each</th><th>JV one</th><th>Forms</th><th>p.</th></tr></thead>
        <tbody>
          {(c.criteria || []).map((r, i) => (
            <tr key={i}>
              <td>{r.ref}</td><td className="max-w-[160px]">{r.subject}</td>
              <td className="max-w-[420px] whitespace-pre-wrap text-[11px]">{r.requirement}</td>
              <td className="text-[11px]">{r.single_entity}</td><td className="text-[11px]">{r.jv_all_parties}</td>
              <td className="text-[11px]">{r.jv_each_member}</td><td className="text-[11px]">{r.jv_one_member}</td>
              <td className="text-[11px]">{(r.forms || []).join(', ')}</td><td>{r.page}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {c.personnel?.length > 0 && (
        <div>
          <SectionHeading>Key personnel</SectionHeading>
          <table className="data-table">
            <thead><tr><th>Position</th><th>No.</th><th>Qualification</th><th>Experience</th></tr></thead>
            <tbody>{c.personnel.map((p, i) => <tr key={i}><td>{p.position}</td><td>{p.count}</td><td className="text-[11px]">{p.qualification}</td><td className="text-[11px]">{p.experience}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {c.equipment?.length > 0 && (
        <div>
          <SectionHeading>Key equipment</SectionHeading>
          <table className="data-table">
            <thead><tr><th>Equipment</th><th>Min. units</th><th>Max age (yrs)</th></tr></thead>
            <tbody>{c.equipment.map((e, i) => <tr key={i}><td>{e.type}</td><td>{e.min_units}</td><td>{e.max_age_years}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FormsView({ result, files, formFile, busyFile, onDownload }) {
  const wb = files.find((f) => f.kind === 'workbook');
  const btn = (name, icon, label) => (
    <button className="btn-ghost h-7 gap-1 px-2 text-[11px]" disabled={Boolean(busyFile)} onClick={() => onDownload(name)}>
      {busyFile === name ? <Spinner size={11} /> : icon}{label}
    </button>
  );
  return (
    <div className="space-y-4">
      {wb && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] p-3 text-xs">
          <FileSpreadsheet size={16} className="text-emerald-400" />
          <span className="flex-1">Bid Forms Workbook: index, compliance, criteria, personnel, equipment and every table form</span>
          {btn(wb.name, <Download size={11} />, 'Open')}
        </div>
      )}
      {result.missing_forms?.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          <b>Named in the criteria but not found in the tender files:</b> {result.missing_forms.join(', ')}
          <div className="mt-1 text-[var(--text-muted)]">Usually the forms volume hasn't been downloaded, or it's a scan. Download it and prepare again.</div>
        </div>
      )}
      <table className="data-table">
        <thead><tr><th>#</th><th>Form</th><th>Title</th><th>From</th><th>Template</th><th></th></tr></thead>
        <tbody>
          {(result.forms || []).map((f, i) => {
            const file = formFile(f.code);
            return (
              <tr key={i}>
                <td>{i + 1}</td><td className="font-medium">{f.code}</td><td>{f.title}</td>
                <td className="text-[11px] text-[var(--text-muted)]">{f.file} p{f.start_page}-{f.end_page}</td>
                <td><Badge variant={f.source === 'heuristic' ? 'warning' : f.source === 'library' ? 'info' : 'success'}>{f.source === 'library' ? 'reused' : f.source === 'heuristic' ? 'layout' : 'AI'}</Badge></td>
                <td>{file && btn(file.name, <FileText size={11} />, 'Word')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SegmentEditor({ doc, roles, onClose, onSave }) {
  const [segs, setSegs] = useState((doc.segments || []).map((s) => ({ role: s.role, start_page: s.start_page, end_page: s.end_page })));
  const update = (i, patch) => setSegs((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--surface-0)] p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="truncate text-sm font-semibold" title={doc.file}>Sections in {doc.file}</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={16} /></button>
        </div>
        <div className="space-y-2">
          {segs.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <select className="input-field h-8 flex-1 text-xs" value={s.role} onChange={(e) => update(i, { role: e.target.value })}>
                {roles.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
              </select>
              <input type="number" min={1} max={doc.pages} className="input-field h-8 w-16 text-xs" value={s.start_page} onChange={(e) => update(i, { start_page: Number(e.target.value) })} />
              <span className="text-xs">-</span>
              <input type="number" min={1} max={doc.pages} className="input-field h-8 w-16 text-xs" value={s.end_page} onChange={(e) => update(i, { end_page: Number(e.target.value) })} />
              <button className="btn-ghost h-8 px-2 text-xs" onClick={() => setSegs((prev) => prev.filter((_, j) => j !== i))} disabled={segs.length <= 1}><X size={12} /></button>
            </div>
          ))}
          <button className="btn-ghost h-8 text-xs" onClick={() => setSegs((prev) => [...prev, { role: 'other', start_page: 1, end_page: doc.pages }])}>+ Add page range</button>
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-[var(--border)] pt-3">
          <button onClick={onClose} className="btn-ghost text-xs">Cancel</button>
          <button onClick={() => onSave(segs)} className="btn-primary text-xs">Save and prepare again</button>
        </div>
      </div>
    </div>
  );
}
