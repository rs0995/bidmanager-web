import { Fragment, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, EmptyState, Spinner } from '../components/ui/shared';
import { api, type ChecklistItem, type Tender } from '../lib/api';
import { cn } from '../lib/utils';
import {
  BookOpen, ChevronLeft, ChevronRight, Copy, Download, FolderCog,
  FolderOpen, Link2, Paperclip, Pencil, Plus, RefreshCw, Save,
  Search, Trash2, X, CheckCircle2, AlertCircle, FileText,
} from 'lucide-react';

const FOLDER_ORDER = ['Ready Docs', 'Tender Docs', 'Working Docs'];

function widenDateTimeGap(value: string) {
  const txt = String(value || '').trim();
  if (!txt) return '';
  return txt.replace(/(\d{2}-[A-Za-z]{3}-\d{4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/i, '$1   $2');
}

function normalizeValue2dp(value: string) {
  const txt = String(value || '').trim();
  if (!txt) return '';
  const stripped = txt.replace(/[₹,\s]/g, '').replace(/Rs\.?/i, '').replace(/INR/i, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(stripped)) return txt;
  const n = Number(stripped);
  if (!Number.isFinite(n)) return txt;
  return n.toFixed(2);
}

function addIndianCommas(value: string) {
  const txt = String(value || '').trim();
  if (!txt) return '';
  const stripped = txt.replace(/[₹,\s]/g, '').replace(/Rs\.?/i, '').replace(/INR/i, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(stripped)) return txt;
  const [intPart, decPart] = stripped.split('.');
  let grouped = intPart;
  if (intPart.length > 3) {
    let tail = intPart.slice(-3);
    let head = intPart.slice(0, -3);
    while (head.length > 2) { tail = `${head.slice(-2)},${tail}`; head = head.slice(0, -2); }
    grouped = `${head},${tail}`.replace(/^,/, '');
  }
  return decPart !== undefined ? `${grouped}.${decPart}` : grouped;
}

const WORKSPACE_VIEW_KEY = (projectId: number) => `bm-workspace-view-${projectId}`;

function sanitizeFolderLeaf(value: string, fallback = 'Project') {
  const txt = String(value || '').replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  return txt || fallback;
}

function fileNameOnly(path: string) {
  const txt = String(path || '');
  if (!txt) return '';
  const parts = txt.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || txt;
}

function sanitizeFileName(name: string) {
  return String(name || '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();
}

function toFileUrl(localPath: string) {
  return `file:///${encodeURI(localPath.replace(/\\/g, '/'))}`;
}

function parseDeadlineText(input: string): Date | null {
  const txt = String(input || '').trim();
  if (!txt) return null;
  const native = new Date(txt);
  if (!Number.isNaN(native.getTime())) return native;
  const m = txt.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AP]M))?$/i);
  if (!m) return null;
  const monMap: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const month = monMap[m[2].toLowerCase()];
  if (month === undefined) return null;
  let hour = Number(m[4] || '0');
  const ampm = String(m[6] || '').toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  const dt = new Date(Number(m[3]), month, Number(m[1]), hour, Number(m[5] || '0'), 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function getTimeRemaining(deadline: string): { label: string; urgent: boolean; expired: boolean } {
  const target = parseDeadlineText(deadline);
  if (!target) return { label: '—', urgent: false, expired: false };
  const diff = target.getTime() - Date.now();
  if (diff <= 0) return { label: 'Expired', urgent: false, expired: true };
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const urgent = days < 3;
  if (days > 0) return { label: `${days}d ${hours}h ${mins}m`, urgent, expired: false };
  if (hours > 0) return { label: `${hours}h ${mins}m`, urgent: true, expired: false };
  return { label: `${mins}m`, urgent: true, expired: false };
}

// ─── Inline copy button ───────────────────────────────────────────────────────
function CopyBtn({ val, className }: { val: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    try { await navigator.clipboard.writeText(String(val || '')); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* silent */ }
  };
  return (
    <button onClick={handle} title="Copy" className={cn('absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors', className)}>
      {copied ? <CheckCircle2 size={12} className="text-emerald-500" /> : <Copy size={12} />}
    </button>
  );
}

// ─── Info field ───────────────────────────────────────────────────────────────
function InfoField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">{label}</label>
      {children}
    </div>
  );
}

