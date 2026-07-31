import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  CheckSquare,
  Columns3,
  Download,
  ExternalLink,
  FileDown,
  Filter,
  FolderOpen,
  FolderPlus,
  Globe,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Square,
  Star,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { api, type Organization, type Tender, type Website } from '../lib/api';
import { useAppStore } from '../lib/store';
import { cn, formatINR } from '../lib/utils';
import { Badge, EmptyState, Spinner, StatusBadge, TimeBadge, Tooltip } from '../components/ui/shared';

type Tab = 'orgs' | 'active' | 'archived' | 'logs';
type SortDir = 'asc' | 'desc';
const TENDERS_VIEW_STATE_KEY = 'bm:tenders:view-state:v1';

function normalizeLogEntry(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function appendLogEntries(current: string[], entries: unknown[]): string[] {
  const next = [...current];
  for (const entry of entries) {
    const line = normalizeLogEntry(entry);
    if (line && next[next.length - 1] !== line) next.push(line);
  }
  return next;
}

function sanitizeFolderLeaf(value: string, fallback = 'Project') {
  const txt = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return txt || fallback;
}

function smartCmp(a: string, b: string): number {
  const na = parseFloat(a.replace(/[₹,\s]/g, ''));
  const nb = parseFloat(b.replace(/[₹,\s]/g, ''));
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;

  const monthMap: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const parseDate = (value: string) => {
    const m1 = value.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
    if (m1) {
      const month = monthMap[m1[2].toLowerCase()];
      if (month) return Number(m1[3]) * 10000 + month * 100 + Number(m1[1]);
    }
    const m2 = value.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (m2) return Number(m2[3]) * 10000 + Number(m2[2]) * 100 + Number(m2[1]);
    return null;
  };
  const da = parseDate(a);
  const db = parseDate(b);
  if (da !== null && db !== null) return da - db;
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function cSort<T>(items: T[], key: keyof T, dir: SortDir): T[] {
  return [...items].sort((a, b) => {
    const va = String(a[key] ?? '');
    const vb = String(b[key] ?? '');
    if ((!va || va === 'N/A') && vb && vb !== 'N/A') return 1;
    if (va && va !== 'N/A' && (!vb || vb === 'N/A')) return -1;
    if ((!va || va === 'N/A') && (!vb || vb === 'N/A')) return 0;
    const c = smartCmp(va, vb);
    return dir === 'asc' ? c : -c;
  });
}

function cSearch<T>(items: T[], q: string): T[] {
  if (!q.trim()) return items;
  const ql = q.toLowerCase();
  return items.filter((i) =>
    Object.values(i as Record<string, unknown>).some((v) => String(v ?? '').toLowerCase().includes(ql))
  );
}

function exportCSV(headers: string[], rows: Array<Record<string, unknown> | Tender>, keys: string[], filename: string) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(','), ...rows.map((r) => keys.map((k) => esc(String((r as Record<string, unknown>)[k] ?? ''))).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type TenderColumn = {
  key: string;
  label: string;
  w: number;
  fixed?: boolean;
};

const TENDER_COLUMNS: TenderColumn[] = [
  { key: '_bk', label: '', w: 36, fixed: true },
  { key: 'tender_id', label: 'Tender ID', w: 190 },
  { key: 'title', label: 'Title', w: 300 },
  { key: 'work_description', label: 'Work Desc', w: 300 },
  { key: 'tender_value', label: 'Value', w: 130 },
  { key: 'emd', label: 'EMD', w: 120 },
  { key: 'org_chain', label: 'Org Chain', w: 200 },
  { key: 'published_date', label: 'Published', w: 130 },
  { key: 'closing_date', label: 'Closing Date', w: 150 },
  { key: 'pre_bid_meeting_date', label: 'Pre-Bid', w: 130 },
  { key: 'location', label: 'Location', w: 180 },
  { key: 'tender_category', label: 'Category', w: 130 },
  { key: 'status', label: 'Status', w: 140 },
  { key: 'is_bookmarked', label: 'Bookmark', w: 90 },
  { key: '_time', label: 'Time Left', w: 100 },
  { key: '_act', label: '', w: 150, fixed: true },
];

const DEFAULT_HIDDEN = new Set(['work_description', 'emd', 'published_date', 'tender_category']);

function SortIcon({ current, dir, col }: { current: string; dir: SortDir; col: string }) {
  if (current !== col) return <ArrowUpDown size={11} className="ml-1 inline opacity-30" />;
  return dir === 'asc'
    ? <ArrowUp size={11} className="ml-1 inline" />
    : <ArrowDown size={11} className="ml-1 inline" />;
}

export default function TendersPage() {
  const qc = useQueryClient();

  const {
    tendersTable,
    tendersView,
    setTendersHiddenColumns,
    setTendersColumnOrder,
    setTendersViewTab,
    setTendersViewWebsite,
    setHighlightedOrgIdsForWebsite,
    setHighlightedTenderIdsForWebsite,
    setOrgColumnWidths,
    setTenderColumnWidth,
  } = useAppStore();

  const [searchByTab, setSearchByTab] = useState<Record<Tab, string>>(() => {
    try {
      const raw = localStorage.getItem(TENDERS_VIEW_STATE_KEY);
      if (!raw) return { orgs: '', active: '', archived: '', logs: '' };
      const parsed = JSON.parse(raw) as { searchByTab?: Partial<Record<Tab, string>> };
      return {
        orgs: String(parsed.searchByTab?.orgs || ''),
        active: String(parsed.searchByTab?.active || ''),
        archived: String(parsed.searchByTab?.archived || ''),
        logs: String(parsed.searchByTab?.logs || ''),
      };
    } catch {
      return { orgs: '', active: '', archived: '', logs: '' };
    }
  });
  const [sortCol, setSortCol] = useState(() => {
    try {
      const raw = localStorage.getItem(TENDERS_VIEW_STATE_KEY);
      if (!raw) return 'closing_date';
      const parsed = JSON.parse(raw) as { sortCol?: string };
      return String(parsed.sortCol || 'closing_date');
    } catch {
      return 'closing_date';
    }
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    try {
      const raw = localStorage.getItem(TENDERS_VIEW_STATE_KEY);
      if (!raw) return 'asc';
      const parsed = JSON.parse(raw) as { sortDir?: SortDir };
      return parsed.sortDir === 'desc' ? 'desc' : 'asc';
    } catch {
      return 'asc';
    }
  });
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(() => {
    try {
      const raw = localStorage.getItem(TENDERS_VIEW_STATE_KEY);
      if (!raw) return { org: '', loc: '', cat: '' };
      const parsed = JSON.parse(raw) as { filters?: { org?: string; loc?: string; cat?: string } };
      return {
        org: String(parsed.filters?.org || ''),
        loc: String(parsed.filters?.loc || ''),
        cat: String(parsed.filters?.cat || ''),
      };
    } catch {
      return { org: '', loc: '', cat: '' };
    }
  });
  const [showColsMenu, setShowColsMenu] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [showManage, setShowManage] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [logs, setLogs] = useState<string[]>(['[system] Ready.']);
  const [jobRunning, setJobRunning] = useState(false);
  const [orgFocusId, setOrgFocusId] = useState<number | null>(null);
  const [lastOrgClickedId, setLastOrgClickedId] = useState<number | null>(null);
  const [tenderFocusId, setTenderFocusId] = useState<number | null>(null);
  const [lastTenderClickedId, setLastTenderClickedId] = useState<number | null>(null);
  const [pendingCaptcha, setPendingCaptcha] = useState<{ request_id: string; image_base64: string; context: string } | null>(null);
  const [captchaInput, setCaptchaInput] = useState('');
  const [captchaSubmitting, setCaptchaSubmitting] = useState(false);
  const liveLogCursorRef = useRef<number>(0);

  const tab = tendersView.tab;
  const siteId = tendersView.selectedWebsiteId;
  const search = searchByTab[tab] || '';
  const selectedWebsiteId = siteId === 'ALL' ? null : siteId;

  const setSearch = (value: string) => setSearchByTab((prev) => ({ ...prev, [tab]: value }));

  useEffect(() => {
    let stopped = false;
    const mergeLines = (incoming: string[]) => {
      if (!incoming.length) return;
      setLogs((prev) => {
        const next = [...prev];
        for (const raw of incoming) {
          const line = String(raw || '').trim();
          if (!line) continue;
          if (next.length > 0 && next[next.length - 1] === line) continue;
          next.push(line);
        }
        return next;
      });
    };
    const poll = async () => {
      if (stopped) return;
      try {
        const res = await api.getLiveLogs(1200, liveLogCursorRef.current || 0);
        mergeLines(Array.isArray(res?.lines) ? res.lines : []);
        const nextSeq = Number((res as { next_seq?: number } | null)?.next_seq || 0);
        if (Number.isFinite(nextSeq) && nextSeq > 0) {
          liveLogCursorRef.current = nextSeq;
        }
      } catch {
        // ignore transient polling errors
      } finally {
        if (!stopped) setTimeout(poll, 700);
      }
    };
    poll();
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    let polling = false;
    const poll = async () => {
      if (stopped || polling || pendingCaptcha) return;
      polling = true;
      try {
        const captcha = await api.getPendingCaptcha();
        if (!stopped && captcha) {
          setCaptchaInput('');
          setPendingCaptcha(captcha);
          setTendersViewTab('logs');
        }
      } catch {
        // ignore transient polling errors
      } finally {
        polling = false;
      }
    };
    poll();
    const timer = window.setInterval(poll, 700);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [pendingCaptcha, setTendersViewTab]);

  useEffect(() => {
    try {
      localStorage.setItem(
        TENDERS_VIEW_STATE_KEY,
        JSON.stringify({
          searchByTab,
          sortCol,
          sortDir,
          filters,
        })
      );
    } catch {
      // ignore storage failures
    }
  }, [searchByTab, sortCol, sortDir, filters]);

  const { data: websites } = useQuery({ queryKey: ['websites'], queryFn: api.listWebsites });
  const { data: allOrgs } = useQuery({
    queryKey: ['all-orgs'],
    queryFn: async () => {
      if (!websites) return [] as Organization[];
      return (await Promise.all(websites.map((w) => api.listOrganizations(w.id)))).flat();
    },
    enabled: !!websites,
    placeholderData: (previousData) => previousData,
    retry: 2,
  });
  const { data: allTenders, isLoading: tendersLoading } = useQuery({
    queryKey: ['all-tenders'],
    queryFn: async () => {
      if (!websites) return [] as Tender[];
      return (await Promise.all(websites.map((w) => api.listTenders(w.id, { limit: 5000 })))).flat();
    },
    enabled: !!websites,
  });

  const orgRows = useMemo(() => {
    let list = allOrgs || [];
    if (selectedWebsiteId) list = list.filter((o) => o.website_id === selectedWebsiteId);
    return cSearch(list, search);
  }, [allOrgs, selectedWebsiteId, search]);
  const sortedOrgs = useMemo(
    () => cSort(
      orgRows,
      (sortCol === 'tender_count' ? 'tender_count' : sortCol === 'is_selected' ? 'is_selected' : 'name') as keyof Organization,
      sortDir
    ),
    [orgRows, sortCol, sortDir]
  );

  const tendersForSite = useMemo(() => {
    let list = allTenders || [];
    if (selectedWebsiteId) list = list.filter((t) => t.website_id === selectedWebsiteId);
    return list;
  }, [allTenders, selectedWebsiteId]);

  const activeTenders = useMemo(() => {
    let list = tendersForSite.filter((t) => !t.is_archived);
    list = cSearch(list, search);
    if (filters.org) list = list.filter((t) => (t.org_chain || '').toLowerCase().includes(filters.org.toLowerCase()));
    if (filters.loc) list = list.filter((t) => (t.location || '').toLowerCase().includes(filters.loc.toLowerCase()));
    if (filters.cat) list = list.filter((t) => (t.tender_category || '').toLowerCase().includes(filters.cat.toLowerCase()));
    return cSort(list, sortCol as keyof Tender, sortDir);
  }, [tendersForSite, search, filters, sortCol, sortDir]);

  const archivedTenders = useMemo(
    () => cSort(cSearch(tendersForSite.filter((t) => t.is_archived), search), sortCol as keyof Tender, sortDir),
    [tendersForSite, search, sortCol, sortDir]
  );

  const uniqueOrgs = useMemo(() =>
    [...new Set(tendersForSite.filter((t) => !t.is_archived).map((t) => t.org_chain).filter(Boolean) as string[])].sort()
  , [tendersForSite]);

  const uniqueLocs = useMemo(() =>
    [...new Set(tendersForSite.filter((t) => !t.is_archived).map((t) => t.location).filter(Boolean) as string[])].sort()
  , [tendersForSite]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['all-tenders'] });
    qc.invalidateQueries({ queryKey: ['all-orgs'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const toggleBookmark = useMutation({
    mutationFn: (t: Tender) => api.patchTender(t.id, { is_bookmarked: !t.is_bookmarked }),
    onSuccess: invalidate,
  });
  const toggleDownloadSelect = useMutation({
    mutationFn: (t: Tender) => api.patchTender(t.id, { is_downloaded: !t.is_downloaded }),
    onSuccess: invalidate,
  });
  const toggleOrgSelected = useMutation({
    mutationFn: (o: Organization) => api.toggleOrganization(o.id, !o.is_selected),
    onSuccess: invalidate,
  });

  const allActiveSelected = activeTenders.length > 0 && activeTenders.every((t) => t.is_downloaded);
  const selectAll = useMutation({
    mutationFn: async () => {
      await Promise.all(activeTenders.filter((t) => !t.is_downloaded).map((t) => api.patchTender(t.id, { is_downloaded: true })));
    },
    onSuccess: invalidate,
  });
  const deselectAll = useMutation({
    mutationFn: async () => {
      await Promise.all(activeTenders.filter((t) => t.is_downloaded).map((t) => api.patchTender(t.id, { is_downloaded: false })));
    },
    onSuccess: invalidate,
  });
  const addTendersToProjects = useMutation({
    mutationFn: async (tenders: Tender[]) => {
      const target = tenders || [];
      if (target.length === 0) return { created: 0, skipped: 0, total: 0 };
      const existingProjects = await api.listProjects('');
      const existingTenderIds = new Set(
        existingProjects
          .map((p) => String(p.source_tender_id || '').trim())
          .filter((v) => !!v)
      );
      let created = 0;
      let skipped = 0;
      for (const t of target) {
        const sourceTenderId = String(t.tender_id || '').trim();
        if (sourceTenderId && existingTenderIds.has(sourceTenderId)) {
          skipped += 1;
          continue;
        }
        const title = String(t.title || '').trim() || (sourceTenderId ? `Tender ${sourceTenderId}` : `Tender ${t.id}`);
        const createdProject = await api.createProject({
          title,
          client_name: String(t.org_chain || '').trim(),
          source_tender_id: sourceTenderId,
          project_value: String(t.tender_value || '').trim(),
          prebid: String(t.pre_bid_meeting_date || '').trim(),
          deadline: String(t.closing_date || '').trim(),
          description: String(t.work_description || '').trim(),
          status: 'Active',
        });
        let ensuredFolderPath = '';
        try {
          const ensured = await api.ensureProjectFolder(Number(createdProject.id));
          ensuredFolderPath = String(ensured?.folder_path || '').trim();
        } catch {
          // continue with fallback below
        }
        if (!ensuredFolderPath) {
          try {
            const refreshed = await api.getProject(Number(createdProject.id));
            ensuredFolderPath = String(refreshed?.folder_path || '').trim();
          } catch {
            // continue with desktop fallback below
          }
        }
        if (!ensuredFolderPath) {
          try {
            let rootFolder = '';
            try {
              const root = await api.getProjectsRootFolder(false);
              rootFolder = String(root?.root_folder || '').trim();
            } catch {
              rootFolder = '';
            }
            if (!rootFolder) rootFolder = 'backend/My_Tender_Projects';
            const leaf = sanitizeFolderLeaf(sourceTenderId || title || `Project_${createdProject.id}`, `Project_${createdProject.id}`);
            const folderTarget = `${rootFolder}${rootFolder.endsWith('\\') || rootFolder.endsWith('/') ? '' : '/'}${leaf}`;
            const desktop = (window as Window & {
              bidmanagerDesktop?: {
                ensureProjectFolders?: (path: string) => Promise<{ ok: boolean; path?: string; message?: string }>;
                writeJsonFile?: (payload: { filePath: string; data: unknown }) => Promise<{ ok: boolean; path?: string; message?: string }>;
              };
            }).bidmanagerDesktop;
            if (desktop?.ensureProjectFolders) {
              const mk = await desktop.ensureProjectFolders(folderTarget);
              if (mk?.ok && mk.path) {
                ensuredFolderPath = String(mk.path).trim();
                try {
                  await api.updateProject(Number(createdProject.id), { folder_path: ensuredFolderPath } as any);
                } catch {
                  // keep physical folder even if DB path update fails on old backend
                }
              }
            }
          } catch {
            // no-op
          }
        }
        if (!ensuredFolderPath) {
          setLogs((prev) => [...prev, `Warning: project ${createdProject.id} folder ensure did not return a path.`]);
        }
        try {
          const desktop = (window as Window & {
            bidmanagerDesktop?: {
              writeJsonFile?: (payload: { filePath: string; data: unknown }) => Promise<{ ok: boolean; path?: string; message?: string }>;
            };
          }).bidmanagerDesktop;
          if (desktop?.writeJsonFile && ensuredFolderPath) {
            const payload = {
              title,
              client_name: String(t.org_chain || '').trim(),
              source_tender_id: sourceTenderId,
              project_value: String(t.tender_value || '').trim(),
              prebid: String(t.pre_bid_meeting_date || '').trim(),
              deadline: String(t.closing_date || '').trim(),
              description: String(t.work_description || '').trim(),
              status: 'Active',
              folder_path: ensuredFolderPath,
              updated_at: new Date().toISOString(),
            };
            const p1 = `${ensuredFolderPath}${ensuredFolderPath.endsWith('\\') || ensuredFolderPath.endsWith('/') ? '' : '\\'}project_info.json`;
            await desktop.writeJsonFile({ filePath: p1, data: payload });
          }
        } catch {
          // best-effort only
        }
        if (sourceTenderId) existingTenderIds.add(sourceTenderId);
        created += 1;
      }
      return { created, skipped, total: target.length };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      setLogs((prev) => [
        ...prev,
        `Add to Projects completed: created=${result.created}, skipped=${result.skipped}, total=${result.total}.`,
      ]);
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      qc.invalidateQueries({ queryKey: ['projects'] });
      setLogs((prev) => [...prev, `Add to Projects failed: ${msg}`]);
    },
  });
  const bookmarkedActiveTenders = useMemo(
    () => activeTenders.filter((t) => t.is_bookmarked),
    [activeTenders]
  );
  const selectedForDownloadActiveTenders = useMemo(
    () => activeTenders.filter((t) => t.is_downloaded),
    [activeTenders]
  );

  const siteIds = useMemo(() => selectedWebsiteId ? [selectedWebsiteId] : (websites || []).map((w) => w.id), [selectedWebsiteId, websites]);

  const highlightedByWebsite = tendersView.highlightedOrgIdsByWebsite || {};
  const highlightedTenderByWebsite = tendersView.highlightedTenderIdsByWebsite || {};
  const highlightedCount = useMemo(() => {
    if (selectedWebsiteId) return (highlightedByWebsite[String(selectedWebsiteId)] || []).length;
    return Object.values(highlightedByWebsite).reduce((acc, ids) => acc + ids.length, 0);
  }, [selectedWebsiteId, highlightedByWebsite]);

  const checkedOrgCount = useMemo(() => {
    const src = allOrgs || [];
    return src.filter((o) => (!selectedWebsiteId || o.website_id === selectedWebsiteId) && o.is_selected).length;
  }, [allOrgs, selectedWebsiteId]);

  const chosenOrgGroups = useMemo(() => {
    const orgs = allOrgs || [];
    const groups = new Map<number, Set<number>>();
    for (const o of orgs) {
      if (selectedWebsiteId && o.website_id !== selectedWebsiteId) continue;
      if (o.is_selected) {
        if (!groups.has(o.website_id)) groups.set(o.website_id, new Set<number>());
        groups.get(o.website_id)!.add(o.id);
      }
    }
    Object.entries(highlightedByWebsite).forEach(([websiteKey, ids]) => {
      const websiteId = Number(websiteKey);
      if (!Number.isFinite(websiteId)) return;
      if (selectedWebsiteId && websiteId !== selectedWebsiteId) return;
      if (!groups.has(websiteId)) groups.set(websiteId, new Set<number>());
      ids.forEach((id) => groups.get(websiteId)!.add(id));
    });
    return [...groups.entries()].map(([websiteId, idSet]) => ({ websiteId, orgIds: [...idSet] }));
  }, [allOrgs, selectedWebsiteId, highlightedByWebsite]);

  const chosenOrgCount = useMemo(
    () => chosenOrgGroups.reduce((acc, g) => acc + g.orgIds.length, 0),
    [chosenOrgGroups]
  );

  const highlightedActiveTenders = useMemo(() => {
    return activeTenders.filter((t) => (highlightedTenderByWebsite[String(t.website_id)] || []).includes(t.id));
  }, [activeTenders, highlightedTenderByWebsite]);
  const downloadTargetActiveTenders = useMemo(() => {
    const byId = new Map<number, Tender>();
    highlightedActiveTenders.forEach((t) => byId.set(t.id, t));
    selectedForDownloadActiveTenders.forEach((t) => byId.set(t.id, t));
    return Array.from(byId.values());
  }, [highlightedActiveTenders, selectedForDownloadActiveTenders]);
  const selectedArchivedTenders = useMemo(
    () => archivedTenders.filter((t) => t.is_downloaded),
    [archivedTenders]
  );
  const highlightedArchivedTenders = useMemo(() => {
    return archivedTenders.filter((t) => (highlightedTenderByWebsite[String(t.website_id)] || []).includes(t.id));
  }, [archivedTenders, highlightedTenderByWebsite]);
  const resultTargetArchivedTenders = useMemo(() => {
    const byId = new Map<number, Tender>();
    highlightedArchivedTenders.forEach((t) => byId.set(t.id, t));
    selectedArchivedTenders.forEach((t) => byId.set(t.id, t));
    return Array.from(byId.values());
  }, [highlightedArchivedTenders, selectedArchivedTenders]);
  const archivedResultSiteIds = useMemo(
    () => Array.from(new Set(resultTargetArchivedTenders.map((t) => t.website_id))),
    [resultTargetArchivedTenders]
  );

  const runJob = useCallback(async (start: (site: number) => Promise<{ job_id: string }>, targetSites: number[]) => {
    if (jobRunning) return;
    setJobRunning(true);
    setTendersViewTab('logs');
    for (const sid of targetSites) {
      try {
        const { job_id } = await start(sid);
        let done = false;
        let seen = 0;
        while (!done) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const job: { status: string; logs?: string[]; error?: string } = await api.getJob(job_id);
          const newLogs = Array.isArray(job.logs) ? job.logs : [];
          if (newLogs.length > seen) {
            const fresh = newLogs.slice(seen);
            setLogs((prev) => appendLogEntries(prev, fresh));
            seen = newLogs.length;
          }
          if (job.status === 'completed') done = true;
          if (job.status === 'failed') {
            if (job.error) setLogs((prev) => appendLogEntries(prev, [job.error]));
            done = true;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLogs((prev) => [...prev, `Error: ${message}`]);
      }
    }
    invalidate();
    setJobRunning(false);
  }, [jobRunning, setTendersViewTab]);

  const runSingleJob = useCallback(async (start: () => Promise<{ job_id: string }>) => {
    if (jobRunning) return;
    setJobRunning(true);
    setTendersViewTab('logs');
    try {
      const { job_id } = await start();
      let done = false;
      let seen = 0;
      while (!done) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const job: { status: string; logs?: string[]; error?: string } = await api.getJob(job_id);
        const newLogs = Array.isArray(job.logs) ? job.logs : [];
        if (newLogs.length > seen) {
          const fresh = newLogs.slice(seen);
          setLogs((prev) => appendLogEntries(prev, fresh));
          seen = newLogs.length;
        }
        if (job.status === 'completed') done = true;
        if (job.status === 'failed') {
          if (job.error) setLogs((prev) => appendLogEntries(prev, [job.error]));
          done = true;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLogs((prev) => [...prev, `Error: ${message}`]);
    }
    invalidate();
    setJobRunning(false);
  }, [jobRunning, setTendersViewTab]);

  const openTenderFolder = useCallback(async (t: Tender) => {
    const folderPath = String(t.folder_path || '').trim();
    if (!folderPath) {
      setLogs((prev) => [...prev, `No folder path saved for tender ${t.tender_id || t.id}.`]);
      return;
    }
    try {
      const desktop = (window as Window & {
        bidmanagerDesktop?: {
          openPath?: (path: string) => Promise<{ ok: boolean; message?: string }>;
        };
      }).bidmanagerDesktop;
      if (!desktop?.openPath) {
        setLogs((prev) => [...prev, 'Open Folder is available in Electron desktop mode.']);
        return;
      }
      const result = await desktop.openPath(folderPath);
      if (!result?.ok) {
        setLogs((prev) => [...prev, `Open Folder failed: ${result?.message || 'Unknown error'}`]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLogs((prev) => [...prev, `Open Folder error: ${message}`]);
    }
  }, []);

  const downloadHighlightedTenders = useCallback(async (targets: Tender[]) => {
    if (jobRunning) return;
    if (!targets.length) {
      setLogs((prev) => [...prev, 'No highlighted tenders selected for download.']);
      return;
    }
    setJobRunning(true);
    setTendersViewTab('logs');
    for (const tender of targets) {
      try {
        const { job_id } = await api.downloadSingleTender(tender.id, 'full');
        let done = false;
        let seen = 0;
        while (!done) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const job: { status: string; logs?: string[]; error?: string } = await api.getJob(job_id);
          const newLogs = Array.isArray(job.logs) ? job.logs : [];
          if (newLogs.length > seen) {
            const fresh = newLogs.slice(seen);
            setLogs((prev) => appendLogEntries(prev, fresh));
            seen = newLogs.length;
          }
          if (job.status === 'completed') done = true;
          if (job.status === 'failed') {
            if (job.error) setLogs((prev) => appendLogEntries(prev, [job.error]));
            done = true;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLogs((prev) => [...prev, `Error: ${message}`]);
      }
    }
    invalidate();
    setJobRunning(false);
  }, [jobRunning, setTendersViewTab]);

  const fetchHighlightedTenders = useCallback(async () => {
    const groups = chosenOrgGroups;
    if (groups.length === 0) {
      setLogs((prev) => [...prev, 'No selected organizations found for tender fetch.']);
      return;
    }
    if (jobRunning) return;
    setJobRunning(true);
    setTendersViewTab('logs');
    for (const group of groups) {
      try {
        const { job_id } = await api.fetchTendersForOrgs(group.websiteId, group.orgIds);
        let done = false;
        let seen = 0;
        while (!done) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const job: { status: string; logs?: string[]; error?: string } = await api.getJob(job_id);
          const newLogs = Array.isArray(job.logs) ? job.logs : [];
          if (newLogs.length > seen) {
            const fresh = newLogs.slice(seen);
            setLogs((prev) => appendLogEntries(prev, fresh));
            seen = newLogs.length;
          }
          if (job.status === 'completed') done = true;
          if (job.status === 'failed') {
            if (job.error) setLogs((prev) => appendLogEntries(prev, [job.error]));
            done = true;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLogs((prev) => [...prev, `Error: ${message}`]);
      }
    }
    invalidate();
    setJobRunning(false);
  }, [chosenOrgGroups, jobRunning, setTendersViewTab]);

  const submitCaptcha = useCallback(async () => {
    if (!pendingCaptcha) return;
    const text = captchaInput.trim();
    if (!text) return;
    setCaptchaSubmitting(true);
    try {
      await api.submitCaptcha(pendingCaptcha.request_id, text);
      setPendingCaptcha(null);
      setCaptchaInput('');
      setLogs((prev) => [...prev, 'Manual CAPTCHA submitted.']);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLogs((prev) => [...prev, `Manual CAPTCHA submit failed: ${message}`]);
    } finally {
      setCaptchaSubmitting(false);
    }
  }, [captchaInput, pendingCaptcha]);

  const hiddenColumns = useMemo(
    () => new Set(tendersTable.hiddenColumns?.length ? tendersTable.hiddenColumns : Array.from(DEFAULT_HIDDEN)),
    [tendersTable.hiddenColumns]
  );
  const columnOrder = useMemo(
    () => tendersTable.columnOrder?.length ? tendersTable.columnOrder : TENDER_COLUMNS.map((c) => c.key as string),
    [tendersTable.columnOrder]
  );

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const toggleTenderColumn = (key: string) => {
    const next = new Set(hiddenColumns);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setTendersHiddenColumns(Array.from(next));
  };

  const moveColumn = (from: number, to: number) => {
    if (from === to) return;
    const next = [...columnOrder];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setTendersColumnOrder(next);
  };

  const orderedTenderCols = useMemo(() => {
    const byKey = new Map(TENDER_COLUMNS.map((c) => [c.key, c]));
    return columnOrder.map((k) => byKey.get(k)).filter(Boolean) as TenderColumn[];
  }, [columnOrder]);
  const visibleTenderCols = orderedTenderCols.filter((c) => c.fixed || !hiddenColumns.has(c.key));
  const tenderColWidths = tendersView.tenderColumnWidths || {};
  const getTenderColWidth = useCallback((col: TenderColumn) => {
    const stored = tenderColWidths[col.key];
    return Number.isFinite(stored) && stored > 0 ? stored : col.w;
  }, [tenderColWidths]);
  const startTenderColumnResize = (col: TenderColumn, startX: number) => {
    const minByKey: Record<string, number> = {
      _bk: 28,
      _act: 60,
      _time: 80,
      is_downloaded: 60,
      tender_id: 120,
      title: 180,
    };
    const minWidth = minByKey[col.key] || 90;
    const startW = getTenderColWidth(col);
    const onMove = (evt: MouseEvent) => {
      const delta = evt.clientX - startX;
      const next = Math.max(minWidth, startW + delta);
      setTenderColumnWidth(col.key, next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const exportCurrentTenders = () => {
    const rows = tab === 'archived' ? archivedTenders : activeTenders;
    const cols = visibleTenderCols.filter((c) => !['_bk', '_act', '_time'].includes(c.key));
    exportCSV(cols.map((c) => c.label), rows, cols.map((c) => c.key), `tenders_${tab}_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const clearVisibleOrgHighlights = useCallback(() => {
    const visibleWebsiteIds = Array.from(new Set(sortedOrgs.map((o) => o.website_id)));
    visibleWebsiteIds.forEach((websiteId) => {
      if ((highlightedByWebsite[String(websiteId)] || []).length > 0) {
        setHighlightedOrgIdsForWebsite(websiteId, []);
      }
    });
  }, [sortedOrgs, highlightedByWebsite, setHighlightedOrgIdsForWebsite]);

  const applyRangeSelection = useCallback((org: Organization, additive: boolean) => {
    if (!lastOrgClickedId) return false;
    const key = String(org.website_id);
    const rowsInWebsite = sortedOrgs.filter((x) => x.website_id === org.website_id);
    const anchorIndex = rowsInWebsite.findIndex((x) => x.id === lastOrgClickedId);
    const currentIndex = rowsInWebsite.findIndex((x) => x.id === org.id);
    if (anchorIndex < 0 || currentIndex < 0) return false;
    const start = Math.min(anchorIndex, currentIndex);
    const end = Math.max(anchorIndex, currentIndex);
    const rangeIds = rowsInWebsite.slice(start, end + 1).map((x) => x.id);
    const current = highlightedByWebsite[key] || [];
    const next = additive ? Array.from(new Set([...current, ...rangeIds])) : rangeIds;
    if (!additive) clearVisibleOrgHighlights();
    setHighlightedOrgIdsForWebsite(org.website_id, next);
    setOrgFocusId(org.id);
    return true;
  }, [clearVisibleOrgHighlights, highlightedByWebsite, lastOrgClickedId, setHighlightedOrgIdsForWebsite, sortedOrgs]);

  const handleOrgRowClick = (org: Organization, evt: React.MouseEvent<HTMLTableRowElement>) => {
    const ctrlLike = evt.ctrlKey || evt.metaKey;
    const key = String(org.website_id);
    const current = highlightedByWebsite[key] || [];
    if (evt.shiftKey) {
      const didSelectRange = applyRangeSelection(org, ctrlLike);
      if (didSelectRange) {
        setLastOrgClickedId(org.id);
        return;
      }
    }
    if (ctrlLike) {
      const exists = current.includes(org.id);
      const next = exists ? current.filter((id) => id !== org.id) : [...current, org.id];
      setHighlightedOrgIdsForWebsite(org.website_id, next);
      setOrgFocusId(org.id);
      setLastOrgClickedId(org.id);
      return;
    }
    if (current.includes(org.id) && current.length === 1) {
      clearVisibleOrgHighlights();
      setOrgFocusId(org.id);
      setLastOrgClickedId(org.id);
      return;
    }
    clearVisibleOrgHighlights();
    setHighlightedOrgIdsForWebsite(org.website_id, [org.id]);
    setOrgFocusId(org.id);
    setLastOrgClickedId(org.id);
  };

  const orgWidths = tendersView.orgColumnWidths;
  const startOrgColumnResize = (col: 'name' | 'tenders' | 'select', startX: number) => {
    const minByCol = { name: 220, tenders: 90, select: 80 };
    const startW = orgWidths[col];
    const onMove = (evt: MouseEvent) => {
      const delta = evt.clientX - startX;
      const next = Math.max(minByCol[col], startW + delta);
      if (col === 'name') setOrgColumnWidths({ name: next });
      if (col === 'tenders') setOrgColumnWidths({ tenders: next });
      if (col === 'select') setOrgColumnWidths({ select: next });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    if (orgFocusId === null) return;
    if (!sortedOrgs.some((o) => o.id === orgFocusId)) setOrgFocusId(null);
  }, [orgFocusId, sortedOrgs]);

  const onOrgKeyDown = (evt: React.KeyboardEvent<HTMLDivElement>) => {
    if (tab !== 'orgs') return;
    if (sortedOrgs.length === 0) return;

    const currentIndex = orgFocusId ? sortedOrgs.findIndex((o) => o.id === orgFocusId) : -1;
    const key = evt.key;

    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
      evt.preventDefault();
      const ctrlLike = evt.ctrlKey || evt.metaKey;
      let nextIndex = currentIndex < 0 ? 0 : currentIndex;
      if (key === 'ArrowDown') nextIndex = ctrlLike ? sortedOrgs.length - 1 : Math.min(sortedOrgs.length - 1, nextIndex + 1);
      if (key === 'ArrowUp') nextIndex = ctrlLike ? 0 : Math.max(0, nextIndex - 1);
      if (key === 'Home') nextIndex = 0;
      if (key === 'End') nextIndex = sortedOrgs.length - 1;
      const nextOrg = sortedOrgs[nextIndex];
      if (!nextOrg) return;

      // Excel-style: Ctrl+Shift+Up/Down selects from the current anchor to the
      // top/bottom of the list (scoped to the anchor's website group).
      if (ctrlLike && evt.shiftKey && (key === 'ArrowDown' || key === 'ArrowUp')) {
        const anchorOrg =
          (lastOrgClickedId && sortedOrgs.find((o) => o.id === lastOrgClickedId)) ||
          (orgFocusId && sortedOrgs.find((o) => o.id === orgFocusId)) ||
          nextOrg;
        const rowsInWebsite = sortedOrgs.filter((x) => x.website_id === anchorOrg.website_id);
        const anchorIndex = rowsInWebsite.findIndex((x) => x.id === anchorOrg.id);
        if (anchorIndex >= 0 && rowsInWebsite.length > 0) {
          const goingDown = key === 'ArrowDown';
          const start = goingDown ? anchorIndex : 0;
          const end = goingDown ? rowsInWebsite.length - 1 : anchorIndex;
          const rangeIds = rowsInWebsite.slice(start, end + 1).map((x) => x.id);
          setHighlightedOrgIdsForWebsite(anchorOrg.website_id, rangeIds);
          setLastOrgClickedId(anchorOrg.id);
          setOrgFocusId(goingDown ? rowsInWebsite[rowsInWebsite.length - 1].id : rowsInWebsite[0].id);
        }
        return;
      }

      setOrgFocusId(nextOrg.id);
      return;
    }

    if (evt.code !== 'Space' && key !== ' ') return;
    evt.preventDefault();

    const focusedOrg = (orgFocusId && sortedOrgs.find((o) => o.id === orgFocusId)) || sortedOrgs[0];
    if (!focusedOrg) return;
    const ctrlLike = evt.ctrlKey || evt.metaKey;
    if (evt.shiftKey) {
      const didSelectRange = applyRangeSelection(focusedOrg, ctrlLike);
      if (didSelectRange) {
        setLastOrgClickedId(focusedOrg.id);
        return;
      }
    }
    const websiteKey = String(focusedOrg.website_id);
    const current = highlightedByWebsite[websiteKey] || [];
    if (ctrlLike) {
      const exists = current.includes(focusedOrg.id);
      const next = exists ? current.filter((id) => id !== focusedOrg.id) : [...current, focusedOrg.id];
      setHighlightedOrgIdsForWebsite(focusedOrg.website_id, next);
    } else {
      clearVisibleOrgHighlights();
      setHighlightedOrgIdsForWebsite(focusedOrg.website_id, [focusedOrg.id]);
    }
    setOrgFocusId(focusedOrg.id);
    setLastOrgClickedId(focusedOrg.id);
  };

  const clearVisibleTenderHighlights = useCallback(() => {
    const visibleWebsiteIds = Array.from(new Set(activeTenders.map((t) => t.website_id)));
    visibleWebsiteIds.forEach((websiteId) => {
      if ((highlightedTenderByWebsite[String(websiteId)] || []).length > 0) {
        setHighlightedTenderIdsForWebsite(websiteId, []);
      }
    });
  }, [activeTenders, highlightedTenderByWebsite, setHighlightedTenderIdsForWebsite]);

  const applyTenderRangeSelection = useCallback((tender: Tender, additive: boolean) => {
    if (!lastTenderClickedId) return false;
    const key = String(tender.website_id);
    const rowsInWebsite = activeTenders.filter((x) => x.website_id === tender.website_id);
    const anchorIndex = rowsInWebsite.findIndex((x) => x.id === lastTenderClickedId);
    const currentIndex = rowsInWebsite.findIndex((x) => x.id === tender.id);
    if (anchorIndex < 0 || currentIndex < 0) return false;
    const start = Math.min(anchorIndex, currentIndex);
    const end = Math.max(anchorIndex, currentIndex);
    const rangeIds = rowsInWebsite.slice(start, end + 1).map((x) => x.id);
    const current = highlightedTenderByWebsite[key] || [];
    const next = additive ? Array.from(new Set([...current, ...rangeIds])) : rangeIds;
    if (!additive) clearVisibleTenderHighlights();
    setHighlightedTenderIdsForWebsite(tender.website_id, next);
    setTenderFocusId(tender.id);
    return true;
  }, [activeTenders, clearVisibleTenderHighlights, highlightedTenderByWebsite, lastTenderClickedId, setHighlightedTenderIdsForWebsite]);

  const handleTenderRowClick = (tender: Tender, evt: React.MouseEvent<HTMLTableRowElement>) => {
    if (tab !== 'active') return;
    const ctrlLike = evt.ctrlKey || evt.metaKey;
    const key = String(tender.website_id);
    const current = highlightedTenderByWebsite[key] || [];
    if (evt.shiftKey) {
      const didSelectRange = applyTenderRangeSelection(tender, ctrlLike);
      if (didSelectRange) {
        setLastTenderClickedId(tender.id);
        return;
      }
    }
    if (ctrlLike) {
      const exists = current.includes(tender.id);
      const next = exists ? current.filter((id) => id !== tender.id) : [...current, tender.id];
      setHighlightedTenderIdsForWebsite(tender.website_id, next);
      setTenderFocusId(tender.id);
      setLastTenderClickedId(tender.id);
      return;
    }
    if (current.includes(tender.id) && current.length === 1) {
      clearVisibleTenderHighlights();
      setTenderFocusId(tender.id);
      setLastTenderClickedId(tender.id);
      return;
    }
    clearVisibleTenderHighlights();
    setHighlightedTenderIdsForWebsite(tender.website_id, [tender.id]);
    setTenderFocusId(tender.id);
    setLastTenderClickedId(tender.id);
  };

  useEffect(() => {
    if (tenderFocusId === null) return;
    if (!activeTenders.some((t) => t.id === tenderFocusId)) setTenderFocusId(null);
  }, [tenderFocusId, activeTenders]);

  const onTenderKeyDown = (evt: React.KeyboardEvent<HTMLDivElement>) => {
    if (tab !== 'active') return;
    if (activeTenders.length === 0) return;

    const currentIndex = tenderFocusId ? activeTenders.findIndex((t) => t.id === tenderFocusId) : -1;
    const key = evt.key;

    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
      evt.preventDefault();
      const ctrlLike = evt.ctrlKey || evt.metaKey;
      let nextIndex = currentIndex < 0 ? 0 : currentIndex;
      if (key === 'ArrowDown') nextIndex = ctrlLike ? activeTenders.length - 1 : Math.min(activeTenders.length - 1, nextIndex + 1);
      if (key === 'ArrowUp') nextIndex = ctrlLike ? 0 : Math.max(0, nextIndex - 1);
      if (key === 'Home') nextIndex = 0;
      if (key === 'End') nextIndex = activeTenders.length - 1;
      const nextTender = activeTenders[nextIndex];
      if (!nextTender) return;

      // Excel-style: Ctrl+Shift+Up/Down selects from the current anchor to the
      // top/bottom of the list (scoped to the anchor's website group).
      if (ctrlLike && evt.shiftKey && (key === 'ArrowDown' || key === 'ArrowUp')) {
        const anchorTender =
          (lastTenderClickedId && activeTenders.find((t) => t.id === lastTenderClickedId)) ||
          (tenderFocusId && activeTenders.find((t) => t.id === tenderFocusId)) ||
          nextTender;
        const rowsInWebsite = activeTenders.filter((x) => x.website_id === anchorTender.website_id);
        const anchorIndex = rowsInWebsite.findIndex((x) => x.id === anchorTender.id);
        if (anchorIndex >= 0 && rowsInWebsite.length > 0) {
          const goingDown = key === 'ArrowDown';
          const start = goingDown ? anchorIndex : 0;
          const end = goingDown ? rowsInWebsite.length - 1 : anchorIndex;
          const rangeIds = rowsInWebsite.slice(start, end + 1).map((x) => x.id);
          setHighlightedTenderIdsForWebsite(anchorTender.website_id, rangeIds);
          setLastTenderClickedId(anchorTender.id);
          setTenderFocusId(goingDown ? rowsInWebsite[rowsInWebsite.length - 1].id : rowsInWebsite[0].id);
        }
        return;
      }

      setTenderFocusId(nextTender.id);
      return;
    }

    if (evt.code !== 'Space' && key !== ' ') return;
    evt.preventDefault();

    const focusedTender = (tenderFocusId && activeTenders.find((t) => t.id === tenderFocusId)) || activeTenders[0];
    if (!focusedTender) return;
    const ctrlLike = evt.ctrlKey || evt.metaKey;
    if (evt.shiftKey) {
      const didSelectRange = applyTenderRangeSelection(focusedTender, ctrlLike);
      if (didSelectRange) {
        setLastTenderClickedId(focusedTender.id);
        return;
      }
    }
    const websiteKey = String(focusedTender.website_id);
    const current = highlightedTenderByWebsite[websiteKey] || [];
    if (ctrlLike) {
      const exists = current.includes(focusedTender.id);
      const next = exists ? current.filter((id) => id !== focusedTender.id) : [...current, focusedTender.id];
      setHighlightedTenderIdsForWebsite(focusedTender.website_id, next);
    } else {
      clearVisibleTenderHighlights();
      setHighlightedTenderIdsForWebsite(focusedTender.website_id, [focusedTender.id]);
    }
    setTenderFocusId(focusedTender.id);
    setLastTenderClickedId(focusedTender.id);
  };

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'orgs', label: 'Organizations', count: orgRows.length },
    { key: 'active', label: 'Active Tenders', count: activeTenders.length },
    { key: 'archived', label: 'Archived', count: archivedTenders.length },
    { key: 'logs', label: 'Live Logs' },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-[var(--border)] bg-[var(--surface-0)] px-6 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-[var(--text)]">Online Tenders</h1>
          <div className="flex items-center gap-2">
            {jobRunning && <Spinner size={14} className="text-[var(--accent)]" />}
            <button onClick={() => setShowManage(true)} className="btn-ghost gap-1 text-xs"><SettingsIcon size={13} />Manage</button>
            <button onClick={() => setShowClearDialog(true)} className="btn-ghost gap-1 text-xs text-rose-400"><Trash2 size={13} />Clear</button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select value={String(siteId)} onChange={(e) => setTendersViewWebsite(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))} className="input-field h-8 w-48 text-sm">
            <option value="ALL">ALL: All Websites</option>
            {(websites || []).map((w) => <option key={w.id} value={w.id}>{w.id}: {w.name}</option>)}
          </select>
          <div className="relative max-w-sm flex-1">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="input-field h-8 w-full text-sm" />
            {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)]"><X size={14} /></button>}
          </div>
          <button onClick={() => setShowFilters((v) => !v)} className={cn('btn-ghost gap-1 text-xs', showFilters && 'bg-[var(--accent-bg)] text-[var(--accent)]')}><Filter size={13} />Filters</button>
          <div className="relative">
            <button onClick={() => setShowColsMenu((v) => !v)} className="btn-ghost gap-1 text-xs"><Columns3 size={13} />Columns</button>
            {showColsMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowColsMenu(false)} />
                <div className="card absolute right-0 top-8 z-50 max-h-80 w-64 overflow-auto border border-[var(--border)] p-2 shadow-xl">
                  <p className="mb-1 border-b border-[var(--border)] px-2 pb-1 text-xs text-[var(--text-muted)]">Drag to reorder, toggle to show/hide</p>
                  {orderedTenderCols.filter((c) => !c.fixed).map((c, i) => (
                    <div key={c.key} draggable onDragStart={() => setDragIdx(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => {
                      if (dragIdx !== null) {
                        const nonFixed = orderedTenderCols.filter((x) => !x.fixed);
                        const fromKey = nonFixed[dragIdx]?.key;
                        const toKey = nonFixed[i]?.key;
                        if (fromKey && toKey) {
                          const fi = columnOrder.indexOf(fromKey);
                          const ti = columnOrder.indexOf(toKey);
                          if (fi >= 0 && ti >= 0) moveColumn(fi, ti);
                        }
                      }
                      setDragIdx(null);
                    }} className={cn('flex cursor-grab items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--surface-1)]', dragIdx === i && 'opacity-50')}>
                      <span className="select-none cursor-grab text-[var(--text-muted)]">::</span>
                      <input type="checkbox" checked={!hiddenColumns.has(c.key)} onChange={() => toggleTenderColumn(c.key)} className="accent-[var(--accent)]" />
                      <span className="flex-1">{c.label || c.key}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <button onClick={exportCurrentTenders} className="btn-ghost gap-1 text-xs"><FileDown size={13} />Export CSV</button>
        </div>
        {showFilters && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Organization</label>
              <select value={filters.org} onChange={(e) => setFilters((f) => ({ ...f, org: e.target.value }))} className="input-field h-8 w-full text-xs">
                <option value="">All</option>
                {uniqueOrgs.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Location</label>
              <select value={filters.loc} onChange={(e) => setFilters((f) => ({ ...f, loc: e.target.value }))} className="input-field h-8 w-full text-xs">
                <option value="">All</option>
                {uniqueLocs.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Category</label>
              <input value={filters.cat} onChange={(e) => setFilters((f) => ({ ...f, cat: e.target.value }))} placeholder="e.g. Works" className="input-field h-8 w-full text-xs" />
            </div>
            <div className="flex items-end"><button onClick={() => setFilters({ org: '', loc: '', cat: '' })} className="btn-ghost text-xs">Clear</button></div>
          </div>
        )}
      </div>

      <div className="flex items-center border-b border-[var(--border)] bg-[var(--surface-0)] px-6">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTendersViewTab(t.key)} className={cn('border-b-2 px-4 py-2.5 text-sm font-medium transition-colors', tab === t.key ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]')}>
            {t.label}
            {t.count !== undefined && <span className={cn('ml-1.5 rounded-full px-1.5 py-0.5 text-xs', tab === t.key ? 'bg-[var(--accent-bg)] text-[var(--accent)]' : 'bg-[var(--surface-2)] text-[var(--text-muted)]')}>{t.count}</span>}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 py-1">
          {tab === 'orgs' && (
            <>
              <button disabled={jobRunning} onClick={() => runJob((id) => api.fetchOrganizations(id), siteIds)} className="btn-primary gap-1 text-xs"><Zap size={12} />Fetch Orgs</button>
              {(highlightedCount > 0 || checkedOrgCount > 0) && (
                <button disabled={jobRunning} onClick={fetchHighlightedTenders} className="btn-secondary gap-1 text-xs">
                  <Download size={12} />Fetch Tenders ({chosenOrgCount})
                </button>
              )}
            </>
          )}
          {tab === 'active' && (
            <>
              <button
                disabled={jobRunning || downloadTargetActiveTenders.length === 0}
                onClick={() => downloadHighlightedTenders(downloadTargetActiveTenders)}
                className={cn(
                  'gap-1 text-xs',
                  downloadTargetActiveTenders.length > 0 ? 'btn-primary' : 'btn-secondary opacity-60'
                )}
              >
                <Download size={12} />
                {`Download Selected (${downloadTargetActiveTenders.length})`}
              </button>
              <button disabled={bookmarkedActiveTenders.length === 0 || addTendersToProjects.isPending} onClick={() => addTendersToProjects.mutate(bookmarkedActiveTenders)} className="btn-ghost gap-1 text-xs"><FolderPlus size={12} />Add To Projects ({bookmarkedActiveTenders.length})</button>
              <button onClick={() => (allActiveSelected ? deselectAll.mutate() : selectAll.mutate())} className="btn-ghost gap-1 text-xs">{allActiveSelected ? <CheckSquare size={12} /> : <Square size={12} />}{allActiveSelected ? 'Deselect All' : 'Select All'}</button>
            </>
          )}
          {tab === 'archived' && (
            <>
              <button
                disabled={jobRunning || archivedResultSiteIds.length === 0}
                onClick={() => runJob((id) => api.downloadTenderResults(id), archivedResultSiteIds)}
                className={cn(
                  'gap-1 text-xs',
                  archivedResultSiteIds.length > 0
                    ? 'btn-primary !bg-emerald-600 hover:!bg-emerald-500'
                    : 'btn-secondary opacity-60'
                )}
              >
                <Download size={12} />
                {`Download Results (${resultTargetArchivedTenders.length})`}
              </button>
              <button disabled={jobRunning} onClick={() => runJob((id) => api.checkArchivedTenderStatus(id), siteIds)} className="btn-ghost gap-1 text-xs"><RefreshCw size={12} />Status</button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto" style={{ marginRight: '1px' }}>
        {tab === 'orgs' && (
          <div tabIndex={0} onKeyDown={onOrgKeyDown} className="outline-none">
            <table className="data-table" style={{ tableLayout: 'fixed', width: '100%' }}>
              <thead>
                <tr>
                  <th className="w-12">#</th>
                  <th style={{ width: orgWidths.name }} className="relative cursor-pointer" onClick={() => toggleSort('name')}>
                    <div className="flex items-center">Organization<SortIcon current={sortCol} dir={sortDir} col="name" /></div>
                    <div className="absolute right-0 top-0 h-full w-2 cursor-col-resize" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startOrgColumnResize('name', e.clientX); }} />
                  </th>
                  <th style={{ width: orgWidths.tenders }} className="relative cursor-pointer" onClick={() => toggleSort('tender_count')}>
                    <div className="flex items-center">Tenders<SortIcon current={sortCol} dir={sortDir} col="tender_count" /></div>
                    <div className="absolute right-0 top-0 h-full w-2 cursor-col-resize" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startOrgColumnResize('tenders', e.clientX); }} />
                  </th>
                  <th
                    style={{ width: orgWidths.select, textAlign: 'center' }}
                    className="relative cursor-pointer"
                    onClick={() => toggleSort('is_selected')}
                  >
                    <div className="flex items-center justify-center">Select<SortIcon current={sortCol} dir={sortDir} col="is_selected" /></div>
                    <div className="absolute right-0 top-0 h-full w-2 cursor-col-resize" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startOrgColumnResize('select', e.clientX); }} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedOrgs.map((o, i) => {
                  const highlighted = (highlightedByWebsite[String(o.website_id)] || []).includes(o.id);
                  return (
                    <tr key={o.id} onClick={(e) => handleOrgRowClick(o, e)} className={cn(
                      'cursor-pointer transition-colors',
                      highlighted
                        ? 'row-selected text-[var(--text)]'
                        : o.is_selected
                        ? 'row-selected text-[var(--text)]'
                        : 'hover:bg-[var(--surface-1)]',
                      orgFocusId === o.id && 'ring-1 ring-[var(--accent)]/50'
                    )}>
                      <td className={cn(highlighted || o.is_selected ? 'text-[var(--text)]' : 'text-[var(--text-muted)]')}>{i + 1}</td>
                      <td className="font-medium">{o.name}</td>
                      <td><Badge variant="info">{o.tender_count}</Badge></td>
                      <td style={{ textAlign: 'center' }}>
                        <button onClick={(e) => { e.stopPropagation(); toggleOrgSelected.mutate(o); }} className={cn('mx-auto inline-flex h-5 w-5 items-center justify-center rounded border', o.is_selected ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--border)] hover:border-[var(--accent)]')}>
                          {o.is_selected && <Check size={12} />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {sortedOrgs.length === 0 && <tr><td colSpan={4}><EmptyState icon={Globe} title="No organizations" description="Click Fetch Orgs" /></td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {(tab === 'active' || tab === 'archived') && (() => {
          const data = tab === 'active' ? activeTenders : archivedTenders;
          if (tendersLoading) return <div className="flex justify-center py-16"><Spinner size={24} className="text-[var(--accent)]" /></div>;
          return (
            <div tabIndex={tab === 'active' ? 0 : -1} onKeyDown={onTenderKeyDown} className="outline-none">
              <table className="data-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <thead>
                  <tr>
                    {visibleTenderCols.map((c) => (
                      <th key={c.key} style={{ width: getTenderColWidth(c) }} className={cn('relative', !c.fixed && !['_time', '_act'].includes(c.key) && 'cursor-pointer')} onClick={() => { if (!c.fixed && !['_time', '_act'].includes(c.key)) toggleSort(c.key); }}>
                        <div className="flex items-center">
                          {c.label}
                          {!c.fixed && !['_time', '_act'].includes(c.key) && <SortIcon current={sortCol} dir={sortDir} col={c.key} />}
                        </div>
                        <div className="absolute right-0 top-0 h-full w-2 cursor-col-resize" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startTenderColumnResize(c, e.clientX); }} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.map((t) => {
                    const highlighted = (highlightedTenderByWebsite[String(t.website_id)] || []).includes(t.id);
                    return (
                      <tr
                        key={t.id}
                        onClick={(e) => handleTenderRowClick(t, e)}
                        className={cn(
                          tab === 'active' && 'cursor-pointer transition-colors',
                      highlighted
                            ? 'row-selected text-[var(--text)]'
                            : t.is_downloaded
                            ? 'row-selected text-[var(--text)]'
                            : 'hover:bg-[var(--surface-1)]',
                          tenderFocusId === t.id && tab === 'active' && 'ring-1 ring-[var(--accent)]/50'
                        )}
                      >
                        {visibleTenderCols.map((c) => {
                          if (c.key === '_bk') {
                            return (
                              <td key={c.key}>
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleDownloadSelect.mutate(t); }}
                                  className={cn(
                                    'inline-flex h-5 w-5 items-center justify-center rounded border',
                                    t.is_downloaded
                                      ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                                      : 'border-[var(--border)] text-transparent hover:border-[var(--accent)]'
                                  )}
                                  title={t.is_downloaded ? 'Selected for Download' : 'Select for Download'}
                                >
                                  {t.is_downloaded && <Check size={12} />}
                                </button>
                              </td>
                            );
                          }
                          if (c.key === '_time') return <td key={c.key}><TimeBadge dateStr={t.closing_date} /></td>;
                          if (c.key === '_act') return (
                            <td key={c.key}>
                              <div className="flex gap-1">
                                {tab === 'active' && (
                                  <>
                                    <Tooltip text="Download Full">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); runSingleJob(() => api.downloadSingleTender(t.id, 'full')); }}
                                        disabled={jobRunning}
                                        className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-50"
                                      >
                                        <Download size={13} />
                                      </button>
                                    </Tooltip>
                                    <Tooltip text="Download Updates">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); runSingleJob(() => api.downloadSingleTender(t.id, 'update')); }}
                                        disabled={jobRunning}
                                        className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-50"
                                      >
                                        <RefreshCw size={13} />
                                      </button>
                                    </Tooltip>
                                  </>
                                )}
                                <Tooltip text="Add to Project">
                                  <button onClick={(e) => { e.stopPropagation(); addTendersToProjects.mutate([t]); }} className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text)]">
                                    <FolderPlus size={13} />
                                  </button>
                                </Tooltip>
                                {!!t.folder_path && (
                                  <Tooltip text="Open Folder">
                                    <button onClick={(e) => { e.stopPropagation(); openTenderFolder(t); }} className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text)]">
                                      <FolderOpen size={13} />
                                    </button>
                                  </Tooltip>
                                )}
                                {t.tender_url && (
                                  <Tooltip text="Open Tender">
                                    <a onClick={(e) => e.stopPropagation()} href={t.tender_url} target="_blank" rel="noopener" className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text)]">
                                      <ExternalLink size={13} />
                                    </a>
                                  </Tooltip>
                                )}
                              </div>
                            </td>
                          );
                          if (c.key === 'is_bookmarked') {
                            return (
                              <td key={c.key} className="text-center">
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleBookmark.mutate(t); }}
                                  className={cn(
                                    'inline-flex h-6 w-6 items-center justify-center rounded transition-colors',
                                    t.is_bookmarked
                                      ? 'text-amber-400'
                                      : 'text-[var(--text-muted)] hover:text-amber-400'
                                  )}
                                  title={t.is_bookmarked ? 'Bookmarked for Add to Projects' : 'Bookmark for Add to Projects'}
                                >
                                  <Star size={18} className={cn(t.is_bookmarked ? 'fill-amber-400 text-amber-400' : '')} />
                                </button>
                              </td>
                            );
                          }
                          if (c.key === 'status') return <td key={c.key}><StatusBadge status={t.status} /></td>;
                          if (c.key === 'tender_value' || c.key === 'emd') return <td key={c.key} className="whitespace-nowrap font-mono text-xs">{formatINR(t[c.key as keyof Tender] as string)}</td>;
                          if (c.key === 'tender_id') return <td key={c.key} className="font-mono text-xs text-[var(--accent)]">{t.tender_id}</td>;
                          if (c.key === 'title') return <td key={c.key}><p className="overflow-hidden text-sm text-[var(--text)]" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{t.title}</p></td>;
                          return <td key={c.key} className="text-xs">{String(t[c.key as keyof Tender] ?? '')}</td>;
                        })}
                      </tr>
                    );
                  })}
                  {data.length === 0 && <tr><td colSpan={visibleTenderCols.length}><EmptyState icon={Globe} title="No tenders" description="Fetch tenders or adjust filters" /></td></tr>}
                </tbody>
              </table>
            </div>
          );
        })()}

        {tab === 'logs' && (
          <div className="min-h-full space-y-0.5 bg-[var(--surface-0)] p-4 font-mono text-xs">
            {logs.map((line, i) => (
              <p key={`${i}-${line.slice(0, 12)}`} className={cn('leading-relaxed whitespace-nowrap', line.includes('Error') || line.includes('Failed') ? 'text-rose-400' : line.includes('Done') ? 'text-emerald-400' : 'text-[var(--text-muted)]')}>{normalizeLogEntry(line)}</p>
            ))}
          </div>
        )}
      </div>

      {showManage && <ManageWebsitesDialog onClose={() => { setShowManage(false); qc.invalidateQueries({ queryKey: ['websites'] }); }} />}
      {showClearDialog && (
        <ClearDataDialog
          onClose={() => { setShowClearDialog(false); invalidate(); }}
        />
      )}
      {pendingCaptcha && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card w-[420px] p-4">
            <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">Enter CAPTCHA</h3>
            <p className="mb-3 text-xs text-[var(--text-muted)]">Auto CAPTCHA solve failed after 3 tries. Enter text from image.</p>
            <div className="mb-3 flex justify-center">
              <img src={`data:image/png;base64,${pendingCaptcha.image_base64}`} alt="Captcha" className="max-h-24 rounded border border-[var(--border)]" />
            </div>
            <input
              value={captchaInput}
              onChange={(e) => setCaptchaInput(e.target.value)}
              placeholder="Enter CAPTCHA"
              className="input-field mb-3 h-9 w-full text-sm"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={async () => {
                  try {
                    await api.submitCaptcha(pendingCaptcha.request_id, '');
                  } catch {
                    // ignore cancel errors
                  }
                  setPendingCaptcha(null);
                  setCaptchaInput('');
                }}
                className="btn-ghost text-xs"
              >
                Cancel
              </button>
              <button
                onClick={submitCaptcha}
                disabled={captchaSubmitting || !captchaInput.trim()}
                className="btn-primary text-xs"
              >
                {captchaSubmitting ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ManageWebsitesDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: websites = [] } = useQuery({ queryKey: ['websites'], queryFn: api.listWebsites });
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [statusUrl, setStatusUrl] = useState('');

  const addWebsite = useMutation({
    mutationFn: () => api.createWebsite({ name: name.trim(), url: url.trim(), status_url: statusUrl.trim() }),
    onSuccess: () => {
      setName('');
      setUrl('');
      setStatusUrl('');
      qc.invalidateQueries({ queryKey: ['websites'] });
    },
  });
  const deleteWebsite = useMutation({
    mutationFn: (id: number) => api.deleteWebsite(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['websites'] });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="card max-h-[80vh] w-[560px] space-y-4 overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Manage Websites</h2>
          <button onClick={onClose} className="text-[var(--text-muted)]"><X size={18} /></button>
        </div>
        <table className="data-table">
          <thead><tr><th>Name</th><th>URL</th><th className="w-16" /></tr></thead>
          <tbody>
            {websites.map((w) => (
              <tr key={w.id}>
                <td className="text-sm font-medium">{w.name}</td>
                <td className="max-w-[240px] truncate text-xs">{w.url}</td>
                <td><button onClick={() => deleteWebsite.mutate(w.id)} className="text-xs text-rose-400"><Trash2 size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-2 border-t border-[var(--border)] pt-2">
          <p className="text-sm font-semibold">Add Website</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="input-field h-8 w-full text-sm" />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Org URL" className="input-field h-8 w-full text-sm" />
          <input value={statusUrl} onChange={(e) => setStatusUrl(e.target.value)} placeholder="Status URL" className="input-field h-8 w-full text-sm" />
          <button disabled={!name || !url} onClick={() => addWebsite.mutate()} className="btn-primary gap-1 text-sm"><Plus size={14} />Add</button>
          {addWebsite.isError && (
            <p className="text-xs text-rose-400">
              {addWebsite.error instanceof Error ? addWebsite.error.message : 'Failed to add website.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ClearDataDialog({ onClose }: { onClose: () => void }) {
  const [clearOrg, setClearOrg] = useState(false);
  const [clearActive, setClearActive] = useState(false);
  const [clearArchived, setClearArchived] = useState(false);
  const clearMutation = useMutation({
    mutationFn: () => api.clearSavedData({
      clear_orgs: clearOrg,
      clear_active: clearActive,
      clear_archived: clearArchived,
    }),
    onSuccess: () => onClose(),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="card w-[420px] space-y-4 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">Clear Data</h2>
        <p className="text-sm text-[var(--text-muted)]">Websites preserved.</p>
        <div className="space-y-3">
          <label className="flex cursor-pointer items-center gap-3"><input type="checkbox" checked={clearOrg} onChange={(e) => setClearOrg(e.target.checked)} className="accent-[var(--accent)]" /><span className="text-sm">Organizations</span></label>
          <label className="flex cursor-pointer items-center gap-3"><input type="checkbox" checked={clearActive} onChange={(e) => setClearActive(e.target.checked)} className="accent-[var(--accent)]" /><span className="text-sm">Active tenders</span></label>
          <label className="flex cursor-pointer items-center gap-3"><input type="checkbox" checked={clearArchived} onChange={(e) => setClearArchived(e.target.checked)} className="accent-[var(--accent)]" /><span className="text-sm">Archived tenders</span></label>
        </div>
        {clearMutation.isError && (
          <p className="text-xs text-rose-400">
            {clearMutation.error instanceof Error ? clearMutation.error.message : 'Failed to clear selected data.'}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} disabled={clearMutation.isPending} className="btn-ghost text-sm">Cancel</button>
          <button
            onClick={() => clearMutation.mutate()}
            disabled={!clearOrg && !clearActive && !clearArchived || clearMutation.isPending}
            className="btn-danger gap-1 text-sm"
          >
            <Trash2 size={14} />
            {clearMutation.isPending ? 'Clearing...' : 'Clear'}
          </button>
        </div>
      </div>
    </div>
  );
}
