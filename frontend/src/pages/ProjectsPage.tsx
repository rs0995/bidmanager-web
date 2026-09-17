import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Plus,
  Eye,
  EyeOff,
  Edit3,
  Copy,
  ExternalLink,
  Trash2,
  FolderOpen,
  X,
  Save,
  CheckSquare,
  Square,
  ChevronRight,
  LayoutGrid,
  List,
  Clock,
  Building2,
  IndianRupee,
  CalendarClock,
  ArchiveRestore,
  SlidersHorizontal,
} from 'lucide-react';
import { api, type ChecklistItem, type Project } from '../lib/api';
import { cn, formatINR } from '../lib/utils';
import { TimeBadge, EmptyState, Spinner, Badge } from '../components/ui/shared';
import { useAppStore } from '../lib/store';

type ProjectColumn = { key: string; label: string; width: number; fixed?: boolean };
type ViewMode = 'table' | 'cards';

function sanitizeFolderLeaf(value: string, fallback = 'Project') {
  const txt = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  return txt || fallback;
}

const PROJECT_COLUMNS: ProjectColumn[] = [
  { key: '_sr', label: '#', width: 56, fixed: true },
  { key: 'source_tender_id', label: 'Tender ID', width: 160 },
  { key: 'title', label: 'Name of Work', width: 320 },
  { key: 'client_name', label: 'Client', width: 220 },
  { key: 'project_value', label: 'Value', width: 140 },
  { key: 'prebid', label: 'Prebid', width: 170 },
  { key: 'deadline', label: 'Deadline', width: 170 },
  { key: '_time_left', label: 'Time Left', width: 120 },
  { key: 'status', label: 'Status', width: 110 },
];