// ─── Toolbar action button ────────────────────────────────────────────────────
function ToolBtn({ icon: Icon, label, onClick, disabled, danger, active }: {
  icon: React.ElementType; label: string; onClick?: () => void;
  disabled?: boolean; danger?: boolean; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap',
        'hover:bg-[var(--surface-2)] disabled:pointer-events-none disabled:opacity-40',
        danger ? 'text-rose-400 hover:bg-rose-500/10' : active ? 'text-[var(--accent)] bg-[var(--accent-bg)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
      )}
    >
      <Icon size={12} className="shrink-0" />{label}
    </button>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function ProjectWorkspacePage({ projectId, embedded = false }: { projectId: number; embedded?: boolean }) {
  const qc = useQueryClient();
  const [docName, setDocName] = useState('');
  const [desc, setDesc] = useState('');
  const [folder, setFolder] = useState('Ready Docs');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [infoEditable, setInfoEditable] = useState(false);
  const [infoForm, setInfoForm] = useState({ source_tender_id: '', title: '', client_name: '', project_value: '', prebid: '', deadline: '' });
  const [previewWidth, setPreviewWidth] = useState(330);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [fetchingTenderInfo, setFetchingTenderInfo] = useState(false);
  const [managedFolders, setManagedFolders] = useState<string[]>([]);
  const [manageFoldersOpen, setManageFoldersOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameFrom, setRenameFrom] = useState('');
  const [renameTo, setRenameTo] = useState('');
  const [moveFrom, setMoveFrom] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const [deleteFolderName, setDeleteFolderName] = useState('');
  const [textPreview, setTextPreview] = useState('');
  const [textPreviewError, setTextPreviewError] = useState('');
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [saveTemplateForm, setSaveTemplateForm] = useState({ template_no: '', organization: '', template_name: '', description: '', notes: '' });
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [applyTemplateOpen, setApplyTemplateOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [corrigendumStatus, setCorrigendumStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [corrigendumMsg, setCorrigendumMsg] = useState('');

  const desktop = (window as any).bidmanagerDesktop as {
    openPath?: (p: string) => Promise<{ ok: boolean; canceled?: boolean; message?: string }>;
    pathExists?: (p: string) => Promise<{ ok: boolean; exists?: boolean; isDir?: boolean; resolved?: string; message?: string }>;
    pickPath?: (opts?: { file?: boolean; title?: string }) => Promise<{ ok: boolean; canceled?: boolean; path?: string; message?: string }>;
    renamePath?: (payload: { oldPath: string; newPath: string }) => Promise<{ ok: boolean; path?: string; message?: string }>;
    deleteFile?: (p: string) => Promise<{ ok: boolean; message?: string }>;
    copyFileToFolder?: (payload: { sourcePath: string; targetDir: string; targetName?: string }) => Promise<{ ok: boolean; path?: string; message?: string }>;
    ensureProjectFolders?: (p: string) => Promise<{ ok: boolean; path?: string; message?: string }>;
  } | undefined;

  const { data: project, isLoading: projectLoading } = useQuery({ queryKey: ['project', projectId], queryFn: () => api.getProject(projectId) });
  const { data: checklist, isLoading: checklistLoading } = useQuery({ queryKey: ['project-checklist', projectId], queryFn: () => api.listChecklist(projectId) });
  const { data: allTemplates } = useQuery({ queryKey: ['templates'], queryFn: () => api.listTemplates(), enabled: applyTemplateOpen });

  const createItem = useMutation({
    mutationFn: () => api.createChecklistItem(projectId, { req_file_name: docName.trim(), description: desc.trim(), subfolder: folder, status: 'Pending' }),
    onSuccess: () => { setDocName(''); setDesc(''); qc.invalidateQueries({ queryKey: ['project-checklist', projectId] }); },
  });
  const updateItem = useMutation({
    mutationFn: (itemId: number) => api.updateChecklistItem(itemId, { req_file_name: docName.trim(), description: desc.trim(), subfolder: folder }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-checklist', projectId] }),
  });
  const deleteItem = useMutation({
    mutationFn: (itemId: number) => api.deleteChecklistItem(itemId),
    onSuccess: () => { setSelectedId(null); setDocName(''); setDesc(''); qc.invalidateQueries({ queryKey: ['project-checklist', projectId] }); },
  });
  const updateProjectInfo = useMutation({
    mutationFn: () => api.updateProject(projectId, { source_tender_id: infoForm.source_tender_id, title: infoForm.title, client_name: infoForm.client_name, project_value: infoForm.project_value, prebid: infoForm.prebid, deadline: infoForm.deadline }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['project', projectId] }); qc.invalidateQueries({ queryKey: ['projects'] }); setInfoEditable(false); },
  });

  const selectedItem = useMemo(() => (checklist || []).find(x => x.id === selectedId) || null, [checklist, selectedId]);

  useEffect(() => { if (!selectedItem) return; setDocName(selectedItem.req_file_name || ''); setDesc(selectedItem.description || ''); setFolder(selectedItem.subfolder || 'Ready Docs'); }, [selectedItem?.id]);
  useEffect(() => {
    if (!project) return;
    setInfoForm({ source_tender_id: String(project.source_tender_id || ''), title: String(project.title || ''), client_name: String(project.client_name || ''), project_value: normalizeValue2dp(String(project.project_value || '')), prebid: widenDateTimeGap(String(project.prebid || '')), deadline: String(project.deadline || '') });
  }, [project?.id]);

  const folderOptions = useMemo(() => {
    const names = new Set<string>(FOLDER_ORDER);
    for (const f of managedFolders) { const c = String(f || '').trim(); if (c) names.add(c); }
    for (const row of checklist || []) { const c = String(row.subfolder || '').trim(); if (c) names.add(c); }
    const picked = String(folder || '').trim(); if (picked) names.add(picked);
    return Array.from(names);
  }, [managedFolders, checklist, folder]);

  const grouped = useMemo(() => {
    const source = checklist || [];
    const map = new Map<string, ChecklistItem[]>();
    for (const key of folderOptions) map.set(key, []);
    for (const row of source) { const key = (row.subfolder || 'Ready Docs').trim() || 'Ready Docs'; if (!map.has(key)) map.set(key, []); map.get(key)!.push(row); }
    const ordered = [...FOLDER_ORDER.filter(k => map.has(k)), ...[...map.keys()].filter(k => !FOLDER_ORDER.includes(k)).sort()];
    return ordered.map(name => ({ name, rows: map.get(name) || [] }));
  }, [checklist, folderOptions]);

  // checklist summary
  const totalItems = (checklist || []).length;
  const completedItems = (checklist || []).filter(x => x.status === 'Completed').length;
  const progressPct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  const projectFolderPath = useMemo(() => {
    const direct = String(project?.folder_path || '').trim();
    if (direct) return direct;
    const knownFolders = new Set<string>([...FOLDER_ORDER, ...managedFolders, ...(checklist || []).map(x => String(x.subfolder || '').trim())].map(x => String(x || '').trim().toLowerCase()).filter(Boolean));
    for (const row of checklist || []) {
      const linked = String(row.linked_file_path || '').trim();
      if (!linked) continue;
      const normalized = linked.replace(/\\/g, '/');
      const lower = normalized.toLowerCase();
      for (const sub of knownFolders) {
        const idx = lower.indexOf(`/${sub}/`);
        if (idx > 0) return normalized.slice(0, idx).replace(/\/+$/, '');
      }
      const slash = normalized.lastIndexOf('/');
      if (slash > 0) {
        const parent = normalized.slice(0, slash).replace(/\/+$/, '');
        const parts = parent.split('/');
        const last = (parts[parts.length - 1] || '').trim().toLowerCase();
        if (knownFolders.has(last)) { const root = parts.slice(0, -1).join('/').replace(/\/+$/, ''); if (root) return root; }
        return parent;
      }
    }
    return '';
  }, [project?.folder_path, managedFolders, checklist]);

  const openPath = async (path: string) => { if (!path.trim() || !desktop?.openPath) return; await desktop.openPath(path); };

  const resolveExistingProjectFolder = async () => {
    let lp: any = null;
    try { await api.ensureProjectFolder(projectId); } catch { /* older backend */ }
    try { lp = await api.getProject(projectId); } catch { lp = null; }
    let rootFolder = '';
    try { const r = await api.getProjectsRootFolder(); rootFolder = String(r?.root_folder || '').trim(); } catch { /* compat */ }
    const rootCandidates = [rootFolder, 'backend/My_Tender_Projects', 'My_Tender_Projects'].filter(Boolean);
    const sti = String(lp?.source_tender_id || infoForm.source_tender_id || '').trim();
    const ttl = String(lp?.title || infoForm.title || '').trim();
    const candidates = Array.from(new Set([String(projectFolderPath || '').trim(), String(lp?.folder_path || '').trim(), ...rootCandidates.flatMap(root => [sti ? `${root}/${sanitizeFolderLeaf(sti, 'Project')}` : '', ttl ? `${root}/${sanitizeFolderLeaf(ttl, 'Project')}` : ''])].map(x => String(x || '').trim()).filter(Boolean)));
    if (!desktop?.pathExists) return candidates[0] || '';
    for (const c of candidates) { const chk = await desktop.pathExists(c); if (chk?.ok && chk.exists && chk.isDir) return String(chk.resolved || c).trim(); }
    if (desktop?.ensureProjectFolders) {
      const br = rootFolder || 'backend/My_Tender_Projects';
      const leaf = sanitizeFolderLeaf(sti || ttl || `Project_${projectId}`, `Project_${projectId}`);
      const mk = await desktop.ensureProjectFolders(`${br}${br.endsWith('\\') || br.endsWith('/') ? '' : '/'}${leaf}`);
      if (mk?.ok && mk.path) { const created = String(mk.path).trim(); try { await api.updateProject(projectId, { folder_path: created }); } catch { /* ignore */ } return created; }
    }
    return '';
  };

  const openProjectFolder = async () => {
    if (!desktop?.openPath) { alert('Open Folder is available in Electron desktop mode.'); return; }
    const existing = await resolveExistingProjectFolder();
    const candidates = Array.from(new Set([existing].map(x => String(x || '').trim()).filter(Boolean)));
    if (!candidates.length) { alert('Project folder is not available.'); return; }
    let msg = '';
    for (const c of candidates) { const res = await desktop.openPath(c); if (res?.ok) return; msg = String(res?.message || ''); }
    alert(msg ? `Open folder failed: ${msg}` : 'Project folder is not available.');
  };

  const uf = (k: keyof typeof infoForm, v: string) => setInfoForm(prev => ({ ...prev, [k]: v }));

  const handleSaveTemplate = async () => {
    if (!saveTemplateForm.template_name.trim() || !saveTemplateForm.organization.trim()) return;
    setSavingTemplate(true);
    try {
      await api.saveProjectAsTemplate(projectId, { template_no: saveTemplateForm.template_no ? Number(saveTemplateForm.template_no) : undefined, organization: saveTemplateForm.organization, template_name: saveTemplateForm.template_name, description: saveTemplateForm.description || undefined, notes: saveTemplateForm.notes || undefined });
      setSaveTemplateOpen(false);
      setSaveTemplateForm({ template_no: '', organization: '', template_name: '', description: '', notes: '' });
      qc.invalidateQueries({ queryKey: ['templates'] });
      alert('Template saved successfully.');
    } catch (err) {
      alert(`Save template failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setSavingTemplate(false); }
  };

  const handleApplyTemplate = async (templateId: number) => {
    try {
      const result = await api.applyTemplateToProject(projectId, templateId);
      setApplyTemplateOpen(false);
      qc.invalidateQueries({ queryKey: ['project-checklist', projectId] });
      alert(`Template applied. ${result.added} item(s) added.`);
    } catch (err) { alert(`Apply template failed: ${err instanceof Error ? err.message : String(err)}`); }
  };

  const handleCheckCorrigendum = async () => {
    const tid = infoForm.source_tender_id.trim();
    if (!tid) { alert('This project is not linked to a Tender ID.'); return; }
    setCorrigendumStatus('running');
    setCorrigendumMsg('Checking active tender and syncing corrigendum files...');
    try {
      const res = await api.checkProjectCorrigendum(projectId);
      if (!res.found || !res.tender) { setCorrigendumStatus('error'); setCorrigendumMsg('Tender ID of this project was not found in Active Tenders.'); return; }
      if (res.source === 'corrigendum_sync_no_download') { setCorrigendumStatus('error'); setCorrigendumMsg(res.message || 'Corrigendum download did not start.'); alert(res.message || 'Corrigendum download did not start.'); return; }
      setInfoForm(f => ({ ...f, source_tender_id: String(res.tender?.tender_id || f.source_tender_id || tid), title: String(res.tender?.title || f.title || ''), client_name: String(res.tender?.org_chain || f.client_name || ''), project_value: normalizeValue2dp(String(res.tender?.tender_value || f.project_value || '')), prebid: widenDateTimeGap(String(res.tender?.pre_bid_meeting_date || f.prebid || '')), deadline: String(res.tender?.closing_date || f.deadline || '') }));
      setCorrigendumStatus('done');
      setCorrigendumMsg(`Corrigendum/Addendum/Pre-bid check completed. Synced files: ${res.files?.length || 0}`);
      qc.invalidateQueries({ queryKey: ['project-checklist', projectId] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('API 404') || msg.includes('API 405')) {
        try {
          setCorrigendumMsg('Fallback mode: checking tender and running update download...');
          let tenderId: number | null = null;
          try { const result = await api.fetchTenderForProject(tid, false); if (result.found && result.tender) tenderId = result.tender.id; } catch { /* continue */ }
          if (!tenderId) { const local = await findLocalTender(tid); if (local?.id) tenderId = Number(local.id); }
          if (!tenderId) { setCorrigendumStatus('error'); setCorrigendumMsg('Tender not found in database for corrigendum check.'); return; }
          let ok = false;
          try {
            const job = await api.downloadSingleTender(tenderId, 'update'); ok = await waitForJob(job.job_id);
          } catch (se) {
            const sm = se instanceof Error ? se.message : String(se);
            if (sm.includes('API 404') || sm.includes('API 405')) {
              const local = await findLocalTender(tid); const websiteId = Number(local?.website_id || 0);
              if (websiteId > 0) { try { await api.patchTender(tenderId, { is_downloaded: true }); } catch { /* ignore */ } const job = await api.downloadTenders(websiteId); ok = await waitForJob(job.job_id); }
              else { throw se; }
            } else { throw se; }
          }
          if (!ok) { setCorrigendumStatus('error'); setCorrigendumMsg('Corrigendum update download failed.'); return; }
          setCorrigendumStatus('done'); setCorrigendumMsg('Corrigendum check completed (legacy fallback mode).');
          qc.invalidateQueries({ queryKey: ['project-checklist', projectId] }); qc.invalidateQueries({ queryKey: ['project', projectId] });
          return;
        } catch (fb) { setCorrigendumStatus('error'); setCorrigendumMsg(`Fallback failed: ${fb instanceof Error ? fb.message : String(fb)}`); return; }
      }
      setCorrigendumStatus('error'); setCorrigendumMsg(`Error: ${msg}`);
    }
  };

  const waitForJob = async (jobId: string, timeoutMs = 180000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const job = await api.getJob(jobId);
      if (job?.status === 'completed') return true;
      if (job?.status === 'failed') return false;
      await new Promise(r => setTimeout(r, 1200));
    }
    return false;
  };

  const findLocalTender = async (tenderId: string): Promise<Tender | null> => {
    const tid = String(tenderId || '').trim().toLowerCase();
    if (!tid) return null;
    const sites = await api.listWebsites();
    const grouped = await Promise.all(sites.map(async w => { const [a, b] = await Promise.all([api.listTenders(w.id, { archived: false, limit: 5000 }), api.listTenders(w.id, { archived: true, limit: 5000 })]); return [...a, ...b]; }));
    const all = grouped.flat();
    const exact = all.find(t => String(t.tender_id || '').trim().toLowerCase() === tid);
    if (exact) return exact;
    const partials = all.filter(t => String(t.tender_id || '').toLowerCase().includes(tid));
    if (!partials.length) return null;
    partials.sort((a, b) => Number(Boolean(b.is_downloaded)) - Number(Boolean(a.is_downloaded)));
    return partials[0] || null;
  };

  const inferSubfolderFromPath = (pathTxt: string, baseFolder: string) => {
    const p = String(pathTxt || '').replace(/\\/g, '/').trim();
    const base = String(baseFolder || '').replace(/\\/g, '/').replace(/\/+$/, '').trim();
    if (!p) return folder || 'Ready Docs';
    if (base && p.toLowerCase().startsWith(base.toLowerCase())) { const rel = p.slice(base.length).replace(/^\/+/, ''); const first = rel.split('/')[0] || ''; if (first) return first; }
    return folder || 'Ready Docs';
  };

  const fetchTenderInfo = async () => {
    const tid = infoForm.source_tender_id.trim();
    if (!tid) return;
    setFetchingTenderInfo(true);
    let captchaStop = false;
    const runWithCaptchaAssist = async <T,>(task: () => Promise<T>): Promise<T> => {
      const poll = async () => {
        while (!captchaStop) {
          try {
            const cp = await api.getPendingCaptcha();
            if (cp) {
              const entered = window.prompt('Enter CAPTCHA shown in scraper browser:', '');
              const text = String(entered || '').trim();
              if (text) {
                await api.submitCaptcha(cp.request_id, text);
              }
            }
          } catch {
            // ignore transient polling errors
          }
          await new Promise((r) => setTimeout(r, 900));
        }
      };
      const pollPromise = poll();
      try {
        return await task();
      } finally {
        captchaStop = true;
        await pollPromise.catch(() => undefined);
      }
    };
    try {
      let match: Tender | null = null;
      let fetchedFiles: Array<{ local_path: string; file_name: string; file_type: string }> = [];
      let fetchNotice = '';
      try {
        const activeSync = await runWithCaptchaAssist(() => api.fetchProjectFromActive(projectId));
        if (activeSync.found && activeSync.tender) {
          if (activeSync.source === 'active_sync_no_download' || activeSync.source === 'active_sync_no_files') fetchNotice = String(activeSync.message || 'Tender synced, but files were not available yet.');
          match = activeSync.tender;
          fetchedFiles = (activeSync.files || []).map(f => ({ local_path: String(f.local_path || ''), file_name: String(f.file_name || ''), file_type: String(f.file_type || 'document') }));
        }
      } catch { /* older backend */ }
      if (!match) try { const result = await api.fetchTenderForProject(tid, true); if (result.found && result.tender) { match = result.tender; fetchedFiles = (result.files || []).map(f => ({ local_path: String(f.local_path || ''), file_name: String(f.file_name || ''), file_type: String(f.file_type || 'document') })); } } catch { /* older backend */ }
      if (!match) match = await findLocalTender(tid);
      if (!match) { const sites = await api.listWebsites(); for (const s of sites) { const j = await api.fetchTenders(s.id); const ok = await waitForJob(j.job_id); if (!ok) continue; match = await findLocalTender(tid); if (match) break; } }
      if (!match) { alert('Tender not found in DB, and online scrape did not return this tender.'); return; }
      setInfoForm(f => ({ ...f, source_tender_id: String(match!.tender_id || f.source_tender_id || tid), title: String(match!.title || ''), client_name: String(match!.org_chain || ''), project_value: normalizeValue2dp(String(match!.tender_value || '')), prebid: widenDateTimeGap(String(match!.pre_bid_meeting_date || '')), deadline: String(match!.closing_date || '') }));
      const existingByPath = new Set((checklist || []).map(x => String(x.linked_file_path || '').trim().toLowerCase()).filter(Boolean));
      for (const file of fetchedFiles) {
        const linked = String(file.local_path || '').trim();
        if (!linked || existingByPath.has(linked.toLowerCase())) continue;
        const reqName = String(file.file_name || fileNameOnly(linked) || '').trim();
        const subfolder = linked.toLowerCase().includes('tender docs') ? 'Tender Docs' : inferSubfolderFromPath(linked, String(match!.folder_path || ''));
        await api.createChecklistItem(projectId, { req_file_name: reqName, description: file.file_type ? `${file.file_type} file` : '', subfolder, linked_file_path: linked, status: 'Completed' });
        existingByPath.add(linked.toLowerCase());
      }
      qc.invalidateQueries({ queryKey: ['project-checklist', projectId] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      if (fetchNotice) alert(`${fetchNotice}\n\nTender details were updated. Files synced: ${fetchedFiles.length}.`);
      else if (fetchedFiles.length === 0) alert('Fetch completed but no files were found to sync into project Tender Docs.');
    } catch (err) {
      alert(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setFetchingTenderInfo(false); }
  };

  useEffect(() => {
    if (!embedded) return;
    const onEditToggle = () => setInfoEditable(v => !v);
    const onSave = () => { if (!infoEditable || updateProjectInfo.isPending) return; updateProjectInfo.mutate(); };
    const onOpenFolder = () => { void openProjectFolder(); };
    window.addEventListener('bm-workspace-edit-toggle', onEditToggle as EventListener);
    window.addEventListener('bm-workspace-save', onSave as EventListener);
    window.addEventListener('bm-workspace-open-folder', onOpenFolder as EventListener);
    return () => {
      window.removeEventListener('bm-workspace-edit-toggle', onEditToggle as EventListener);
      window.removeEventListener('bm-workspace-save', onSave as EventListener);
      window.removeEventListener('bm-workspace-open-folder', onOpenFolder as EventListener);
    };
  }, [embedded, infoEditable, updateProjectInfo.isPending, projectFolderPath]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WORKSPACE_VIEW_KEY(projectId));
      if (!raw) return;
      const saved = JSON.parse(raw) as any;
      if (typeof saved.selectedId === 'number' || saved.selectedId === null) setSelectedId(saved.selectedId ?? null);
      if (typeof saved.folder === 'string' && saved.folder.trim()) setFolder(saved.folder.trim());
      if (typeof saved.previewWidth === 'number' && Number.isFinite(saved.previewWidth)) setPreviewWidth(Math.max(240, Math.min(680, saved.previewWidth)));
      if (typeof saved.previewCollapsed === 'boolean') setPreviewCollapsed(saved.previewCollapsed);
      if (typeof saved.infoEditable === 'boolean') setInfoEditable(saved.infoEditable);
      if (Array.isArray(saved.managedFolders)) setManagedFolders(saved.managedFolders.map((x: any) => String(x || '').trim()).filter(Boolean));
    } catch { /* ignore */ }
  }, [projectId]);

  useEffect(() => {
    localStorage.setItem(WORKSPACE_VIEW_KEY(projectId), JSON.stringify({ selectedId, folder, previewWidth, previewCollapsed, infoEditable, managedFolders }));
  }, [projectId, selectedId, folder, previewWidth, previewCollapsed, infoEditable, managedFolders]);

  const timeRemaining = useMemo(() => getTimeRemaining(infoForm.deadline), [infoForm.deadline]);

  useEffect(() => {
    const label = timeRemaining.expired ? 'Expired' : timeRemaining.label !== '—' ? `Time Remaining: ${timeRemaining.label}` : 'Time Remaining: -';
    window.dispatchEvent(new CustomEvent('bm-workspace-time-remaining', { detail: { label } }));
    return () => { window.dispatchEvent(new CustomEvent('bm-workspace-time-remaining', { detail: { label: '' } })); };
  }, [timeRemaining]);

  const attachFile = async () => {
    if (!desktop?.pickPath || !desktop?.copyFileToFolder) { alert('Desktop file integration is unavailable. Open this in Electron desktop mode.'); return; }
    const baseFolder = await resolveExistingProjectFolder();
    if (!baseFolder) { alert('Project folder is not available.'); return; }
    const pick = await desktop.pickPath({ file: true, title: 'Select attachment file' });
    if (!pick?.ok || !pick.path) return;
    const subfolder = selectedItem?.subfolder || folder || 'Ready Docs';
    const cleanSubfolder = String(subfolder || 'Ready Docs').trim();
    const targetDir = cleanSubfolder === 'Main' ? baseFolder : `${baseFolder}${baseFolder.endsWith('\\') || baseFolder.endsWith('/') ? '' : '\\'}${cleanSubfolder}`;
    const pickedName = fileNameOnly(pick.path || '');
    const pickedExt = (pickedName.match(/(\.[^./\\]+)$/)?.[1]) || '';
    let desiredName = sanitizeFileName((selectedItem?.req_file_name || docName || pickedName).trim() || pickedName);
    if (desiredName && pickedExt && !desiredName.toLowerCase().endsWith(pickedExt.toLowerCase())) desiredName += pickedExt;
    desiredName = sanitizeFileName(desiredName);
    const copied = await desktop.copyFileToFolder({ sourcePath: pick.path, targetDir, targetName: desiredName || undefined });
    if (!copied?.ok || !copied.path) { alert(`Attach failed: ${copied?.message || 'Unknown error'}`); return; }
    if (selectedItem) {
      await api.updateChecklistItem(selectedItem.id, { linked_file_path: copied.path, status: 'Completed', subfolder: cleanSubfolder });
    } else {
      const created = await api.createChecklistItem(projectId, { req_file_name: (docName || desiredName).trim(), description: desc.trim(), subfolder: cleanSubfolder, linked_file_path: copied.path, status: 'Completed' });
      setSelectedId(created.id);
    }
    qc.invalidateQueries({ queryKey: ['project-checklist', projectId] });
  };

  const attachmentPath = String(selectedItem?.linked_file_path || '').trim();
  const attachmentName = fileNameOnly(attachmentPath);
  const isImage = /\.(png|jpg|jpeg|gif|bmp|webp|svg)$/i.test(attachmentName);
  const isPdf = /\.pdf$/i.test(attachmentName);
  const isTextLike = /\.(txt|log|csv|json|md|xml|html|css|js|ts|tsx|py)$/i.test(attachmentName);
  const ext = (attachmentName.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();

  useEffect(() => {
    let cancelled = false;
    setTextPreview(''); setTextPreviewError('');
    if (!attachmentPath || !isTextLike) return;
    fetch(toFileUrl(attachmentPath)).then(r => r.text()).then(txt => { if (cancelled) return; setTextPreview(txt.slice(0, 4000)); }).catch(() => { if (cancelled) return; setTextPreviewError('Text preview is not available here. Use Open File.'); });
    return () => { cancelled = true; };
  }, [attachmentPath, isTextLike]);

  const startPreviewResize = (startX: number) => {
    const startW = previewWidth;
    const onMove = (evt: MouseEvent) => { const next = Math.max(240, Math.min(680, startW - (evt.clientX - startX))); setPreviewWidth(next); if (previewCollapsed) setPreviewCollapsed(false); };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };

  const renameAttachedFile = async () => {
    if (!selectedItem || !attachmentPath || !desktop?.renamePath) return;
    const asked = window.prompt('New file name', String(attachmentName || '').trim());
    const nextName = String(asked || '').trim();
    if (!nextName) return;
    const dir = attachmentPath.replace(/[\\\/][^\\\/]+$/, '');
    const newPath = `${dir}${dir.endsWith('\\') || dir.endsWith('/') ? '' : '\\'}${nextName}`;
    const result = await desktop.renamePath({ oldPath: attachmentPath, newPath });
    if (!result?.ok || !result.path) { alert(`Rename file failed: ${result?.message || 'Unknown error'}`); return; }
    await api.updateChecklistItem(selectedItem.id, { linked_file_path: result.path });
    qc.invalidateQueries({ queryKey: ['project-checklist', projectId] });
  };

  const deleteAttachedFile = async () => {
    if (!selectedItem || !attachmentPath || !desktop?.deleteFile) return;
    if (!window.confirm(`Delete attached file?\n${attachmentName}`)) return;
    const result = await desktop.deleteFile(attachmentPath);
    if (!result?.ok) { alert(`Delete file failed: ${result?.message || 'Unknown error'}`); return; }
    await api.updateChecklistItem(selectedItem.id, { linked_file_path: '', status: 'Pending' });
    qc.invalidateQueries({ queryKey: ['project-checklist', projectId] });
  };

  const deleteSelectedItem = async () => {
    if (!selectedItem) return;
    const label = String(selectedItem.req_file_name || selectedItem.description || `#${selectedItem.id}`);
    if (!window.confirm(`Delete item?\n${label}`)) return;
    await deleteItem.mutateAsync(selectedItem.id);
  };

  const ensureFolder = (name: string) => {
    const clean = String(name || '').trim();
    if (!clean) return false;
    if (folderOptions.some(x => x.toLowerCase() === clean.toLowerCase())) return true;
    setManagedFolders(prev => [...prev, clean]);
    return true;
  };
  const addFolder = () => { if (!ensureFolder(newFolderName)) return; setFolder(String(newFolderName || '').trim()); setNewFolderName(''); };
  const renameFolder = async () => {
    const from = String(renameFrom || '').trim(); const to = String(renameTo || '').trim();
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) return;
    ensureFolder(to);
    const hits = (checklist || []).filter(x => String(x.subfolder || '').trim().toLowerCase() === from.toLowerCase());
    await Promise.all(hits.map(x => api.updateChecklistItem(x.id, { subfolder: to })));
    setManagedFolders(prev => prev.map(x => x.toLowerCase() === from.toLowerCase() ? to : x).filter(Boolean));
    if (folder.toLowerCase() === from.toLowerCase()) setFolder(to);
    setRenameFrom(''); setRenameTo('');
    qc.invalidateQueries({ queryKey: ['project-checklist', projectId] });
  };
  const moveFolderItems = async () => {
    const from = String(moveFrom || '').trim(); const to = String(moveTo || '').trim();
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) return;
    ensureFolder(to);
    const hits = (checklist || []).filter(x => String(x.subfolder || '').trim().toLowerCase() === from.toLowerCase());
    await Promise.all(hits.map(x => api.updateChecklistItem(x.id, { subfolder: to })));
    setMoveFrom(''); setMoveTo('');
    qc.invalidateQueries({ queryKey: ['project-checklist', projectId] });
  };
  const deleteFolder = async () => {
    const name = String(deleteFolderName || '').trim();
    if (!name) return;
    if (FOLDER_ORDER.some(x => x.toLowerCase() === name.toLowerCase())) { alert('Default folder cannot be deleted.'); return; }
    const hits = (checklist || []).filter(x => String(x.subfolder || '').trim().toLowerCase() === name.toLowerCase());
    if (hits.length > 0) { const target = folderOptions.find(x => x.toLowerCase() !== name.toLowerCase()) || 'Ready Docs'; await Promise.all(hits.map(x => api.updateChecklistItem(x.id, { subfolder: target }))); }
    setManagedFolders(prev => prev.filter(x => x.toLowerCase() !== name.toLowerCase()));
    if (folder.toLowerCase() === name.toLowerCase()) setFolder('Ready Docs');
    setDeleteFolderName('');
    qc.invalidateQueries({ queryKey: ['project-checklist', projectId] });
  };

  if (projectLoading) return <div className="flex h-full items-center justify-center"><Spinner size={24} className="text-[var(--accent)]" /></div>;

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className={cn('flex flex-col bg-[var(--bg)] text-[var(--text)]', embedded ? 'h-full' : 'h-screen')}>

      {/* ── Info Panel ─────────────────────────────────────────────────────── */}
      <div className="border-b border-[var(--border)] bg-[var(--surface-0)] px-5 py-3">

        {/* ── Row 1: compact metadata strip ─────────────────────────────────── */}
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2 mb-3">

          {/* Tender ID */}
          <div className="min-w-[190px] flex-[2.3]">
            <InfoField label="Tender ID">
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <input value={infoForm.source_tender_id} readOnly={!infoEditable} onChange={e => uf('source_tender_id', e.target.value)} className="input-field h-8 w-full text-xs" style={{ paddingRight: '2rem' }} />
                  <CopyBtn val={infoForm.source_tender_id} />
                </div>
                <button onClick={fetchTenderInfo} disabled={fetchingTenderInfo} className="btn-secondary shrink-0 px-2.5 text-xs h-8">
                  {fetchingTenderInfo ? <Spinner size={12} className="text-[var(--accent)]" /> : 'Fetch'}
                </button>
              </div>
            </InfoField>
          </div>

          {/* Client */}
          <div className="min-w-[200px] flex-[3]">
            <InfoField label="Client">
              <div className="relative">
                <input value={infoForm.client_name} readOnly={!infoEditable} onChange={e => uf('client_name', e.target.value)} className="input-field h-8 w-full text-xs" style={{ paddingRight: '2rem' }} />
                <CopyBtn val={infoForm.client_name} />
              </div>
            </InfoField>
          </div>

          {/* Value */}
          <div className="min-w-[120px] flex-[1.2]">
            <InfoField label="Value">
              <div className="relative">
                <input value={addIndianCommas(infoForm.project_value)} readOnly={!infoEditable} onChange={e => uf('project_value', e.target.value.replace(/,/g, ''))} className="input-field h-8 w-full text-xs" style={{ paddingRight: '2rem' }} />
                <CopyBtn val={infoForm.project_value} />
              </div>
            </InfoField>
          </div>

          {/* Prebid */}
          <div className="min-w-[180px] flex-[1.7]">
            <InfoField label="Prebid">
              <div className="relative">
                <input value={infoForm.prebid} readOnly={!infoEditable} onChange={e => uf('prebid', e.target.value)} className="input-field h-8 w-full text-xs" style={{ paddingRight: '2rem' }} />
                <CopyBtn val={infoForm.prebid} />
              </div>
            </InfoField>
          </div>

          {/* Deadline — no time chip here, it's already in the header */}
          <div className="min-w-[160px] flex-[1.5]">
            <InfoField label="Deadline">
              <div className="relative">
                <input value={infoForm.deadline} readOnly={!infoEditable} onChange={e => uf('deadline', e.target.value)} className="input-field h-8 w-full text-xs" style={{ paddingRight: '2rem' }} />
                <CopyBtn val={infoForm.deadline} />
              </div>
            </InfoField>
          </div>
        </div>

        {/* ── Row 2: Name of Work + sidebar ─────────────────────────────────── */}
        <div className="flex gap-4 items-start">

          {/* Name of Work — takes most of the width */}
          <div className="flex-1 min-w-0">
            <InfoField label="Name of Work">
              <div className="relative">
                <textarea
                  value={infoForm.title}
                  readOnly={!infoEditable}
                  onChange={e => uf('title', e.target.value)}
                  rows={2}
                  className="input-field w-full resize-none py-2 pr-8 text-xs leading-5"
                  style={{ minHeight: 56, paddingRight: '2rem' }}
                />
                <CopyBtn val={infoForm.title} className="top-3 -translate-y-0" />
              </div>
            </InfoField>
          </div>

          {/* Right sidebar: progress + edit/save — fixed width */}
          <div className="shrink-0 w-48 flex flex-col gap-2.5 pt-0.5">

            {/* Progress bar */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Progress</span>
                <span className="text-xs font-bold text-[var(--text)]">{progressPct}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-[var(--surface-2)]">
                <div
                  className={cn(
                    'h-1.5 rounded-full transition-all',
                    progressPct === 100 ? 'bg-emerald-500' : 'bg-[var(--accent)]'
                  )}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">{completedItems} of {totalItems} docs ready</p>
            </div>

            {/* Edit / Save / Cancel */}
            {!infoEditable ? (
              <button
                onClick={() => setInfoEditable(true)}
                className="btn-secondary gap-1.5 text-xs w-full justify-center"
              >
                <Pencil size={12} />Edit Info
              </button>
            ) : (
              <div className="flex gap-1.5">
                <button
                  onClick={() => setInfoEditable(false)}
                  className="btn-ghost text-xs flex-1 justify-center"
                >
                  Cancel
                </button>
                <button
                  onClick={() => updateProjectInfo.mutate()}
                  disabled={updateProjectInfo.isPending}
                  className="btn-primary gap-1 text-xs flex-1 justify-center"
                >
                  <Save size={12} />{updateProjectInfo.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Add Item Toolbar ────────────────────────────────────────────────── */}
      <div className="border-b border-[var(--border)] bg-[var(--surface-1)] px-5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={docName}
            onChange={e => setDocName(e.target.value)}
            placeholder="Document Name"
            className="input-field h-9 min-w-[160px] flex-1 text-sm"
          />
          <input
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="Description"
            className="input-field h-9 min-w-[140px] flex-[1.2] text-sm"
          />
          <select value={folder} onChange={e => setFolder(e.target.value)} className="input-field h-9 text-sm min-w-[130px]">
            {folderOptions.map(f => <option key={f}>{f}</option>)}
          </select>
          <div className="flex items-center gap-1.5 shrink-0">
            <button disabled={!docName.trim() || createItem.isPending} onClick={() => createItem.mutate()} className="btn-primary gap-1 text-xs h-9">
              <Plus size={13} />Add Item
            </button>
            <button onClick={attachFile} className="btn-secondary gap-1 text-xs h-9">
              <Paperclip size={13} />Attach File
            </button>
            <button disabled={!selectedItem || updateItem.isPending} onClick={() => selectedItem && updateItem.mutate(selectedItem.id)} className="btn-secondary text-xs h-9 px-3">
              Update
            </button>
            <button disabled={!selectedItem || deleteItem.isPending} onClick={deleteSelectedItem} className="btn-danger gap-1 text-xs h-9">
              <Trash2 size={13} />Delete Item
            </button>
          </div>
        </div>

        {/* Secondary action row */}
        <div className="mt-2 flex items-center gap-0.5 flex-wrap">
          <ToolBtn icon={Link2} label="Open File" disabled={!attachmentPath} onClick={() => openPath(attachmentPath)} />
          <ToolBtn icon={Pencil} label="Rename File" disabled={!attachmentPath} onClick={renameAttachedFile} />
          <ToolBtn icon={Trash2} label="Delete File" disabled={!attachmentPath} onClick={deleteAttachedFile} danger />
          <span className="mx-1 h-4 w-px bg-[var(--border)] shrink-0" />
          <ToolBtn icon={FolderCog} label="Manage Folders" onClick={() => setManageFoldersOpen(true)} />
          <ToolBtn icon={RefreshCw} label="Refresh" onClick={() => qc.invalidateQueries({ queryKey: ['project-checklist', projectId] })} />
          <ToolBtn icon={BookOpen} label="Apply Template" onClick={() => { setTemplateSearch(''); setApplyTemplateOpen(true); }} />
          <ToolBtn
            icon={Download}
            label={corrigendumStatus === 'running' ? 'Checking…' : 'Check for Corrigendum'}
            onClick={handleCheckCorrigendum}
            disabled={corrigendumStatus === 'running'}
            active={corrigendumStatus === 'done'}
          />
          <span className="mx-1 h-4 w-px bg-[var(--border)] shrink-0" />
          <ToolBtn icon={Save} label="Save Template" onClick={() => { setSaveTemplateForm(f => ({ ...f, template_name: String(project?.title || ''), organization: String(project?.client_name || '') })); setSaveTemplateOpen(true); }} />

          {/* Corrigendum status inline */}
          {corrigendumStatus !== 'idle' && (
            <span className={cn(
              'ml-2 inline-flex items-center gap-1 text-[11px] rounded-md px-2 py-1',
              corrigendumStatus === 'done' && 'bg-emerald-500/10 text-emerald-400',
              corrigendumStatus === 'error' && 'bg-rose-500/10 text-rose-400',
              corrigendumStatus === 'running' && 'text-[var(--text-muted)]'
            )}>
              {corrigendumStatus === 'done' && <CheckCircle2 size={11} />}
              {corrigendumStatus === 'error' && <AlertCircle size={11} />}
              {corrigendumMsg}
            </span>
          )}
        </div>
      </div>

      {/* ── Main Content ────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">

        {/* Table */}
        <div className="min-w-0 flex-1 overflow-auto">
          {checklistLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Spinner size={18} className="text-[var(--accent)]" />
              <p className="text-xs text-[var(--text-muted)]">Loading checklist…</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-12">SR</th>
                  <th>Document Name</th>
                  <th>Description</th>
                  <th className="w-32">Status</th>
                  <th>Attachment</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((g, gidx) => (
                  <Fragment key={`group-${g.name}-${gidx}`}>
                    {/* Folder header row */}
                    <tr className="group/folder">
                      <td className="bg-[var(--surface-2)]/60 py-1.5">
                        <span className="text-[10px] font-bold text-[var(--text-muted)]">{gidx + 1}</span>
                      </td>
                      <td colSpan={4} className="bg-[var(--surface-2)]/60 py-1.5">
                        <div className="flex items-center gap-2">
                          <FolderOpen size={13} className="text-[var(--accent)]/60 shrink-0" />
                          <span className="text-xs font-semibold text-[var(--text)]">{g.name}</span>
                          <span className="text-[10px] text-[var(--text-muted)] ml-1">
                            {g.rows.filter(r => r.status === 'Completed').length}/{g.rows.length}
                          </span>
                        </div>
                      </td>
                    </tr>

                    {/* Item rows */}
                    {g.rows.map((item, i) => (
                      <tr
                        key={item.id}
                        onClick={() => setSelectedId(item.id === selectedId ? null : item.id)}
                        className={cn('cursor-pointer group/row', item.id === selectedId && 'row-selected')}
                      >
                        <td className="text-center text-[var(--text-muted)] text-xs">{i + 1}</td>
                        <td>
                          <p className={cn('text-sm', item.status === 'Completed' && 'text-[var(--text-muted)]')}>{item.req_file_name || '-'}</p>
                        </td>
                        <td className="text-xs text-[var(--text-muted)]">{item.description || '-'}</td>
                        <td>
                          <Badge variant={item.status === 'Completed' ? 'success' : 'muted'}>
                            {item.status}
                          </Badge>
                        </td>
                        <td>
                          {item.linked_file_path ? (
                            <div className="flex items-center gap-1.5">
                              <FileText size={11} className="shrink-0 text-[var(--accent)]/60" />
                              <span className="truncate text-xs text-[var(--text-muted)] max-w-[200px]">{fileNameOnly(item.linked_file_path)}</span>
                            </div>
                          ) : <span className="text-xs text-[var(--text-muted)]/40">—</span>}
                        </td>
                      </tr>
                    ))}

                    {/* Empty folder */}
                    {g.rows.length === 0 && (
                      <tr>
                        <td />
                        <td colSpan={4} className="py-2 text-xs text-[var(--text-muted)]/50 italic">No items in this folder</td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {(checklist || []).length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState icon={FolderOpen} title="No items" description="Add first document item above." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Preview Panel ─────────────────────────────────────────────────── */}
        <div
          className="relative shrink-0 border-l border-[var(--border)] bg-[var(--surface-0)]"
          style={{ width: previewCollapsed ? 16 : previewWidth }}
        >
          {/* Collapse toggle */}
          <button
            onClick={() => setPreviewCollapsed(v => !v)}
            className="absolute -left-3 top-1/2 z-10 flex h-10 w-3 -translate-y-1/2 items-center justify-center rounded-l border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            title={previewCollapsed ? 'Show preview' : 'Hide preview'}
          >
            {previewCollapsed ? <ChevronLeft size={11} /> : <ChevronRight size={11} />}
          </button>

          {/* Resize handle */}
          {!previewCollapsed && (
            <div className="absolute -left-1 top-0 h-full w-2 cursor-col-resize hover:bg-[var(--accent)]/20 transition-colors"
              onMouseDown={e => { e.preventDefault(); startPreviewResize(e.clientX); }} title="Resize preview" />
          )}

          <aside className={cn('h-full overflow-auto p-4', previewCollapsed && 'hidden')}>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Preview</h4>
            {!selectedItem ? (
              <p className="text-xs text-[var(--text-muted)]">Select a row to preview details.</p>
            ) : (
              <div className="space-y-3">
                {/* Meta cards */}
                {[
                  { label: 'Document', value: selectedItem.req_file_name },
                  { label: 'Description', value: selectedItem.description },
                  { label: 'Folder', value: selectedItem.subfolder },
                  { label: 'Attachment', value: attachmentName },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] mb-0.5">{label}</p>
                    <p className="text-xs text-[var(--text)] break-all">{value || '—'}</p>
                  </div>
                ))}

                {/* Status badge */}
                <div className="flex items-center gap-2">
                  <Badge variant={selectedItem.status === 'Completed' ? 'success' : 'muted'}>{selectedItem.status}</Badge>
                </div>

                {/* File preview */}
                {isImage && attachmentPath && (
                  <img src={toFileUrl(attachmentPath)} alt="Attachment" className="max-h-56 w-full rounded-lg border border-[var(--border)] object-contain" />
                )}
                {isPdf && attachmentPath && (
                  <iframe src={toFileUrl(attachmentPath)} className="h-64 w-full rounded-lg border border-[var(--border)] bg-white" title="PDF preview" />
                )}
                {isTextLike && (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-2">
                    {textPreview
                      ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[11px] text-[var(--text)]">{textPreview}</pre>
                      : <p className="text-xs text-[var(--text-muted)]">{textPreviewError || 'Loading preview…'}</p>
                    }
                  </div>
                )}
                {!isImage && !isPdf && !isTextLike && attachmentPath && (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 text-xs text-[var(--text-muted)] text-center">
                    <FileText size={24} className="mx-auto mb-1 opacity-30" />
                    Preview not available for <code>.{ext || 'file'}</code><br />Use <em>Open File</em> instead.
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>

      {/* ── Save Template Modal ─────────────────────────────────────────────── */}
      {saveTemplateOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface-0)] p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Save Checklist as Template</h3>
              <button onClick={() => setSaveTemplateOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">No.</label>
                  <input value={saveTemplateForm.template_no} onChange={e => setSaveTemplateForm(f => ({ ...f, template_no: e.target.value }))} placeholder="1" className="input-field h-8 w-full text-xs" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Organization *</label>
                  <input value={saveTemplateForm.organization} onChange={e => setSaveTemplateForm(f => ({ ...f, organization: e.target.value }))} className="input-field h-8 w-full text-xs" />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Template Name *</label>
                <input value={saveTemplateForm.template_name} onChange={e => setSaveTemplateForm(f => ({ ...f, template_name: e.target.value }))} className="input-field h-8 w-full text-xs" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Description</label>
                <input value={saveTemplateForm.description} onChange={e => setSaveTemplateForm(f => ({ ...f, description: e.target.value }))} className="input-field h-8 w-full text-xs" />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2 border-t border-[var(--border)] pt-3">
              <button onClick={() => setSaveTemplateOpen(false)} className="btn-ghost text-xs">Cancel</button>
              <button onClick={handleSaveTemplate} disabled={savingTemplate || !saveTemplateForm.template_name.trim() || !saveTemplateForm.organization.trim()} className="btn-primary gap-1 text-xs">
                <Save size={12} />{savingTemplate ? 'Saving…' : 'Save Template'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Apply Template Modal ────────────────────────────────────────────── */}
      {applyTemplateOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--surface-0)] p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Apply Template to Project</h3>
              <button onClick={() => setApplyTemplateOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"><X size={16} /></button>
            </div>
            {/* ── FIXED: search icon with correct pl- padding so text doesn't overlap ── */}
            <div className="relative mb-3">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={templateSearch}
                onChange={e => setTemplateSearch(e.target.value)}
                placeholder="Search templates…"
                className="input-field h-9 w-full pl-9 text-sm"
              />
              {templateSearch && (
                <button onClick={() => setTemplateSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)]"><X size={13} /></button>
              )}
            </div>
            <div className="max-h-72 overflow-auto space-y-1.5">
              {(allTemplates || [])
                .filter(t => !templateSearch || t.template_name.toLowerCase().includes(templateSearch.toLowerCase()) || t.organization.toLowerCase().includes(templateSearch.toLowerCase()))
                .map(t => (
                  <div key={t.id} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2.5 hover:bg-[var(--surface-1)] transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text)] truncate">{t.template_name}</p>
                      <p className="text-xs text-[var(--text-muted)]">{t.organization}{t.template_no ? ` · #${t.template_no}` : ''}</p>
                    </div>
                    <button onClick={() => handleApplyTemplate(t.id)} className="btn-primary text-xs gap-1 shrink-0 ml-3">
                      <Plus size={12} />Apply
                    </button>
                  </div>
                ))}
              {!(allTemplates || []).filter(t => !templateSearch || t.template_name.toLowerCase().includes(templateSearch.toLowerCase()) || t.organization.toLowerCase().includes(templateSearch.toLowerCase())).length && (
                <p className="py-6 text-center text-xs text-[var(--text-muted)]">No templates found.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Manage Folders Modal ────────────────────────────────────────────── */}
      {manageFoldersOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-xl border border-[var(--border)] bg-[var(--surface-0)] p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Manage Folders</h3>
              <button onClick={() => setManageFoldersOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {[
                {
                  title: 'Add Folder',
                  content: (
                    <div className="flex gap-2">
                      <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="Folder name" className="input-field h-8 flex-1 text-xs" />
                      <button onClick={addFolder} className="btn-primary text-xs px-3">Add</button>
                    </div>
                  ),
                },
                {
                  title: 'Rename Folder',
                  content: (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <select value={renameFrom} onChange={e => setRenameFrom(e.target.value)} className="input-field h-8 text-xs"><option value="">From…</option>{folderOptions.map(f => <option key={`rf-${f}`}>{f}</option>)}</select>
                        <input value={renameTo} onChange={e => setRenameTo(e.target.value)} placeholder="New name" className="input-field h-8 text-xs" />
                      </div>
                      <button onClick={renameFolder} className="btn-secondary mt-2 text-xs">Rename</button>
                    </>
                  ),
                },
                {
                  title: 'Move Items Between Folders',
                  content: (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <select value={moveFrom} onChange={e => setMoveFrom(e.target.value)} className="input-field h-8 text-xs"><option value="">From…</option>{folderOptions.map(f => <option key={`mf-${f}`}>{f}</option>)}</select>
                        <select value={moveTo} onChange={e => setMoveTo(e.target.value)} className="input-field h-8 text-xs"><option value="">To…</option>{folderOptions.map(f => <option key={`mt-${f}`}>{f}</option>)}</select>
                      </div>
                      <button onClick={moveFolderItems} className="btn-secondary mt-2 text-xs">Move</button>
                    </>
                  ),
                },
                {
                  title: 'Delete Folder',
                  content: (
                    <>
                      <div className="flex gap-2">
                        <select value={deleteFolderName} onChange={e => setDeleteFolderName(e.target.value)} className="input-field h-8 flex-1 text-xs"><option value="">Select folder…</option>{folderOptions.map(f => <option key={`df-${f}`}>{f}</option>)}</select>
                        <button onClick={deleteFolder} className="btn-danger text-xs px-3">Delete</button>
                      </div>
                      <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">Items will be moved to another available folder.</p>
                    </>
                  ),
                },
              ].map(({ title, content }) => (
                <div key={title} className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
                  <p className="mb-2 text-xs font-semibold text-[var(--text-muted)]">{title}</p>
                  {content}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
