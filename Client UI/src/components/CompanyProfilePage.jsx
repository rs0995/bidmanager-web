import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Lock, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { Spinner } from './ui/shared';

/* Company Profile: the bidder's master data on the server. The Bid Agent
   fills bidding forms from it and checks qualification criteria against it.
   Shared by everyone in an organisation; only org admins can edit. */

const SECTION_TITLES = {
  financials: 'Financials (one row per financial year)',
  experience: 'Work experience (completed and ongoing contracts)',
  works_in_hand: 'Works in hand (used for bid capacity)',
  personnel: 'Key personnel',
  equipment: 'Plant and equipment',
  certificates: 'Certificates (ISO etc.)',
  litigation: 'Litigation history',
};

export default function CompanyProfilePage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['company-profile'], queryFn: api.getCompanyProfile });
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState('general');
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (data?.profile) setProfile(JSON.parse(JSON.stringify(data.profile))); }, [data]);

  const save = useMutation({
    mutationFn: () => api.saveCompanyProfile(profile),
    onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000); qc.invalidateQueries({ queryKey: ['company-profile'] }); },
  });

  if (error) return <div className="p-6 text-sm text-rose-400">{error.message}</div>;
  if (isLoading || !profile || !data) return <div className="flex h-full items-center justify-center"><Spinner size={22} /></div>;
  const { schema } = data;
  const canEdit = Boolean(data.can_edit);
  const list = schema.lists.find((l) => l.section === tab);
  const rows = list ? (profile[list.section] || []) : [];
  const setRows = (nextRows) => setProfile((p) => ({ ...p, [list.section]: nextRows }));
  const setGeneral = (k, v) => setProfile((p) => ({ ...p, general: { ...p.general, [k]: v } }));

  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <h1 className="text-lg font-semibold">Company Profile</h1>
            <p className="text-xs text-[var(--text-muted)]">Entered once. The Bid Agent fills bidding forms from it and checks every tender's qualification criteria against it.</p>
          </div>
          {canEdit ? (
            <button className="btn-primary gap-1 text-xs" onClick={() => save.mutate()} disabled={save.isPending}>
              {saved ? <CheckCircle2 size={13} /> : <Save size={13} />}{save.isPending ? 'Saving…' : saved ? 'Saved' : 'Save profile'}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]"><Lock size={12} />Only your organisation's admins can edit this.</span>
          )}
        </div>
        {save.error && <div className="text-xs text-rose-400">{save.error.message}</div>}

        <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
          {[{ k: 'general', l: 'General' }, ...schema.lists.map((s) => ({ k: s.section, l: s.section.replace(/_/g, ' ') }))].map((t) => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={cn('rounded-t-md px-3 py-1.5 text-xs capitalize', tab === t.k ? 'bg-[var(--surface-2)] font-semibold' : 'text-[var(--text-muted)] hover:text-[var(--text)]')}>
              {t.l}{t.k !== 'general' && profile[t.k]?.length ? ` (${profile[t.k].length})` : ''}
            </button>
          ))}
        </div>

        {tab === 'general' ? (
          <div className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {schema.general.map((f) => (
              <label key={f.key} className="block">
                <span className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">{f.label}</span>
                <input className="input-field h-8 w-full text-xs" readOnly={!canEdit} value={profile.general?.[f.key] || ''} onChange={(e) => setGeneral(f.key, e.target.value)} />
              </label>
            ))}
          </div>
        ) : list ? (
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{SECTION_TITLES[list.section] || list.section}</h2>
              {canEdit && <button className="btn-secondary gap-1 text-xs h-8" onClick={() => setRows([...rows, {}])}><Plus size={12} />Add row</button>}
            </div>
            <div className="overflow-auto">
              <table className="data-table">
                <thead><tr>{list.columns.map((c) => <th key={c.key} title={c.label}>{c.label}</th>)}{canEdit && <th />}</tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={list.columns.length + 1} className="text-center text-xs text-[var(--text-muted)]">No rows yet.</td></tr>}
                  {rows.map((r, i) => (
                    <tr key={i}>
                      {list.columns.map((c) => (
                        <td key={c.key} className="p-1">
                          <input className="input-field h-7 w-full min-w-[110px] text-xs" readOnly={!canEdit} value={r[c.key] || ''}
                            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, [c.key]: e.target.value } : x)))} />
                        </td>
                      ))}
                      {canEdit && <td className="p-1"><button className="btn-ghost h-7 px-2" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={12} /></button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-[var(--text-muted)]">Amounts in INR crore. Dates as YYYY-MM-DD.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