// ─── Stats Bar ────────────────────────────────────────────────────────────────
function StatsBar({ projects }: { projects: Project[] }) {
  const total = projects.length;
  const active = projects.filter(p => p.status === 'Active').length;
  const totalValue = projects.reduce((sum, p) => {
    const n = parseFloat(String(p.project_value || '').replace(/[₹,\s]/g, ''));
    return sum + (isNaN(n) ? 0 : n);
  }, 0);
  const fmt = (n: number) => n >= 1e7 ? `₹${(n / 1e7).toFixed(1)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : `₹${n.toLocaleString('en-IN')}`;

  return (
    <div className="flex items-center gap-5 px-6 py-2 border-b border-[var(--border)] bg-[var(--surface-0)]">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-[var(--text-muted)]">Total</span>
        <span className="text-sm font-semibold text-[var(--text)]">{total}</span>
      </div>
      <div className="h-3 w-px bg-[var(--border)]" />
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        <span className="text-xs text-[var(--text-muted)]">Active</span>
        <span className="text-sm font-semibold text-emerald-500">{active}</span>
      </div>
      {totalValue > 0 && <>
        <div className="h-3 w-px bg-[var(--border)]" />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-[var(--text-muted)]">Portfolio</span>
          <span className="text-sm font-semibold font-mono text-[var(--text)]">{fmt(totalValue)}</span>
        </div>
      </>}
    </div>
  );
}

// ─── Project Card ─────────────────────────────────────────────────────────────
function ProjectCard({ project, isSelected, isFocused, onClick, onDoubleClick }: {
  project: Project; isSelected: boolean; isFocused: boolean;
  onClick: (e: React.MouseEvent) => void; onDoubleClick: () => void;
}) {
  return (
    <div
      onClick={onClick} onDoubleClick={onDoubleClick}
      className={cn(
        'group relative flex flex-col gap-3 rounded-xl border p-4 cursor-pointer transition-all duration-150',
        'bg-[var(--surface-0)] hover:bg-[var(--surface-1)]',
        isSelected ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/20 bg-[var(--accent-bg)]'
          : 'border-[var(--border)] hover:border-[var(--accent)]/40',
        isFocused && !isSelected && 'ring-1 ring-[var(--accent)]/30'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-mono text-[var(--accent)] mb-1 truncate">{project.source_tender_id || '—'}</p>
          <p className="text-sm font-semibold text-[var(--text)] line-clamp-2 leading-snug">{project.title || 'Untitled'}</p>
        </div>
        <Badge variant={project.status === 'Active' ? 'success' : 'muted'} className="shrink-0 text-[10px]">
          {project.status || 'Active'}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <Building2 size={11} className="shrink-0 text-[var(--accent)]/60" />
          <span className="truncate">{project.client_name || '—'}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <IndianRupee size={11} className="shrink-0 text-emerald-500/70" />
          <span className="truncate font-mono">{formatINR(project.project_value) || '—'}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <CalendarClock size={11} className="shrink-0 text-amber-500/70" />
          <span className="truncate">{project.prebid || '—'}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <Clock size={11} className="shrink-0 text-rose-400/70" />
          <TimeBadge dateStr={project.deadline} />
        </div>
      </div>
      <div className={cn('absolute right-3 bottom-3 opacity-0 group-hover:opacity-100 transition-opacity', isSelected && 'opacity-60')}>
        <ExternalLink size={12} className="text-[var(--accent)]" />
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ProjectsPage({
  onOpenProjectWorkspace, archived = false,
}: {
  onOpenProjectWorkspace?: (projectId: number) => void; archived?: boolean;
}) {
  const qc = useQueryClient();
  const projectStatus = archived ? 'Archived' : 'Active';
  const { projectsTable, setProjectsHiddenColumns, setProjectsColumnOrder, setProjectsColumnWidth } = useAppStore();

  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [selId, setSelId] = useState<number | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([]);
  const [projectFocusId, setProjectFocusId] = useState<number | null>(null);
  const [lastProjectClickedId, setLastProjectClickedId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [formEditable, setFormEditable] = useState(true);
  const [showColsMenu, setShowColsMenu] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [form, setForm] = useState({ title: '', client_name: '', source_tender_id: '', project_value: '', prebid: '', deadline: '', description: '', status: projectStatus });
  const [newChecklistItem, setNewChecklistItem] = useState({ req_file_name: '', description: '', subfolder: 'Main' });
  const [confirmDelIds, setConfirmDelIds] = useState<number[]>([]);

  const desktop = (window as any).bidmanagerDesktop as {
    openPath?: (p: string) => Promise<{ ok: boolean; canceled?: boolean; message?: string }>;
    ensureProjectFolders?: (p: string) => Promise<{ ok: boolean; path?: string; message?: string }>;
    pathExists?: (p: string) => Promise<{ ok: boolean; exists?: boolean; isDir?: boolean; resolved?: string; message?: string }>;
  } | undefined;

  const { data: projects, isLoading } = useQuery({ queryKey: ['projects', projectStatus, search], queryFn: () => api.listProjects(search, projectStatus) });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const projectsEntryMode = String(settings?.projects_entry_mode || 'inline').toLowerCase() === 'popup' ? 'popup' : 'inline';
  const selectedProject = useMemo(() => (projects || []).find((p) => p.id === selId) || null, [projects, selId]);
  const { data: checklist, isLoading: checklistLoading } = useQuery({ queryKey: ['project-checklist', selId], queryFn: () => api.listChecklist(selId as number), enabled: !!selId && showDetails });
  const { data: allTenders } = useQuery({
    queryKey: ['all-tenders-for-autofill'],
    queryFn: async () => { const ws = await api.listWebsites(); const results = await Promise.all(ws.flatMap((w) => [api.listTenders(w.id, { archived: false, limit: 5000 }), api.listTenders(w.id, { archived: true, limit: 5000 })])); return results.flat(); },
    staleTime: 60000, enabled: !archived,
  });

  const createProject = useMutation({ mutationFn: (d: typeof form) => api.createProject(d as any), onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); resetForm(); } });
  const updateProject = useMutation({ mutationFn: ({ id, data }: { id: number; data: Partial<Project> }) => api.updateProject(id, data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); resetForm(); } });
  const deleteProject = useMutation({
    mutationFn: async (ids: number[]) => {
      const uniqueIds = Array.from(new Set(ids.map(Number).filter(x => Number.isFinite(x) && x > 0)));
      if (!uniqueIds.length) return { ok: true };
      if (archived) await Promise.all(uniqueIds.map(id => api.deleteProject(id)));
      else await Promise.all(uniqueIds.map(id => api.archiveProject(id)));
      return { ok: true };
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'], refetchType: 'all' }); qc.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'all' }); setSelId(null); setSelectedProjectIds([]); setProjectFocusId(null); setLastProjectClickedId(null); setConfirmDelIds([]); },
    onError: (err: any) => alert(`${archived ? 'Delete' : 'Archive'} failed: ${err?.message || String(err)}`),
  });
  const restoreProjects = useMutation({
    mutationFn: () => api.restoreProjectsFromFolders(),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ['projects'], refetchType: 'all' }); qc.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'all' }); alert(`Restore complete\nScanned: ${res.scanned_folders}\nCreated: ${res.created_projects}\nUpdated: ${res.updated_projects}\nChecklist restored: ${res.restored_checklist_items}`); },
    onError: (err: any) => alert(`Restore failed: ${err?.message || String(err)}`),
  });
  const createChecklistItem = useMutation({ mutationFn: (p: { projectId: number; req_file_name: string; description: string; subfolder: string }) => api.createChecklistItem(p.projectId, { req_file_name: p.req_file_name, description: p.description, subfolder: p.subfolder, status: 'Pending' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['project-checklist', selId] }); setNewChecklistItem({ req_file_name: '', description: '', subfolder: 'Main' }); } });
  const updateChecklistItem = useMutation({ mutationFn: ({ itemId, data }: { itemId: number; data: Partial<ChecklistItem> }) => api.updateChecklistItem(itemId, data as any), onSuccess: () => qc.invalidateQueries({ queryKey: ['project-checklist', selId] }) });
  const deleteChecklistItem = useMutation({ mutationFn: (itemId: number) => api.deleteChecklistItem(itemId), onSuccess: () => qc.invalidateQueries({ queryKey: ['project-checklist', selId] }) });

  const resetForm = () => { setForm({ title: '', client_name: '', source_tender_id: '', project_value: '', prebid: '', deadline: '', description: '', status: projectStatus }); setShowForm(false); setEditMode(false); setFormEditable(true); };
  const loadIntoForm = (p: Project) => { setForm({ title: p.title || '', client_name: p.client_name || '', source_tender_id: p.source_tender_id || '', project_value: p.project_value || '', prebid: p.prebid || '', deadline: p.deadline || '', description: p.description || '', status: p.status || 'Active' }); setSelId(p.id); setSelectedProjectIds([p.id]); setProjectFocusId(p.id); setLastProjectClickedId(p.id); setEditMode(true); setFormEditable(false); setShowForm(true); };
  const handleSubmit = () => { if (!form.title.trim()) return; if (editMode && selId) updateProject.mutate({ id: selId, data: form as any }); else createProject.mutate(form); };
  const uf = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));
  const canEditForm = !editMode || formEditable;
  const copyText = async (v: string) => { try { await navigator.clipboard.writeText(String(v || '')); } catch { /* silent */ } };

  const handleFetch = () => {
    if (archived) return;
    const tid = form.source_tender_id.trim().toLowerCase();
    if (!tid || !allTenders) return;
    const match = allTenders.find(t => (t.tender_id || '').toLowerCase() === tid) || allTenders.find(t => (t.tender_id || '').toLowerCase().includes(tid));
    if (!match) return;
    setForm(f => ({ ...f, title: f.title || match.title || '', client_name: f.client_name || match.org_chain || '', project_value: f.project_value || match.tender_value || '', prebid: f.prebid || match.pre_bid_meeting_date || '', deadline: f.deadline || match.closing_date || '', description: f.description || match.work_description || match.title || '' }));
  };

  const openSelectedProjectFolder = async () => {
    if (!desktop?.openPath) { alert('Open Folder is available in Electron desktop mode.'); return; }
    let rootFolder = '';
    try { const root = await api.getProjectsRootFolder(archived); rootFolder = String(root?.root_folder || '').trim(); } catch { /* compat */ }
    const rootCandidates = archived ? [rootFolder, 'backend/Archived Projects', 'Archived Projects'].filter(Boolean) : [rootFolder, 'backend/My_Tender_Projects', 'My_Tender_Projects'].filter(Boolean);
    if (archived) { try { const ar = await api.getProjectsRootFolder(false); const arp = String(ar?.root_folder || '').trim(); if (arp) { const p = arp.replace(/\\/g, '/').replace(/\/+$/, '').split('/').slice(0, -1).join('/'); if (p) rootCandidates.push(`${p}/Archived Projects`); } } catch { /* ignore */ } }
    const pc: string[] = []; let sti = ''; let st = '';
    if (selId) {
      let lp: Project | null = null;
      try { await api.ensureProjectFolder(selId); } catch { /* continue */ }
      try { lp = await api.getProject(selId); } catch { lp = null; }
      const cp = lp || selectedProject;
      const df = String(cp?.folder_path || '').trim(); if (df) pc.push(df);
      sti = String(cp?.source_tender_id || '').trim(); st = String(cp?.title || '').trim();
      for (const root of rootCandidates) { if (sti) pc.push(`${root}/${sanitizeFolderLeaf(sti, 'Project')}`); if (st) pc.push(`${root}/${sanitizeFolderLeaf(st, 'Project')}`); }
    }
    if (selId && desktop?.ensureProjectFolders) {
      const br = rootCandidates[0] || (archived ? 'backend/Archived Projects' : 'backend/My_Tender_Projects');
      const leaf = sanitizeFolderLeaf(sti || st || `Project_${selId}`, `Project_${selId}`);
      try { const mk = await desktop.ensureProjectFolders(`${br}${br.endsWith('\\') || br.endsWith('/') ? '' : '/'}${leaf}`); if (mk?.ok && mk.path) { pc.unshift(String(mk.path).trim()); try { await api.updateProject(selId, { folder_path: String(mk.path).trim() }); } catch { /* ignore */ } } } catch { /* ignore */ }
    }
    const ordered = Array.from(new Set((selId ? pc : rootCandidates).map(x => String(x || '').trim()).filter(Boolean)));
    if (!ordered.length) { alert('Projects root folder is not available.'); return; }
    let msg = '';
    for (const c of ordered) { const r = await desktop.openPath(c); if (r?.ok) return; msg = String(r?.message || ''); }
    alert(msg ? `Open folder failed: ${msg}` : 'Open folder failed.');
  };

  const openProjectWorkspace = async (project: Project) => {
    const pid = Number(project.id);
    if (!Number.isFinite(pid) || pid <= 0) return;
    if (onOpenProjectWorkspace) { onOpenProjectWorkspace(pid); return; }
    window.open(`${window.location.origin}${window.location.pathname}?projectId=${pid}`, '_blank', 'noopener,noreferrer');
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return projects || [];
    const q = search.toLowerCase();
    return (projects || []).filter(p => (p.title || '').toLowerCase().includes(q) || (p.client_name || '').toLowerCase().includes(q) || (p.source_tender_id || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
  }, [projects, search]);

  useEffect(() => {
    const vis = new Set(filtered.map(p => p.id));
    const ns = selectedProjectIds.filter(id => vis.has(id));
    if (ns.length !== selectedProjectIds.length) setSelectedProjectIds(ns);
    if (selId !== null && !vis.has(selId)) setSelId(ns[0] ?? null);
    if (projectFocusId !== null && !vis.has(projectFocusId)) setProjectFocusId(ns[0] ?? null);
  }, [filtered, selectedProjectIds, selId, projectFocusId]);

  const applyRange = (project: Project, additive: boolean) => {
    if (!lastProjectClickedId) return false;
    const ai = filtered.findIndex(x => x.id === lastProjectClickedId);
    const ci = filtered.findIndex(x => x.id === project.id);
    if (ai < 0 || ci < 0) return false;
    const rangeIds = filtered.slice(Math.min(ai, ci), Math.max(ai, ci) + 1).map(x => x.id);
    setSelectedProjectIds(additive ? Array.from(new Set([...selectedProjectIds, ...rangeIds])) : rangeIds);
    setSelId(project.id); setProjectFocusId(project.id);
    return true;
  };

  const handleProjectRowClick = (project: Project, evt: any) => {
    setConfirmDelIds([]);
    const ctrl = evt.ctrlKey || evt.metaKey;
    if (evt.shiftKey && applyRange(project, ctrl)) { setLastProjectClickedId(project.id); return; }
    if (ctrl) { const e = selectedProjectIds.includes(project.id); setSelectedProjectIds(e ? selectedProjectIds.filter(id => id !== project.id) : [...selectedProjectIds, project.id]); setSelId(project.id); setProjectFocusId(project.id); setLastProjectClickedId(project.id); return; }
    if (selectedProjectIds.length === 1 && selectedProjectIds[0] === project.id) { setSelectedProjectIds([]); setSelId(null); setProjectFocusId(project.id); setLastProjectClickedId(project.id); return; }
    setSelectedProjectIds([project.id]); setSelId(project.id); setProjectFocusId(project.id); setLastProjectClickedId(project.id);
  };

  const onProjectsKeyDown = (evt: any) => {
    if (filtered.length === 0) return;
    const ci = projectFocusId ? filtered.findIndex(p => p.id === projectFocusId) : -1;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(evt.key)) {
      evt.preventDefault();
      const ctrlLike = evt.ctrlKey || evt.metaKey;
      let ni = ci < 0 ? 0 : ci;
      if (evt.key === 'ArrowDown') ni = ctrlLike ? filtered.length - 1 : Math.min(filtered.length - 1, ni + 1);
      if (evt.key === 'ArrowUp') ni = ctrlLike ? 0 : Math.max(0, ni - 1);
      if (evt.key === 'Home') ni = 0;
      if (evt.key === 'End') ni = filtered.length - 1;
      const np = filtered[ni];
      if (!np) return;

      // Excel-style: Ctrl+Shift+Up/Down selects from the current anchor to the
      // top/bottom of the list.
      if (ctrlLike && evt.shiftKey && (evt.key === 'ArrowDown' || evt.key === 'ArrowUp')) {
        const anchor = (lastProjectClickedId && filtered.find(p => p.id === lastProjectClickedId)) || (projectFocusId && filtered.find(p => p.id === projectFocusId)) || np;
        const ai = filtered.findIndex(x => x.id === anchor.id);
        if (ai >= 0) {
          const goingDown = evt.key === 'ArrowDown';
          const start = goingDown ? ai : 0;
          const end = goingDown ? filtered.length - 1 : ai;
          const rangeIds = filtered.slice(start, end + 1).map(x => x.id);
          setSelectedProjectIds(rangeIds);
          setSelId(anchor.id);
          setLastProjectClickedId(anchor.id);
          setProjectFocusId(goingDown ? filtered[filtered.length - 1].id : filtered[0].id);
        }
        return;
      }

      setProjectFocusId(np.id);
      return;
    }
    if (evt.code !== 'Space' && evt.key !== ' ') return;
    evt.preventDefault();
    const fp = (projectFocusId && filtered.find(p => p.id === projectFocusId)) || filtered[0];
    if (!fp) return;
    const ctrl = evt.ctrlKey || evt.metaKey;
    if (evt.shiftKey && applyRange(fp, ctrl)) { setLastProjectClickedId(fp.id); return; }
    setSelectedProjectIds(ctrl ? (selectedProjectIds.includes(fp.id) ? selectedProjectIds.filter(id => id !== fp.id) : [...selectedProjectIds, fp.id]) : [fp.id]);
    setSelId(fp.id); setProjectFocusId(fp.id); setLastProjectClickedId(fp.id);
  };

  const projectColOrder = useMemo(() => projectsTable.columnOrder?.length ? projectsTable.columnOrder : PROJECT_COLUMNS.map(c => c.key), [projectsTable.columnOrder]);
  const projectHidden = useMemo(() => new Set(projectsTable.hiddenColumns || []), [projectsTable.hiddenColumns]);
  const orderedProjectCols = useMemo(() => { const byKey = new Map(PROJECT_COLUMNS.map(c => [c.key, c])); return projectColOrder.map(k => byKey.get(k)).filter(Boolean) as ProjectColumn[]; }, [projectColOrder]);
  const visibleProjectCols = orderedProjectCols.filter(c => c.fixed || !projectHidden.has(c.key));
  const getProjectColWidth = (c: ProjectColumn) => { const v = projectsTable.columnWidths?.[c.key]; return Number.isFinite(v) && v > 0 ? v : c.width; };
  const toggleProjectCol = (key: string) => { const n = new Set(projectHidden); if (n.has(key)) n.delete(key); else n.add(key); setProjectsHiddenColumns(Array.from(n)); };
  const moveProjectCol = (from: number, to: number) => { if (from === to) return; const n = [...projectColOrder]; const [item] = n.splice(from, 1); n.splice(to, 0, item); setProjectsColumnOrder(n); };
  const startProjectColResize = (col: ProjectColumn, startX: number) => {
    const min = col.key === '_sr' ? 48 : 90; const sw = getProjectColWidth(col);
    const onMove = (e: MouseEvent) => setProjectsColumnWidth(col.key, Math.max(min, sw + (e.clientX - startX)));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };

  useEffect(() => { const iv = setInterval(() => qc.invalidateQueries({ queryKey: ['projects'] }), 60_000); return () => clearInterval(iv); }, [qc]);

  // ─── Form ─────────────────────────────────────────────────────────────────
  const CopyBtn = ({ val }: { val: string }) => (
    <button onClick={() => copyText(val)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"><Copy size={12} /></button>
  );

  const projectForm = (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 flex items-center justify-center rounded-lg bg-[var(--accent)]/10">
            {editMode ? <Edit3 size={13} className="text-[var(--accent)]" /> : <Plus size={13} className="text-[var(--accent)]" />}
          </div>
          <h3 className="text-sm font-semibold text-[var(--text)]">{editMode ? 'Tender Details' : 'New Project'}</h3>
        </div>
        <div className="flex items-center gap-2">
          {editMode && <button onClick={() => setFormEditable(v => !v)} className={cn('btn-ghost gap-1.5 text-xs', formEditable && 'bg-[var(--accent-bg)] text-[var(--accent)]')}><Edit3 size={12} />{formEditable ? 'Editing' : 'Edit'}</button>}
          <button onClick={resetForm} className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"><X size={16} /></button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Tender ID</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input value={form.source_tender_id} readOnly={!canEditForm} onChange={e => uf('source_tender_id', e.target.value)} placeholder="2025/PWD/MH/12345" className="input-field h-9 w-full pr-8 text-sm" />
              <CopyBtn val={form.source_tender_id} />
            </div>
            <button onClick={handleFetch} disabled={!canEditForm} className="btn-secondary px-3 text-xs">Fetch</button>
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Client</label>
          <div className="relative"><input value={form.client_name} readOnly={!canEditForm} onChange={e => uf('client_name', e.target.value)} className="input-field h-9 w-full pr-8 text-sm" /><CopyBtn val={form.client_name} /></div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Value</label>
          <div className="relative"><input value={form.project_value} readOnly={!canEditForm} onChange={e => uf('project_value', e.target.value)} className="input-field h-9 w-full pr-8 text-sm" /><CopyBtn val={form.project_value} /></div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Status</label>
          <select value={form.status} disabled={!canEditForm} onChange={e => uf('status', e.target.value)} className="input-field h-9 w-full text-sm"><option>Active</option><option>Archived</option></select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Prebid Date</label>
          <div className="relative"><input value={form.prebid} readOnly={!canEditForm} onChange={e => uf('prebid', e.target.value)} placeholder="15-Apr-2026 03:00 PM" className="input-field h-9 w-full pr-8 text-sm" /><CopyBtn val={form.prebid} /></div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Deadline</label>
          <div className="relative"><input value={form.deadline} readOnly={!canEditForm} onChange={e => uf('deadline', e.target.value)} placeholder="28-Apr-2026 05:00 PM" className="input-field h-9 w-full pr-8 text-sm" /><CopyBtn val={form.deadline} /></div>
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Title / Name of Work</label>
        <div className="relative"><input value={form.title} readOnly={!canEditForm} onChange={e => uf('title', e.target.value)} className="input-field h-9 w-full pr-8 text-sm" /><CopyBtn val={form.title} /></div>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Description</label>
        <div className="relative">
          <textarea value={form.description} readOnly={!canEditForm} onChange={e => uf('description', e.target.value)} rows={2} className="input-field w-full py-2 pr-8 text-sm resize-none" style={{ minHeight: 60 }} />
          <button onClick={() => copyText(form.description)} className="absolute right-2 top-3 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"><Copy size={12} /></button>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1 border-t border-[var(--border)]">
        <button onClick={resetForm} className="btn-ghost text-sm">Cancel</button>
        <button onClick={handleSubmit} disabled={!form.title.trim() || (editMode && !canEditForm)} className="btn-primary gap-1.5 text-sm">
          <Save size={13} />{editMode ? 'Update' : 'Create Project'}
        </button>
      </div>
    </div>
  );

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col">

      {/* Header */}
      <div className="border-b border-[var(--border)] bg-[var(--surface-0)] px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <h1 className="text-base font-bold text-[var(--text)]">{archived ? 'Archived Projects' : 'Projects'}</h1>
            {!isLoading && <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--text-muted)]">{filtered.length}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={openSelectedProjectFolder} className="btn-ghost gap-1.5 text-xs"><FolderOpen size={13} />Open Folder</button>
            {!archived && <button onClick={() => restoreProjects.mutate()} disabled={restoreProjects.isPending} className="btn-ghost gap-1.5 text-xs"><ArchiveRestore size={13} />{restoreProjects.isPending ? 'Restoring…' : 'Restore Folders'}</button>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={archived ? 'Search archived…' : 'Search projects…'} className="input-field h-9 w-full text-sm" style={{ paddingLeft: '2.25rem' }} />
            {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)]"><X size={13} /></button>}
          </div>

          <div className="h-5 w-px bg-[var(--border)]" />

          {/* View toggle */}
          <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-0.5 gap-0.5">
            {(['table', 'cards'] as ViewMode[]).map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)} className={cn('flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs transition-all', viewMode === mode ? 'bg-[var(--surface-0)] text-[var(--text)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text)]')}>
                {mode === 'table' ? <><List size={13} />Table</> : <><LayoutGrid size={13} />Cards</>}
              </button>
            ))}
          </div>

          {/* Columns menu */}
          {viewMode === 'table' && (
            <div className="relative">
              <button onClick={() => setShowColsMenu(v => !v)} className="btn-ghost gap-1.5 text-xs"><SlidersHorizontal size={13} />Columns</button>
              {showColsMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowColsMenu(false)} />
                  <div className="card absolute left-0 top-9 z-50 max-h-80 w-60 overflow-auto border border-[var(--border)] p-2 shadow-xl">
                    <p className="mb-2 border-b border-[var(--border)] px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Drag to reorder · toggle visibility</p>
                    {orderedProjectCols.filter(c => !c.fixed).map((c, i) => (
                      <div key={c.key} draggable onDragStart={() => setDragIdx(i)} onDragOver={e => e.preventDefault()}
                        onDrop={() => { if (dragIdx !== null) { const nf = orderedProjectCols.filter(x => !x.fixed); const fk = nf[dragIdx]?.key; const tk = nf[i]?.key; if (fk && tk) { const fi = projectColOrder.indexOf(fk); const ti = projectColOrder.indexOf(tk); if (fi >= 0 && ti >= 0) moveProjectCol(fi, ti); } } setDragIdx(null); }}
                        className={cn('flex cursor-grab items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--surface-1)]', dragIdx === i && 'opacity-50')}>
                        <span className="select-none text-xs text-[var(--text-muted)]">⠿</span>
                        <input type="checkbox" checked={!projectHidden.has(c.key)} onChange={() => toggleProjectCol(c.key)} className="accent-[var(--accent)]" />
                        <span className="flex-1 text-xs">{c.label || c.key}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="flex-1" />

          {/* Action buttons */}
          <div className="flex items-center gap-1.5">
            <button disabled={!selId} onClick={() => setShowDetails(v => !v)} className={cn('btn-ghost gap-1.5 text-xs', showDetails && selId && 'bg-[var(--accent-bg)] text-[var(--accent)]')}>
              {showDetails ? <EyeOff size={13} /> : <Eye size={13} />}Details
            </button>
            <button disabled={!selId} onClick={() => { const p = filtered.find(x => x.id === selId); if (p) openProjectWorkspace(p); }} className="btn-ghost gap-1.5 text-xs">
              <ExternalLink size={13} />Open
            </button>
            {!archived && <button disabled={!selId} onClick={() => { const p = filtered.find(x => x.id === selId); if (p) loadIntoForm(p); }} className="btn-secondary gap-1.5 text-xs"><Edit3 size={13} />Edit</button>}
            {!archived && <button onClick={() => { resetForm(); setShowForm(v => !v); }} className="btn-primary gap-1.5 text-sm"><Plus size={14} />New Project</button>}
            <button disabled={selectedProjectIds.length === 0} onClick={() => { const targets = selectedProjectIds.length ? selectedProjectIds : (selId ? [selId] : []); setConfirmDelIds(Array.from(new Set(targets))); }} className="btn-danger gap-1.5 text-xs">
              <Trash2 size={13} />{archived ? 'Delete' : 'Archive'}
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      {!isLoading && filtered.length > 0 && <StatsBar projects={filtered} />}

      {/* Inline form */}
      {!archived && showForm && projectsEntryMode === 'inline' && (
        <div className="border-b border-[var(--border)] bg-[var(--surface-1)] px-6 py-5">{projectForm}</div>
      )}

      {/* Confirm delete */}
      {confirmDelIds.length > 0 && (
        <div className="flex items-center justify-between border-b border-rose-500/20 bg-rose-500/8 px-6 py-3">
          <div className="flex items-center gap-2">
            <Trash2 size={14} className="text-rose-400" />
            <p className="text-sm text-rose-400">{archived ? `Permanently delete ${confirmDelIds.length} project(s)?` : `Archive ${confirmDelIds.length} project(s)?`}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setConfirmDelIds([])} className="btn-ghost text-xs">Cancel</button>
            <button onClick={() => deleteProject.mutate(confirmDelIds)} className="btn-danger gap-1 text-xs"><Trash2 size={11} />{archived ? 'Delete permanently' : 'Archive'}</button>
          </div>
        </div>
      )}

      {/* Details panel */}
      {showDetails && selId && selectedProject && (
        <div className="border-b border-[var(--border)] bg-[var(--surface-1)] px-6 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ChevronRight size={14} className="text-[var(--text-muted)]" />
              <h3 className="text-sm font-semibold text-[var(--text)] truncate max-w-[500px]">{selectedProject.title}</h3>
              <Badge variant={selectedProject.status === 'Active' ? 'success' : 'muted'}>{selectedProject.status || 'Active'}</Badge>
            </div>
            <button onClick={() => setShowDetails(false)} className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"><X size={14} /></button>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[{ label: 'Tender ID', value: selectedProject.source_tender_id, mono: true }, { label: 'Client', value: selectedProject.client_name }, { label: 'Value', value: formatINR(selectedProject.project_value) }, { label: 'Deadline', value: selectedProject.deadline }].map(({ label, value, mono }) => (
              <div key={label} className="rounded-lg bg-[var(--surface-0)] border border-[var(--border)] px-3 py-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] mb-1">{label}</p>
                <p className={cn('text-sm text-[var(--text)] truncate', mono && 'font-mono')}>{value || '—'}</p>
              </div>
            ))}
          </div>
          <div className="space-y-2 border-t border-[var(--border)] pt-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Checklist</h4>
              {checklist && <span className="text-xs text-[var(--text-muted)]">{checklist.filter(i => i.status === 'Completed').length}/{checklist.length} done</span>}
            </div>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-4">
              <input value={newChecklistItem.req_file_name} onChange={e => setNewChecklistItem(v => ({ ...v, req_file_name: e.target.value }))} placeholder="Required file" className="input-field h-8 text-xs" />
              <input value={newChecklistItem.description} onChange={e => setNewChecklistItem(v => ({ ...v, description: e.target.value }))} placeholder="Description" className="input-field h-8 text-xs" />
              <input value={newChecklistItem.subfolder} onChange={e => setNewChecklistItem(v => ({ ...v, subfolder: e.target.value }))} placeholder="Subfolder" className="input-field h-8 text-xs" />
              <button disabled={!newChecklistItem.req_file_name.trim()} onClick={() => createChecklistItem.mutate({ projectId: selId, req_file_name: newChecklistItem.req_file_name.trim(), description: newChecklistItem.description.trim(), subfolder: newChecklistItem.subfolder.trim() || 'Main' })} className="btn-primary gap-1 text-xs"><Plus size={12} />Add Item</button>
            </div>
            {checklistLoading ? <div className="flex justify-center py-4"><Spinner size={16} className="text-[var(--accent)]" /></div> : (
              <table className="data-table">
                <thead><tr><th className="w-10">#</th><th>Required File</th><th>Description</th><th>Subfolder</th><th className="w-20 text-center">Done</th><th className="w-16 text-center">Del</th></tr></thead>
                <tbody>
                  {(checklist || []).map(item => (
                    <tr key={item.id} className={item.status === 'Completed' ? 'opacity-60' : ''}>
                      <td className="text-[var(--text-muted)]">{item.sr_no}</td>
                      <td className={cn('text-sm', item.status === 'Completed' && 'line-through text-[var(--text-muted)]')}>{item.req_file_name || '-'}</td>
                      <td className="text-xs">{item.description || '-'}</td>
                      <td className="text-xs">{item.subfolder || 'Main'}</td>
                      <td className="text-center"><button onClick={() => updateChecklistItem.mutate({ itemId: item.id, data: { status: item.status === 'Completed' ? 'Pending' : 'Completed' } })} className={cn('inline-flex h-5 w-5 items-center justify-center rounded border transition-colors', item.status === 'Completed' ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--border)] hover:border-[var(--accent)]')}>{item.status === 'Completed' ? <CheckSquare size={11} /> : <Square size={11} />}</button></td>
                      <td className="text-center"><button onClick={() => deleteChecklistItem.mutate(item.id)} className="text-rose-400 hover:text-rose-500 transition-colors"><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                  {(checklist || []).length === 0 && <tr><td colSpan={6}><EmptyState icon={Plus} title="No checklist items" description="Add first item above" /></td></tr>}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-auto" tabIndex={0} onKeyDown={onProjectsKeyDown}>
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Spinner size={24} className="text-[var(--accent)]" />
            <p className="text-sm text-[var(--text-muted)]">Loading projects…</p>
          </div>
        ) : viewMode === 'cards' ? (
          <div className="p-6">
            {filtered.length === 0 ? (
              <EmptyState icon={FolderOpen} title={search ? 'No matches found' : 'No projects yet'} description={search ? `No projects match "${search}"` : "Click '+ New Project' to get started"}
                action={!archived && !search ? <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary gap-1.5 text-sm"><Plus size={14} />New Project</button> : undefined} />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map(p => (
                  <ProjectCard key={p.id} project={p} isSelected={selectedProjectIds.includes(p.id)} isFocused={projectFocusId === p.id}
                    onClick={e => handleProjectRowClick(p, e)} onDoubleClick={() => openProjectWorkspace(p)} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <table className="data-table" style={{ tableLayout: 'fixed', width: '100%' }}>
            <thead>
              <tr>
                {visibleProjectCols.map(c => (
                  <th key={c.key} style={{ width: getProjectColWidth(c) }} className="relative">
                    <div className="flex items-center">{c.label}</div>
                    <div className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-[var(--accent)]/20" onMouseDown={e => { e.preventDefault(); e.stopPropagation(); startProjectColResize(c, e.clientX); }} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => (
                <tr key={p.id} onClick={e => handleProjectRowClick(p, e)} onDoubleClick={() => openProjectWorkspace(p)}
                  className={cn('cursor-pointer', selectedProjectIds.includes(p.id) && 'row-selected', projectFocusId === p.id && 'ring-1 ring-[var(--accent)]/40')}>
                  {visibleProjectCols.map(c => {
                    if (c.key === '_sr') return <td key={c.key} className="text-[var(--text-muted)] text-center">{i + 1}</td>;
                    if (c.key === 'source_tender_id') return <td key={c.key} className="font-mono text-xs text-[var(--accent)]">{p.source_tender_id || '—'}</td>;
                    if (c.key === 'title') return <td key={c.key}><p className="text-sm font-medium text-[var(--text)] truncate">{p.title}</p>{p.description && <p className="mt-0.5 max-w-[300px] truncate text-[11px] text-[var(--text-muted)]">{p.description}</p>}</td>;
                    if (c.key === 'client_name') return <td key={c.key} className="text-sm text-[var(--text-muted)] truncate">{p.client_name || '—'}</td>;
                    if (c.key === 'project_value') return <td key={c.key} className="font-mono text-sm">{formatINR(p.project_value)}</td>;
                    if (c.key === '_time_left') return <td key={c.key}><TimeBadge dateStr={p.deadline} /></td>;
                    if (c.key === 'status') return <td key={c.key}><Badge variant={p.status === 'Active' ? 'success' : 'muted'}>{p.status}</Badge></td>;
                    return <td key={c.key} className="text-sm">{String((p as any)[c.key] || '—')}</td>;
                  })}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={visibleProjectCols.length}>
                  <EmptyState icon={FolderOpen} title={search ? 'No matches found' : 'No projects yet'} description={search ? `No projects match "${search}"` : "Click '+ New Project' to get started"}
                    action={!archived && !search ? <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary gap-1.5 text-sm"><Plus size={14} />New Project</button> : undefined} />
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Popup modal */}
      {!archived && showForm && projectsEntryMode === 'popup' && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={resetForm} />
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto px-4 py-8">
            <div className="card w-full max-w-5xl border border-[var(--border)] bg-[var(--surface-0)] p-6 shadow-2xl">{projectForm}</div>
          </div>
        </>
      )}
    </div>
  );
}
