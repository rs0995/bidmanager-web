import React, { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard, Globe, FolderOpen, FileText, Server, Settings,
  Bell, Sun, Moon, PanelLeftClose, PanelLeft, X, AlertTriangle,
  Activity, Calendar, Edit3, Save,
  Search, Plus, Eye, EyeOff, Copy, ExternalLink, Trash2,
  CheckSquare, Square, ChevronRight, ChevronLeft, LayoutGrid, List, Clock,
  Building2, IndianRupee, CalendarClock, ArchiveRestore, SlidersHorizontal,
  Bookmark, Columns3, FileDown, Star, RefreshCw,
  ChevronDown, Folder, ArrowUp, Wifi, WifiOff, CheckCircle2,
  Paperclip, FolderCog, Link2, BookOpen, Pencil,
  Palette, RotateCcw, Home, Download, Upload, Rows3, Type, Info, Filter,
  LogOut, LogIn, UserPlus, KeyRound, ArrowLeft,
} from 'lucide-react';
import { api } from './lib/api';
import { cn, formatINR, formatCrores, timeRemaining } from './lib/utils';
import { useAppStore } from './lib/store';
import {
  Badge, TimeBadge, StatusBadge, EmptyState, Spinner, NotificationIcon,
} from './components/ui/shared';

/* ════════════════════════════════════════════════════════════════════════════
   BID MANAGER — CLIENT APP (draft)
   ────────────────────────────────────────────────────────────────────────────
   This is the client-facing counterpart to the operator/scraper app. It reuses
   the same lib/api, lib/store, lib/utils and shared UI components — nothing
   here changes those files. What's removed, relative to the full app:

     • No scraping controls: no "fetch tenders" / job queue / CAPTCHA solver /
       live scraper log console / website & organization management.
     • Tenders page is now a read-only browse-and-bookmark list over tenders
       that already exist in the shared database (Organizations + Logs tabs
       from the operator app are gone).
     • Projects: dropped tender-autofill-from-scrape ("Fetch" button); manual
       entry / editing only.
     • Project Workspace: dropped "Fetch tender info" (scraper + CAPTCHA
       assisted sync). Manual entry + local file attachment only.
     • Settings: dropped CAPTCHA AI provider config, Backend/Cloud Run
       connection config, and Auto-Archive scheduling — all operator-only.
     • Server Control → renamed "Files": dropped bulk "delete files older
       than N days" maintenance action; kept simple browse + folder delete.
     • App shell: dropped the background auto-archive polling loop that used
       to call the scraper endpoints on a timer.

   Anything marked  // WIRE:  is a spot the person asked to leave for wiring
   once the client-facing API surface is finalized. Everything else already
   calls the same `api` used by the operator app.
   ════════════════════════════════════════════════════════════════════════════ */

// Page keys: 'dashboard' | 'tenders' | 'projects' | 'templates' | 'archived_projects' | 'files' | 'settings'

/* ═══════════════════════════════════════════════════════════════════════════
   CLIENT-SIDE PREFERENCES
   — purely local (localStorage), never sent to the backend. Separate from the
     `settings` object returned by api.getSettings/updateSettings, which is
     server-relevant config. These control appearance/UI behavior only and are
     safe to add without touching lib/api.js, lib/store.js, or the backend.
   ═══════════════════════════════════════════════════════════════════════════ */
const CLIENT_PREFS_KEY = 'bm-client-prefs';
const CLIENT_PREFS_EVENT = 'bm-client-prefs-updated';
const ACCENT_PRESETS = [
  { name: 'Blue', hex: '#5b8af5' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Amber', hex: '#f59e0b' },
  { name: 'Rose', hex: '#ef4444' },
  { name: 'Teal', hex: '#14b8a6' },
  { name: 'Pink', hex: '#ec4899' },
];
const STARTUP_PAGE_OPTIONS = [
  { value: 'resume', label: 'Resume last visited' },
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'tenders', label: 'Online Tenders' },
  { value: 'projects', label: 'Projects' },
  { value: 'templates', label: 'Templates' },
  { value: 'files', label: 'Files' },
];
const DEFAULT_CLIENT_PREFS = {
  accent: '',              // '' = follow theme default
  density: 'comfortable',  // 'comfortable' | 'compact'
  uiScale: 'md',           // 'sm' | 'md' | 'lg'
  startupPage: 'resume',
};

function readClientPrefs() {
  try {
    const raw = localStorage.getItem(CLIENT_PREFS_KEY);
    return raw ? { ...DEFAULT_CLIENT_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_CLIENT_PREFS };
  } catch {
    return { ...DEFAULT_CLIENT_PREFS };
  }
}
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}
function shadeHex(hex, amt) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const clamp = (v) => Math.max(0, Math.min(255, v));
  return `#${[rgb.r, rgb.g, rgb.b].map((v) => clamp(v + amt).toString(16).padStart(2, '0')).join('')}`;
}
function applyClientPrefs(prefs) {
  const root = document.documentElement;
  const rgb = hexToRgb(prefs.accent);
  if (rgb) {
    root.style.setProperty('--accent', prefs.accent);
    root.style.setProperty('--accent-hover', shadeHex(prefs.accent, 28));
    root.style.setProperty('--accent-bg', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`);
    root.style.setProperty('--row-selected-bg', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.08)`);
  } else {
    ['--accent', '--accent-hover', '--accent-bg', '--row-selected-bg'].forEach((v) => root.style.removeProperty(v));
  }
  root.dataset.density = prefs.density === 'compact' ? 'compact' : 'comfortable';
  if (prefs.uiScale === 'sm') root.style.fontSize = '14px';
  else if (prefs.uiScale === 'lg') root.style.fontSize = '18px';
  else root.style.removeProperty('font-size');
}
function writeClientPrefs(prefs) {
  localStorage.setItem(CLIENT_PREFS_KEY, JSON.stringify(prefs));
  applyClientPrefs(prefs);
  window.dispatchEvent(new CustomEvent(CLIENT_PREFS_EVENT, { detail: prefs }));
}
// Apply immediately on module load so there's no flash of un-styled defaults.
applyClientPrefs(readClientPrefs());

function useClientPrefs() {
  const [prefs, setPrefs] = useState(readClientPrefs);
  useEffect(() => {
    const onUpdate = (e) => setPrefs(e.detail || readClientPrefs());
    window.addEventListener(CLIENT_PREFS_EVENT, onUpdate);
    return () => window.removeEventListener(CLIENT_PREFS_EVENT, onUpdate);
  }, []);
  const update = useCallback((patch) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      writeClientPrefs(next);
      return next;
    });
  }, []);
  const reset = useCallback(() => {
    writeClientPrefs(DEFAULT_CLIENT_PREFS);
    setPrefs(DEFAULT_CLIENT_PREFS);
  }, []);
  return [prefs, update, reset];
}

// ── Small reusable settings-UI primitives ───────────────────────────────────
function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('toggle-switch', checked && 'toggle-switch-on')}
    >
      <span className="toggle-thumb" />
    </button>
  );
}

function SegmentedControl({ options, value, onChange, disabled }) {
  return (
    <div className="segmented">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={cn('segmented-item', value === opt.value && 'segmented-item-active')}
        >
          {opt.icon ? <opt.icon size={13} /> : null}{opt.label}
        </button>
      ))}
    </div>
  );
}

function SettingRow({ title, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm text-[var(--text)]">{title}</p>
        {hint && <p className="text-xs text-[var(--text-muted)]">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ── Error boundary ───────────────────────────────────────────────────────────
class RenderErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown error');
    return { hasError: true, message };
  }
  componentDidCatch(error) {
    // eslint-disable-next-line no-console
    console.error('RenderErrorBoundary caught error:', error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center p-6">
          <div className="card max-w-xl p-5">
            <h2 className="text-base font-semibold text-[var(--text)]">UI error detected</h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              The page crashed while rendering. Please restart once; if it repeats, share this message.
            </p>
            <pre className="mt-3 overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface-1)] p-3 text-xs text-rose-400">
              {this.state.message || 'Unknown renderer error'}
            </pre>
            <div className="mt-4 flex items-center gap-2">
              <button className="btn-primary text-xs" onClick={() => window.location.reload()}>Reload App</button>
              <button className="btn-ghost text-xs" onClick={() => this.setState({ hasError: false, message: '' })}>Try Continue</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Sidebar ────────────────────────────────────────────────────────────────
function Sidebar({ active, onNavigate, collapsed, onToggle }) {
  const mainItems = [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'tenders', label: 'Online Tenders', icon: Globe },
    { key: 'organizations', label: 'Organizations', icon: Building2 },
    { key: 'bookmarks', label: 'Bookmarks', icon: Star },
    { key: 'projects', label: 'Projects', icon: FolderOpen },
    { key: 'templates', label: 'Templates', icon: FileText },
  ];
  const bottomItems = [
    { key: 'archived_projects', label: 'Archived Projects', icon: FolderOpen },
    { key: 'files', label: 'Files', icon: Server },
    { key: 'settings', label: 'Settings', icon: Settings },
  ];

  const NavButton = ({ item }) => (
    <button
      onClick={() => onNavigate(item.key)}
      className={cn(
        'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all w-full text-left',
        active === item.key
          ? 'bg-[var(--accent-bg)] text-[var(--accent)] font-medium'
          : 'text-[var(--text-muted)] hover:bg-[var(--surface-1)] hover:text-[var(--text)]'
      )}
      title={collapsed ? item.label : undefined}
    >
      <item.icon size={18} className="shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </button>
  );

  return (
    <div className={cn(
      'flex flex-col h-full border-r border-[var(--border)] bg-[var(--surface-0)] transition-all duration-200 shrink-0',
      collapsed ? 'w-[56px]' : 'w-[210px]'
    )}>
      <div className="flex items-center gap-2 px-3 h-11 border-b border-[var(--border)] shrink-0">
        {!collapsed && (
          <span className="text-sm font-bold tracking-tight text-[var(--accent)] truncate">BID MANAGER</span>
        )}
        <button onClick={onToggle} className={cn('p-1 rounded hover:bg-[var(--surface-1)] text-[var(--text-muted)]', collapsed && 'mx-auto')}>
          {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <div className="flex-1 flex flex-col py-2 px-1.5 gap-0.5 overflow-hidden">
        {mainItems.map(item => <NavButton key={item.key} item={item} />)}
      </div>

      <div className="px-1.5 pb-2 flex flex-col gap-0.5">
        {bottomItems.map(item => <NavButton key={item.key} item={item} />)}
      </div>
    </div>
  );
}

// ── Notification Panel ────────────────────────────────────────────────────
function NotificationPanel({ open, onClose }) {
  const { notifications, markRead, markAllRead } = useAppStore();
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-10 right-2 w-80 z-50 card shadow-xl border border-[var(--border)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <span className="text-sm font-semibold text-[var(--text)]">Notifications</span>
          <div className="flex items-center gap-2">
            <button onClick={markAllRead} className="text-xs text-[var(--accent)] hover:underline">Mark all read</button>
            <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)]"><X size={14} /></button>
          </div>
        </div>
        <div className="max-h-80 overflow-auto">
          {notifications.length === 0 && (
            <p className="text-sm text-[var(--text-muted)] text-center py-8">No notifications</p>
          )}
          {notifications.map(n => (
            <div
              key={n.id}
              onClick={() => markRead(n.id)}
              className={cn(
                'flex items-start gap-3 px-4 py-3 border-b border-[var(--border)] last:border-0 transition-colors cursor-pointer hover:bg-[var(--surface-1)]',
                !n.read && 'bg-[var(--accent-bg)]/20'
              )}
            >
              <NotificationIcon type={n.type} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--text)]">{n.message}</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{n.time}</p>
              </div>
              {!n.read && <div className="w-2 h-2 rounded-full bg-[var(--accent)] mt-1.5 shrink-0" />}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════════════════════════════════════ */
function DashboardPage({ onNavigate, onOpenProjectWorkspace, onOpenWebsiteOrganizations }) {
  const qc = useQueryClient();
  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboardStats,
    refetchInterval: 60000,
  });
  const syncNow = useMutation({
    mutationFn: () => api.syncFromServer(),
    onSuccess: () => qc.invalidateQueries(),
    onError: (err) => alert(`Sync failed: ${err?.message || String(err)}`),
  });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const { data: activeProjects } = useQuery({ queryKey: ['projects', 'Active', ''], queryFn: () => api.listProjects('', 'Active') });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size={32} className="text-[var(--accent)]" />
      </div>
    );
  }

  if (!stats) {
    return (
      <EmptyState
        icon={Activity}
        title="Could not load dashboard"
        description="Could not reach the API. Check your connection or contact your administrator."
      />
    );
  }

  const statCards = [
    { label: 'Active Tenders', value: stats.active_tenders, icon: Globe, color: 'text-sky-400', bg: 'bg-sky-500/10', target: 'tenders-active' },
    { label: 'Active Projects', value: stats.active_projects, icon: FolderOpen, color: 'text-emerald-400', bg: 'bg-emerald-500/10', target: 'projects' },
    { label: 'Bookmarked', value: stats.bookmarked_tenders, icon: Bookmark, color: 'text-amber-400', bg: 'bg-amber-500/10', target: 'bookmarks' },
    { label: 'Closing < 7 Days', value: stats.closing_soon, icon: Clock, color: 'text-rose-400', bg: 'bg-rose-500/10', target: 'tenders-closing-7d' },
    { label: 'Archived', value: stats.archived_tenders, icon: AlertTriangle, color: 'text-rose-400', bg: 'bg-rose-500/10', target: 'tenders-archived' },
  ];

  // ── "Needs attention" (item 5) ────────────────────────────────────────────
  const daysUntil = (dateStr) => {
    const target = parseDeadlineText(dateStr);
    if (!target) return null;
    return Math.floor((target.getTime() - Date.now()) / 86400000);
  };
  const projectTenderIds = new Set((activeProjects || []).map((p) => p.source_tender_id).filter(Boolean));
  const urgentUnclaimedBookmarks = (stats.bookmarked_items || []).filter((t) => {
    const days = daysUntil(t.closing_date);
    return days !== null && days >= 0 && days <= 2 && !projectTenderIds.has(t.tender_id);
  });
  const syncAgeDays = settings?.last_sync_at ? (Date.now() - new Date(settings.last_sync_at).getTime()) / 86400000 : null;
  const staleSync = syncAgeDays === null || syncAgeDays > 1;
  const attentionRows = [
    ...urgentUnclaimedBookmarks.slice(0, 4).map((t) => ({
      key: `bm-${t.id}`,
      icon: AlertTriangle,
      color: 'text-rose-400',
      text: `Bookmarked tender "${t.title || t.tender_id}" closes in ${Math.max(0, daysUntil(t.closing_date))}d and has no project yet`,
      cta: 'Review',
      onClick: () => onNavigate?.('bookmarks'),
    })),
    ...(staleSync ? [{
      key: 'stale-sync',
      icon: WifiOff,
      color: 'text-[var(--text-muted)]',
      text: settings?.last_sync_at ? `Tender data last synced ${formatAgo(settings.last_sync_at)}` : 'Tender data has not been synced yet',
      cta: 'Sync now',
      onClick: () => syncNow.mutate(),
    }] : []),
  ].slice(0, 5);

  // ── Upcoming deadlines grouped by urgency (item 7) ────────────────────────
  const urgencyBand = (days) => (days <= 3 ? { label: 'Critical', color: 'var(--danger)' } : days <= 7 ? { label: 'Soon', color: '#f59e0b' } : { label: 'Comfortable', color: 'var(--text-muted)' });
  const bandedDeadlines = ['Critical', 'Soon', 'Comfortable'].map((band) => ({
    band,
    color: band === 'Critical' ? 'var(--danger)' : band === 'Soon' ? '#f59e0b' : 'var(--text-muted)',
    rows: stats.upcoming_deadlines.slice(0, 6).filter((d) => {
      const days = daysUntil(d.closing_date);
      return days !== null && urgencyBand(Math.max(0, days)).label === band;
    }),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Dashboard</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">Overview of your tender pipeline</p>
        </div>
        <button type="button" onClick={() => syncNow.mutate()} disabled={syncNow.isPending} className="btn-secondary flex items-center gap-2 text-sm">
          {syncNow.isPending ? <Spinner size={14} /> : <RefreshCw size={14} />} Sync Now
        </button>
      </div>

      {attentionRows.length > 0 && (
        <div className="card p-4 border-amber-500/30">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-amber-400" />
            <h3 className="text-sm font-semibold text-[var(--text)]">Needs attention</h3>
          </div>
          <div className="space-y-2">
            {attentionRows.map((row) => (
              <div key={row.key} className="flex items-center gap-3 rounded-lg bg-[var(--surface-1)] px-3 py-2.5">
                <row.icon size={15} className={cn('shrink-0', row.color)} />
                <span className="flex-1 text-sm text-[var(--text)]">{row.text}</span>
                <button type="button" onClick={row.onClick} className="btn-secondary text-xs shrink-0">{row.cta}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onNavigate?.(s.target)}
            className="card p-4 flex items-center gap-4 text-left transition-colors hover:bg-[var(--surface-1)]"
          >
            <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center', s.bg)}>
              <s.icon size={20} className={s.color} />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--text)]">{s.value}</p>
              <p className="text-xs text-[var(--text-muted)]">{s.label}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
        <div className="flex flex-col gap-4">
          <div className="card p-3">
            <div className="flex items-center gap-2 mb-1">
              <IndianRupee size={12} className="text-[var(--accent)]" />
              <h3 className="text-sm font-semibold text-[var(--text)]">Pipeline Value</h3>
            </div>
            <p className="text-xl font-bold text-[var(--text)]">{formatCrores(stats.total_pipeline_value)}</p>
            <p className="text-xs text-[var(--text-muted)]">across selected tenders</p>
          </div>

          <div className="card p-4 flex-1">
            <div className="flex items-center gap-2 mb-3">
              <Activity size={15} className="text-[var(--accent)]" />
              <h3 className="text-sm font-semibold text-[var(--text)]">Website Coverage</h3>
            </div>
            {(stats.websites || []).length === 0 ? (
              <p className="rounded-lg bg-[var(--surface-1)] px-3 py-4 text-center text-xs text-[var(--text-muted)]">
                No website data yet. Sync to load tender data.
              </p>
            ) : (
              <div className="space-y-2">
                {stats.websites.map((website) => (
                  <button
                    type="button"
                    key={website.id}
                    onClick={() => onOpenWebsiteOrganizations?.(website.name)}
                    className="w-full rounded-lg bg-[var(--surface-1)] px-3 py-2 text-left transition-colors hover:bg-[var(--surface-2)]"
                  >
                    <p className="text-sm font-semibold text-[var(--text)] truncate">{website.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
                      <span className="inline-flex items-center gap-1"><Building2 size={11} />{website.orgs || 0} orgs</span>
                      <span className="inline-flex items-center gap-1"><FileText size={11} />{website.active_tenders || 0} active</span>
                      <span className="inline-flex items-center gap-1"><CheckSquare size={11} />{website.selected_orgs || 0} selected</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={16} className="text-[var(--accent)]" />
            <h3 className="text-sm font-semibold text-[var(--text)]">Upcoming Deadlines</h3>
          </div>
          <div>
            {bandedDeadlines.length === 0 && (
              <p className="text-sm text-[var(--text-muted)] py-4 text-center">No upcoming deadlines</p>
            )}
            {bandedDeadlines.map((group) => (
              <div key={group.band} className="mb-3 last:mb-0">
                <p className="text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color: group.color }}>{group.band}</p>
                <div className="space-y-1">
                  {group.rows.map((d, i) => (
                    <div key={i} className="flex items-center gap-3 py-1.5">
                      <div className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: group.color }} />
                      <div className="flex-1 min-w-0 mr-2">
                        <p className="text-xs font-mono text-[var(--accent)]">{d.tender_id}</p>
                        <p className="text-sm text-[var(--text)] truncate">{d.title}</p>
                      </div>
                      <TimeBadge dateStr={d.closing_date} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Bookmark size={16} className="text-amber-400" />
              <h3 className="text-sm font-semibold text-[var(--text)]">Bookmarked Tenders</h3>
            </div>
            <Badge variant="warning">{stats.bookmarked_tenders || 0}</Badge>
          </div>
          <div className="space-y-1">
            {(stats.bookmarked_items || []).length === 0 && (
              <p className="py-6 text-center text-sm text-[var(--text-muted)]">No bookmarked tenders</p>
            )}
            {(stats.bookmarked_items || []).map((tender, i) => (
              <button
                type="button"
                key={tender.id}
                onClick={() => onNavigate?.('bookmarks')}
                className="flex w-full items-center gap-3 border-b border-[var(--border)] py-2.5 last:border-0 text-left transition-colors hover:bg-[var(--surface-1)] rounded-md px-1.5 -mx-1.5"
              >
                <span className="w-5 shrink-0 text-xs text-[var(--text-muted)] text-center">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-mono text-[var(--accent)]">{tender.tender_id || 'No tender ID'}</p>
                  <p className="truncate text-sm text-[var(--text)]">{tender.title || 'Untitled tender'}</p>
                </div>
                <TimeBadge dateStr={tender.closing_date} />
              </button>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <FolderCog size={16} className="text-emerald-400" />
              <h3 className="text-sm font-semibold text-[var(--text)]">Bids Under Preparation</h3>
            </div>
            <Badge variant="success">{stats.active_projects || 0}</Badge>
          </div>
          <div className="space-y-1">
            {(stats.bids_under_preparation || []).length === 0 && (
              <p className="py-6 text-center text-sm text-[var(--text-muted)]">No bids under preparation</p>
            )}
            {(stats.bids_under_preparation || []).map((project, i) => (
              <button
                type="button"
                key={project.id}
                onClick={() => onOpenProjectWorkspace?.(project.id)}
                className="flex w-full items-center gap-3 border-b border-[var(--border)] py-2.5 last:border-0 text-left transition-colors hover:bg-[var(--surface-1)] rounded-md px-1.5 -mx-1.5"
              >
                <span className="w-5 shrink-0 text-xs text-[var(--text-muted)] text-center">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--text)]">{project.title || 'Untitled project'}</p>
                  <p className="truncate text-xs text-[var(--text-muted)]">{project.client_name || project.source_tender_id || 'Local project'}</p>
                </div>
                <TimeBadge dateStr={project.deadline} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TENDERS  (browse + bookmark only — no scraping, no org/website management,
   no job queue, no CAPTCHA, no live log console)
   ═══════════════════════════════════════════════════════════════════════════ */
const TENDER_COLUMNS = [
  { key: '_sr', label: 'Sr. No.', width: 60, fixed: true },
  { key: 'is_bookmarked', label: 'Bookmark', width: 90, fixed: true },
  { key: 'tender_id', label: 'Tender ID / Work Desc', width: 320 },
  { key: 'title', label: 'Title', width: 300 },
  { key: 'tender_value', label: 'Value', width: 130 },
  { key: 'emd', label: 'EMD', width: 120 },
  { key: 'org_chain', label: 'Org Chain', width: 200 },
  { key: 'published_date', label: 'Published', width: 150 },
  { key: 'closing_date', label: 'Closing Date', width: 170 },
  { key: 'pre_bid_meeting_date', label: 'Pre-Bid', width: 150 },
  { key: '_prebid_corrigendum', label: 'Prebid/Corrigendum', width: 150 },
  { key: 'location', label: 'Location', width: 180 },
  { key: 'tender_category', label: 'Category', width: 130 },
  { key: 'status', label: 'Status', width: 140 },
  { key: '_download', label: 'Download', width: 170, fixed: true },
  { key: '_time', label: 'Time Left', width: 110 },
  { key: '_actions', label: 'Actions', width: 100, fixed: true },
];

const TENDER_NON_SORTABLE = new Set(['_sr', 'is_bookmarked', '_prebid_corrigendum', '_download', '_time', '_actions']);

const TENDER_TABLE_WIDTH = TENDER_COLUMNS.reduce((total, column) => total + column.width, 0);

const TENDERS_FILTER_STATE_KEY = 'bm-client:tenders:filters:v1';
// One-shot flag: OrganizationsPage sets this immediately before navigating
// here so "view this org's tenders" always opens on Active, then TendersPage
// reads and clears it on mount.
const TENDERS_FORCE_TAB_KEY = 'bm-client:tenders:force-tab';
// One-shot flag: the "Closing < 7 Days" dashboard stat card sets this
// immediately before navigating here so Tenders opens with that filter
// already applied; TendersPage reads and clears it on mount.
const TENDERS_FORCE_CLOSING_KEY = 'bm-client:tenders:force-closing-soon';
// Not one-shot: set by openOrgTenders and cleared by any other navigation
// (see App()'s `navigate` helper) — drives whether TendersPage shows a
// "Back to Organizations" button.
const TENDERS_CAME_FROM_ORG_KEY = 'bm-client:tenders:came-from-org';
// Persists the Organizations search box across navigating away and back
// (e.g. via the Tenders "Back to Organizations" button) — not one-shot,
// only changes when the user edits the search box.
const ORGANIZATIONS_SEARCH_KEY = 'bm-client:organizations:search';
// One-shot flag: a Dashboard Website Coverage card sets this immediately
// before navigating here so that website is preselected/filtered.
const ORGANIZATIONS_FORCE_WEBSITE_KEY = 'bm-client:organizations:force-website';

function loadTenderFilterState() {
  try {
    const raw = localStorage.getItem(TENDERS_FILTER_STATE_KEY);
    if (!raw) return { org: '', location: '', category: '', website: '' };
    const parsed = JSON.parse(raw);
    return {
      org: String(parsed?.org || ''),
      location: String(parsed?.location || ''),
      category: String(parsed?.category || ''),
      website: String(parsed?.website || ''),
    };
  } catch {
    return { org: '', location: '', category: '', website: '' };
  }
}

function smartCmp(a, b) {
  const na = parseFloat(String(a).replace(/[₹,\s]/g, ''));
  const nb = parseFloat(String(b).replace(/[₹,\s]/g, ''));
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const parseDate = (value) => {
    const text = String(value || '');
    const named = text.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
    if (named && months[named[2].toLowerCase()]) return Number(named[3]) * 10000 + months[named[2].toLowerCase()] * 100 + Number(named[1]);
    const numeric = text.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (numeric) return Number(numeric[3]) * 10000 + Number(numeric[2]) * 100 + Number(numeric[1]);
    return null;
  };
  const da = parseDate(a);
  const db = parseDate(b);
  if (da !== null && db !== null) return da - db;
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
}

function exportCSV(headers, rows, keys, filename) {
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(','), ...rows.map((r) => keys.map((k) => esc(String(r[k] ?? ''))).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Shared tender column customization (Tenders + Bookmarks pages) ─────────
// Per-account column show/hide/order/width — persisted in tendersTable/
// tendersView (Client UI/src/lib/store.ts) and synced across devices via
// pushUserData/pullUserData (Client UI/src/lib/api.js), same as bookmarks.
function useTenderColumns(tab) {
  const { tendersTable, tendersView, setTendersHiddenColumns, setTendersColumnOrder, setTenderColumnWidth } = useAppStore();
  // Active tenders are active by definition, so the Status column only earns
  // its place once tenders can carry other statuses — i.e. once archived.
  const baseTenderColumns = useMemo(
    () => TENDER_COLUMNS.filter((column) => tab === 'active' ? column.key !== 'status' : true),
    [tab]
  );
  const tenderColOrder = useMemo(
    () => (tendersTable.columnOrder?.length ? tendersTable.columnOrder : baseTenderColumns.map((c) => c.key)),
    [tendersTable.columnOrder, baseTenderColumns]
  );
  const tenderHidden = useMemo(() => new Set(tendersTable.hiddenColumns || []), [tendersTable.hiddenColumns]);
  const orderedTenderColumns = useMemo(() => {
    const byKey = new Map(baseTenderColumns.map((c) => [c.key, c]));
    const ordered = tenderColOrder.map((k) => byKey.get(k)).filter(Boolean);
    const missing = baseTenderColumns.filter((c) => !ordered.includes(c));
    return [...ordered, ...missing];
  }, [tenderColOrder, baseTenderColumns]);
  const visibleTenderColumns = useMemo(
    () => orderedTenderColumns.filter((c) => c.fixed || !tenderHidden.has(c.key)),
    [orderedTenderColumns, tenderHidden]
  );
  const getTenderColWidth = (c) => {
    const v = tendersView.tenderColumnWidths?.[c.key];
    return Number.isFinite(v) && v > 0 ? v : c.width;
  };
  const tenderTableWidth = useMemo(
    () => visibleTenderColumns.reduce((total, column) => total + getTenderColWidth(column), 0),
    [visibleTenderColumns, tendersView.tenderColumnWidths]
  );
  const toggleTenderCol = (key) => {
    const next = new Set(tenderHidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    setTendersHiddenColumns(Array.from(next));
  };
  const moveTenderCol = (from, to) => {
    if (from === to) return;
    const next = [...tenderColOrder];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setTendersColumnOrder(next);
  };
  // Drag handles in the Columns menu only show/reorder movable columns, but
  // the persisted order array holds every column (fixed included) — translate
  // a drag between two movable-list positions into the two real indices.
  const reorderMovableColumn = (fromMovableIdx, toMovableIdx) => {
    const movable = orderedTenderColumns.filter((c) => !c.fixed);
    const fromKey = movable[fromMovableIdx]?.key;
    const toKey = movable[toMovableIdx]?.key;
    if (!fromKey || !toKey) return;
    const from = tenderColOrder.indexOf(fromKey);
    const to = tenderColOrder.indexOf(toKey);
    if (from >= 0 && to >= 0) moveTenderCol(from, to);
  };
  const startTenderColResize = (col, startX) => {
    const min = col.key === '_sr' ? 48 : 90;
    const startWidth = getTenderColWidth(col);
    const onMove = (e) => setTenderColumnWidth(col.key, Math.max(min, startWidth + (e.clientX - startX)));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  return {
    orderedTenderColumns, tenderHidden, visibleTenderColumns,
    getTenderColWidth, tenderTableWidth, toggleTenderCol, reorderMovableColumn, startTenderColResize,
  };
}

function TenderColumnsMenuButton({ orderedTenderColumns, tenderHidden, toggleTenderCol, reorderMovableColumn }) {
  const [open, setOpen] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const movable = orderedTenderColumns.filter((c) => !c.fixed);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="btn-ghost gap-1.5 text-xs"><SlidersHorizontal size={13} />Columns</button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="card absolute right-0 top-9 z-50 max-h-80 w-60 overflow-auto border border-[var(--border)] p-2 shadow-xl">
            <p className="mb-2 border-b border-[var(--border)] px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Drag to reorder · toggle visibility</p>
            {movable.map((c, i) => (
              <div
                key={c.key}
                draggable
                onDragStart={() => setDragIdx(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragIdx !== null) reorderMovableColumn(dragIdx, i); setDragIdx(null); }}
                className={cn('flex cursor-grab items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--surface-1)]', dragIdx === i && 'opacity-50')}
              >
                <span className="select-none text-xs text-[var(--text-muted)]">⠿</span>
                <input type="checkbox" checked={!tenderHidden.has(c.key)} onChange={() => toggleTenderCol(c.key)} className="accent-[var(--accent)]" />
                <span className="flex-1 text-xs">{c.label || c.key}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Shared <table> used everywhere a tender list is shown (Tenders, Bookmarks) —
// same columns, same sort/resize behavior, same row rendering.
function TenderTable({ columns, getColWidth, tableWidth, sortCol, sortDir, onToggleSort, onStartResize, rows, isLoading, emptyState, renderCell, selectedId, onSelectRow }) {
  if (isLoading) return <div className="flex justify-center py-16"><Spinner size={24} className="text-[var(--accent)]" /></div>;
  if (!rows.length) return emptyState;
  return (
    <table className="data-table" style={{ tableLayout: 'fixed', width: tableWidth, minWidth: tableWidth }}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              style={{ width: getColWidth(c), textAlign: (c.key === 'is_bookmarked' || c.key === '_sr' || c.key === '_download') ? 'center' : 'left' }}
              className={cn('relative', !TENDER_NON_SORTABLE.has(c.key) && 'cursor-pointer')}
              onClick={() => !TENDER_NON_SORTABLE.has(c.key) && onToggleSort(c.key)}
            >
              {c.label}{sortCol === c.key && <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>}
              <div
                className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-[var(--accent)]/20"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onStartResize(c, e.clientX); }}
              />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((t, i) => (
          <tr key={t.id} onClick={() => onSelectRow?.(t)} className={cn('cursor-pointer', selectedId === t.id && 'row-selected')}>
            {columns.map((column) => (
              <td key={column.key} className={column.key === 'is_bookmarked' || column.key === '_sr' || column.key === '_download' ? 'text-center' : ''}>
                {renderCell(t, column, i)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Shared tender-row actions (bookmark toggle, download/request pill, add-to-
// project, open-tender link) and the cell renderer that wires them into
// TenderTable — used by both Tenders and Bookmarks so a bookmarked tender
// behaves identically wherever it's shown.
function useTenderRowActions() {
  const qc = useQueryClient();
  const { data: allDocuments } = useQuery({ queryKey: ['client-documents'], queryFn: api.listAllDocuments });
  const pendingRequestIds = useMemo(
    () => new Set((allDocuments || []).filter((row) => row.client_status === 'requested').map((row) => row.tender_db_id)),
    [allDocuments]
  );

  const toggleBookmark = useMutation({
    mutationFn: async (t) => {
      if (!t.is_bookmarked) {
        const count = await api.countBookmarkedTenders();
        if (count >= 10) throw new Error('You can bookmark at most 10 tenders. Remove one before adding another.');
      }
      return api.patchTender(t.id, { is_bookmarked: !t.is_bookmarked });
    },
    onSuccess: () => qc.invalidateQueries(),
    onError: (err) => alert(err instanceof Error ? err.message : String(err)),
  });

  // Fetches every document available for a tender and saves them all in one
  // click. Each file goes through api.downloadDocument (signed URL -> Electron
  // IPC write to <parent_dir>/Tender_Downloads/<tender_id>/<name>) sequentially
  // — a loop of synthetic <a> clicks only ever lands the first file because
  // Chromium/Electron throttles rapid programmatic downloads.
  const downloadTenderDocuments = useMutation({
    mutationFn: async (t) => {
      const docsPage = await api.listTenderDocuments(t.id, { page_size: 100 });
      const items = (docsPage?.items || []).filter((d) => d.downloadable !== false);
      if (!items.length) return { tenderId: t.id, count: 0, failed: 0, failures: [] };
      let ok = 0;
      const failures = [];
      for (const it of items) {
        try {
          await api.downloadDocument({
            id: it.id,
            tender_db_id: t.id,
            tender_id: t.tender_id,
            file_name: it.name,
          });
          ok += 1;
        } catch (err) {
          failures.push({ name: it.name || `#${it.id}`, message: err?.message || String(err) });
        }
      }
      await api.patchTender(t.id, { client_downloaded: ok > 0, has_documents: true, document_count: items.length });
      return { tenderId: t.id, count: ok, failed: failures.length, failures };
    },
    onSuccess: (result) => {
      qc.invalidateQueries();
      if (!result.count && !result.failed) {
        alert('No documents are available yet for this tender.');
      } else if (result.failed) {
        const reasons = [...new Set(result.failures.map((f) => f.message))].join('; ');
        alert(`Downloaded ${result.count} file(s). ${result.failed} failed: ${reasons}`);
      }
    },
    onError: (err) => alert(`Download failed: ${err?.message || String(err)}`),
  });

  // "Request" — queues the real server-side scrape/download job for a tender
  // that has no documents yet (see Server UI/server/client_api.py
  // request-download, which enqueues the same download_single_tender job the
  // admin console uses). api.requestTenderDownload persists the pending state
  // in the `documents` store and polls in the background (api.js), so it
  // survives a reload/restart — see api.resumePendingDownloadJobs.
  const requestTenderJob = useMutation({
    mutationFn: (t) => api.requestTenderDownload(t),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client-documents'] }),
    onError: (err) => alert(`Request failed: ${err?.message || String(err)}`),
  });

  // Converts a tender into a project — a normal client action, not scraping.
  const addToProject = useMutation({
    mutationFn: (t) => api.createProject({
      title: t.title || '',
      client_name: t.org_chain || '',
      source_tender_id: t.tender_id || '',
      project_value: t.tender_value || '',
      prebid: t.pre_bid_meeting_date || '',
      deadline: t.closing_date || '',
      description: t.work_description || t.title || '',
      status: 'Active',
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
    onError: (err) => alert(`Could not create project: ${err?.message || String(err)}`),
  });

  const renderTenderCell = (tender, column, index) => {
    if (column.key === '_sr') return <span className="text-xs text-[var(--text-muted)]">{index + 1}</span>;
    if (column.key === '_time') return <TimeBadge dateStr={tender.closing_date} />;
    if (column.key === '_download') {
      const hasDocs = tender.has_documents || Number(tender.document_count) > 0;
      const isDownloaded = hasDocs && tender.client_downloaded;
      const busy = downloadTenderDocuments.isPending && downloadTenderDocuments.variables?.id === tender.id;
      const requesting = pendingRequestIds.has(tender.id)
        || (requestTenderJob.isPending && requestTenderJob.variables?.id === tender.id);
      if (isDownloaded) {
        return (
          <button
            onClick={(event) => {
              event.stopPropagation();
              const proceed = window.confirm('Tender Already Downloaded. Want to download again and overwrite? Additional files will be untouched.');
              if (proceed) downloadTenderDocuments.mutate(tender);
            }}
            disabled={busy}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border-0 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
          >
            {busy ? <Spinner size={11} /> : <Download size={11} />}
            {busy ? 'Working…' : 'Downloaded'}
          </button>
        );
      }
      const pillStyles = hasDocs
        ? 'bg-sky-500/15 text-sky-400 hover:bg-sky-500/25'
        : 'bg-[var(--surface-2)] text-[var(--text-muted)] hover:bg-[var(--surface-3)]';
      return (
        <button
          onClick={(event) => {
            event.stopPropagation();
            if (hasDocs) downloadTenderDocuments.mutate(tender);
            else requestTenderJob.mutate(tender);
          }}
          disabled={busy || requesting}
          className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border-0 px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50', pillStyles)}
        >
          <Download size={11} />
          {busy ? 'Working…' : requesting ? 'Requested…' : hasDocs ? 'Download' : 'Request'}
        </button>
      );
    }
    if (column.key === 'is_bookmarked') {
      return (
        <button
          onClick={(event) => { event.stopPropagation(); toggleBookmark.mutate(tender); }}
          className={cn('inline-flex h-7 w-7 items-center justify-center rounded transition-colors', tender.is_bookmarked ? 'text-amber-400' : 'text-[var(--text-muted)] hover:text-amber-400')}
          title={tender.is_bookmarked ? 'Remove bookmark' : 'Bookmark tender'}
        >
          <Star size={18} fill={tender.is_bookmarked ? 'currentColor' : 'none'} />
        </button>
      );
    }
    if (column.key === '_actions') {
      return (
        <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
          <button onClick={() => addToProject.mutate(tender)} disabled={addToProject.isPending} className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]" title="Add to Project">
            <FolderOpen size={14} />
          </button>
          {tender.tender_url && (
            <a href={tender.tender_url} target="_blank" rel="noopener noreferrer" className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]" title="Open Tender">
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      );
    }
    if (column.key === 'status') return <StatusBadge status={tender.status} />;
    if (column.key === 'tender_value' || column.key === 'emd') return <span className="whitespace-nowrap font-mono text-xs">{formatINR(tender[column.key])}</span>;
    if (column.key === 'tender_id') {
      return (
        <div>
          <p className="font-mono text-xs text-[var(--accent)]">{tender.tender_id || '—'}</p>
          <p className="mt-0.5 overflow-hidden text-xs text-[var(--text-muted)]" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{tender.work_description || '—'}</p>
        </div>
      );
    }
    if (column.key === 'title') {
      return <p className="overflow-hidden text-sm text-[var(--text)]" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{tender.title || '—'}</p>;
    }
    if (column.key === '_prebid_corrigendum') {
      const total = (Number(tender.prebid_count) || 0) + (Number(tender.corrigendum_count) || 0);
      return <span className="text-xs">{total || '—'}</span>;
    }
    return <span className="text-xs">{String(tender[column.key] ?? '') || '—'}</span>;
  };

  return { renderTenderCell, addToProject };
}

function TendersPage({ onBackToOrganizations }) {
  const qc = useQueryClient();
  // A row on Organizations (OrganizationsPage) writes this before navigating
  // here, so "view this org's tenders" always lands on Active regardless of
  // whatever tab was last open.
  const [tab, setTab] = useState(() => {
    const forced = sessionStorage.getItem(TENDERS_FORCE_TAB_KEY);
    if (forced) sessionStorage.removeItem(TENDERS_FORCE_TAB_KEY);
    return forced === 'archived' ? 'archived' : 'active';
  });
  // Not one-shot here — App()'s `navigate` helper clears this on any other
  // navigation, so it stays accurate without TendersPage clearing it itself.
  const [cameFromOrg] = useState(() => sessionStorage.getItem(TENDERS_CAME_FROM_ORG_KEY) === '1');
  const [closingSoonOnly, setClosingSoonOnly] = useState(() => {
    const forced = sessionStorage.getItem(TENDERS_FORCE_CLOSING_KEY);
    if (forced) sessionStorage.removeItem(TENDERS_FORCE_CLOSING_KEY);
    return forced === '1';
  });
  const [search, setSearch] = useState('');
  const [showBookmarkedOnly, setShowBookmarkedOnly] = useState(false);
  const [sortCol, setSortCol] = useState('closing_date');
  const [sortDir, setSortDir] = useState('asc');
  const [selectedId, setSelectedId] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(loadTenderFilterState);
  const columns = useTenderColumns(tab);
  const { renderTenderCell } = useTenderRowActions();

  // Filter selections are saved locally and re-applied automatically to any
  // freshly-synced tender data (the filter runs client-side over whatever
  // `tenders` currently holds), so a sync never clears the user's choices.
  useEffect(() => {
    try { localStorage.setItem(TENDERS_FILTER_STATE_KEY, JSON.stringify(filters)); } catch { /* ignore storage failures */ }
  }, [filters]);

  // WIRE: list of tenders visible to the client. Assumes the same
  // api.listTenders(websiteId, opts) shape as the operator app, called
  // across all configured sources rather than filtered by a single website.
  const { data: tenders, isLoading } = useQuery({
    queryKey: ['client-tenders', tab],
    queryFn: () => api.listTenders(null, { archived: tab === 'archived', limit: 5000 }),
  });

  // Same pull as Settings' "Sync Tenders" button (api.js:syncFromServer) —
  // just reachable without leaving the Online Tenders tab.
  const refreshTenders = useMutation({
    mutationFn: () => api.syncFromServer(),
    onSuccess: () => qc.invalidateQueries(),
    onError: (err) => alert(`Refresh failed: ${err?.message || String(err)}`),
  });

  const uniqueOrgs = useMemo(
    () => [...new Set((tenders || []).map((t) => t.org_chain).filter(Boolean))].sort(),
    [tenders]
  );
  const uniqueLocations = useMemo(
    () => [...new Set((tenders || []).map((t) => t.location).filter(Boolean))].sort(),
    [tenders]
  );
  const uniqueCategories = useMemo(
    () => [...new Set((tenders || []).map((t) => t.tender_category).filter(Boolean))].sort(),
    [tenders]
  );
  const uniqueWebsites = useMemo(
    () => [...new Set((tenders || []).map((t) => t.website_name).filter(Boolean))].sort(),
    [tenders]
  );

  // Exactly one website must always be selected — pick the first one the
  // moment there's a real list and the current selection is empty/stale.
  useEffect(() => {
    if (uniqueWebsites.length === 0) return;
    if (!filters.website || !uniqueWebsites.includes(filters.website)) {
      setFilters((f) => ({ ...f, website: uniqueWebsites[0] }));
    }
  }, [uniqueWebsites, filters.website]);

  const filtered = useMemo(() => {
    let list = tenders || [];
    if (showBookmarkedOnly) list = list.filter((t) => t.is_bookmarked);
    if (filters.org) list = list.filter((t) => t.org_chain === filters.org);
    if (filters.location) list = list.filter((t) => t.location === filters.location);
    if (filters.category) list = list.filter((t) => t.tender_category === filters.category);
    if (filters.website) list = list.filter((t) => t.website_name === filters.website);
    if (closingSoonOnly) list = list.filter((t) => { const r = timeRemaining(t.closing_date); return !r.expired && r.totalDays >= 0 && r.totalDays <= 7; });
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) => Object.values(t).some((v) => String(v ?? '').toLowerCase().includes(q)));
    }
    return [...list].sort((a, b) => {
      const c = smartCmp(a[sortCol] ?? '', b[sortCol] ?? '');
      return sortDir === 'asc' ? c : -c;
    });
  }, [tenders, showBookmarkedOnly, filters, closingSoonOnly, search, sortCol, sortDir]);

  const toggleSort = (key) => {
    if (sortCol === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(key); setSortDir('asc'); }
  };

  const exportCurrent = () => {
    const exportColumns = columns.visibleTenderColumns.filter((column) => !TENDER_NON_SORTABLE.has(column.key));
    exportCSV(
      exportColumns.map((column) => column.label),
      filtered,
      exportColumns.map((column) => column.key),
      `tenders_${tab}_${new Date().toISOString().slice(0, 10)}.csv`
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="space-y-2 border-b border-[var(--border)] bg-[var(--surface-0)] px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {cameFromOrg && (
              <button onClick={onBackToOrganizations} className="btn-ghost gap-1.5 text-xs shrink-0">
                <ArrowLeft size={13} />Back to Organizations
              </button>
            )}
            <h1 className="text-lg font-bold text-[var(--text)]">Online Tenders</h1>
            <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--text-muted)]">{filtered.length}</span>
          </div>
          <button onClick={() => refreshTenders.mutate()} disabled={refreshTenders.isPending} className="btn-secondary flex items-center gap-2 text-sm">
            {refreshTenders.isPending ? <Spinner size={14} /> : <RefreshCw size={14} />} Sync Now
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[180px] max-w-sm flex-1">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="input-field h-8 w-full text-sm" />
            {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)]"><X size={14} /></button>}
          </div>
          <select
            value={filters.website}
            onChange={(e) => setFilters((f) => ({ ...f, website: e.target.value }))}
            className="input-field h-8 w-auto max-w-[180px] text-xs"
          >
            {uniqueWebsites.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
          <button
            onClick={() => setShowBookmarkedOnly((v) => !v)}
            className={cn('btn-ghost gap-1.5 text-xs', showBookmarkedOnly && 'bg-[var(--accent-bg)] text-[var(--accent)]')}
          >
            <Star size={13} />Bookmarked
          </button>
          <button
            onClick={() => setClosingSoonOnly((v) => !v)}
            className={cn('btn-ghost gap-1.5 text-xs', closingSoonOnly && 'bg-[var(--accent-bg)] text-[var(--accent)]')}
          >
            <Clock size={13} />Closing ≤7d
          </button>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cn('btn-ghost gap-1.5 text-xs', (showFilters || filters.org || filters.location || filters.category) && 'bg-[var(--accent-bg)] text-[var(--accent)]')}
            title="Organization / Location / Category filters"
          >
            <Filter size={13} />Filters
          </button>
          <div className="flex-1" />
          <TenderColumnsMenuButton
            orderedTenderColumns={columns.orderedTenderColumns}
            tenderHidden={columns.tenderHidden}
            toggleTenderCol={columns.toggleTenderCol}
            reorderMovableColumn={columns.reorderMovableColumn}
          />
          <button onClick={exportCurrent} className="btn-ghost gap-1.5 text-xs"><FileDown size={13} />Export CSV</button>
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
              <select value={filters.location} onChange={(e) => setFilters((f) => ({ ...f, location: e.target.value }))} className="input-field h-8 w-full text-xs">
                <option value="">All</option>
                {uniqueLocations.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Category</label>
              <select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} className="input-field h-8 w-full text-xs">
                <option value="">All</option>
                {uniqueCategories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex items-end"><button onClick={() => setFilters((f) => ({ ...f, org: '', location: '', category: '' }))} className="btn-ghost text-xs">Clear</button></div>
          </div>
        )}
        <div className="-mx-6 -mb-3 mt-1 flex border-t border-[var(--border)] px-6">
          {[{ key: 'active', label: 'Active Tenders' }, { key: 'archived', label: 'Archived' }].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn('border-b-2 px-4 py-2.5 text-sm font-medium transition-colors', tab === t.key ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]')}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <TenderTable
          columns={columns.visibleTenderColumns}
          getColWidth={columns.getTenderColWidth}
          tableWidth={columns.tenderTableWidth}
          sortCol={sortCol}
          sortDir={sortDir}
          onToggleSort={toggleSort}
          onStartResize={columns.startTenderColResize}
          rows={filtered}
          isLoading={isLoading}
          emptyState={<EmptyState icon={Globe} title="No tenders" description={search ? `No tenders match "${search}"` : 'No tenders to show yet.'} />}
          renderCell={renderTenderCell}
          selectedId={selectedId}
          onSelectRow={(t) => setSelectedId(t.id === selectedId ? null : t.id)}
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ORGANIZATIONS  — browse every organization synced from the server (not just
   bookmarked ones), bookmark from here, and jump to that org's Active tenders.
   ═══════════════════════════════════════════════════════════════════════════ */
function OrganizationsPage({ onOpenOrgTenders }) {
  const qc = useQueryClient();
  const { organizationsTable, setOrganizationsColumnWidth } = useAppStore();
  // Persisted across navigating away and back (e.g. via Tenders' "Back to
  // Organizations" button) — only changes when the user edits the box.
  const [search, setSearch] = useState(() => { try { return sessionStorage.getItem(ORGANIZATIONS_SEARCH_KEY) || ''; } catch { return ''; } });
  // One-shot: a Website Coverage card on the Dashboard sets this immediately
  // before navigating here so that website is preselected/filtered.
  const [website, setWebsite] = useState(() => {
    try {
      const forced = sessionStorage.getItem(ORGANIZATIONS_FORCE_WEBSITE_KEY);
      if (forced !== null) { sessionStorage.removeItem(ORGANIZATIONS_FORCE_WEBSITE_KEY); return forced; }
    } catch { /* ignore storage failures */ }
    return '';
  });
  const [sortCol, setSortCol] = useState('tender_count');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    try { sessionStorage.setItem(ORGANIZATIONS_SEARCH_KEY, search); } catch { /* ignore storage failures */ }
  }, [search]);

  const { data: organizations, isLoading } = useQuery({ queryKey: ['organizations'], queryFn: api.listOrganizations });
  const { data: bookmarkedOrgs } = useQuery({ queryKey: ['bookmarked-orgs'], queryFn: api.listBookmarkedOrgs });
  const bookmarkedOrgsSet = useMemo(() => new Set(bookmarkedOrgs || []), [bookmarkedOrgs]);
  const toggleOrgBookmark = useMutation({
    mutationFn: (org) => api.toggleOrgBookmark(org),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookmarked-orgs'] }),
  });

  const uniqueWebsites = useMemo(
    () => [...new Set((organizations || []).map((o) => o.website_name).filter(Boolean))].sort(),
    [organizations]
  );

  // Exactly one website must always be selected — pick the first one the
  // moment there's a real list and the current selection is empty/stale.
  useEffect(() => {
    if (uniqueWebsites.length === 0) return;
    if (!website || !uniqueWebsites.includes(website)) setWebsite(uniqueWebsites[0]);
  }, [uniqueWebsites, website]);

  const filtered = useMemo(() => {
    let list = organizations || [];
    if (website) list = list.filter((o) => o.website_name === website);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((o) => o.name.toLowerCase().includes(q) || (o.website_name || '').toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      const c = smartCmp(a[sortCol] ?? '', b[sortCol] ?? '');
      return sortDir === 'asc' ? c : -c;
    });
  }, [organizations, website, search, sortCol, sortDir]);

  const toggleSort = (key) => {
    if (sortCol === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(key); setSortDir(key === 'tender_count' ? 'desc' : 'asc'); }
  };

  const columns = [
    { key: '_sr', label: 'Sr. No.', width: 64 },
    { key: '_bookmark', label: 'Bookmark', width: 90 },
    { key: 'name', label: 'Organization', width: 320 },
    { key: 'website_name', label: 'Website', width: 200 },
    { key: 'tender_count', label: 'Tenders', width: 110 },
  ];
  const NON_SORTABLE_ORG_COLS = new Set(['_sr', '_bookmark']);
  const getOrgColWidth = (c) => { const v = organizationsTable.columnWidths?.[c.key]; return Number.isFinite(v) && v > 0 ? v : c.width; };
  const startOrgColResize = (col, startX) => {
    const min = col.key === '_sr' ? 48 : 70;
    const sw = getOrgColWidth(col);
    const onMove = (e) => setOrganizationsColumnWidth(col.key, Math.max(min, sw + (e.clientX - startX)));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-[var(--border)] bg-[var(--surface-0)] px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-bold text-[var(--text)]">Organizations</h1>
            <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--text-muted)]">{filtered.length}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[180px] max-w-sm flex-1">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search organizations..." className="input-field h-8 w-full text-sm" />
            {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)]"><X size={14} /></button>}
          </div>
          <select
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            className="input-field h-8 w-auto max-w-[180px] text-xs"
          >
            {uniqueWebsites.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner size={24} className="text-[var(--accent)]" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Building2} title="No organizations" description={search ? `No organizations match "${search}"` : 'Sync from the server to load organizations.'} />
        ) : (
          <table className="data-table" style={{ tableLayout: 'fixed', width: '100%' }}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    style={{ width: getOrgColWidth(c), textAlign: c.key === 'tender_count' || c.key === '_bookmark' || c.key === '_sr' ? 'center' : 'left' }}
                    className={cn('relative', !NON_SORTABLE_ORG_COLS.has(c.key) && 'cursor-pointer')}
                    onClick={() => !NON_SORTABLE_ORG_COLS.has(c.key) && toggleSort(c.key)}
                  >
                    {c.label}{sortCol === c.key && <span className="ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>}
                    <div
                      className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-[var(--accent)]/20"
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startOrgColResize(c, e.clientX); }}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((org, i) => (
                <tr key={org.id} className="cursor-pointer" onClick={() => onOpenOrgTenders?.(org.name, org.website_name)}>
                  <td className="text-center text-xs text-[var(--text-muted)]">{i + 1}</td>
                  <td className="text-center">
                    <button
                      onClick={(event) => { event.stopPropagation(); toggleOrgBookmark.mutate(org.name); }}
                      className={cn('inline-flex h-7 w-7 items-center justify-center rounded transition-colors', bookmarkedOrgsSet.has(org.name) ? 'text-amber-400' : 'text-[var(--text-muted)] hover:text-amber-400')}
                      title={bookmarkedOrgsSet.has(org.name) ? 'Remove bookmark' : 'Bookmark organization'}
                    >
                      <Bookmark size={16} fill={bookmarkedOrgsSet.has(org.name) ? 'currentColor' : 'none'} />
                    </button>
                  </td>
                  <td className="text-sm">{org.name}</td>
                  <td className="text-xs text-[var(--text-muted)]">{org.website_name || '—'}</td>
                  <td className="text-center text-xs">{org.tender_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   BOOKMARKS  — saved tenders only (organization bookmarking lives on the
   Organizations page). Renders through the same TenderTable/column system as
   Online Tenders so a bookmarked tender looks and behaves identically there.
   ═══════════════════════════════════════════════════════════════════════════ */
function BookmarksPage() {
  const [sortCol, setSortCol] = useState('closing_date');
  const [sortDir, setSortDir] = useState('asc');
  const [selectedId, setSelectedId] = useState(null);
  const columns = useTenderColumns('bookmarks');
  const { renderTenderCell } = useTenderRowActions();

  // Needs both active and archived tenders in one list — listTenders only
  // applies the `archived` filter when that key is present in params.
  const { data: tenders, isLoading } = useQuery({
    queryKey: ['client-tenders-bookmarked'],
    queryFn: () => api.listTenders(null, { limit: 5000 }),
  });

  const bookmarkedRows = useMemo(() => {
    const list = (tenders || []).filter((t) => t.is_bookmarked);
    return [...list].sort((a, b) => {
      const c = smartCmp(a[sortCol] ?? '', b[sortCol] ?? '');
      return sortDir === 'asc' ? c : -c;
    });
  }, [tenders, sortCol, sortDir]);

  const toggleSort = (key) => {
    if (sortCol === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(key); setSortDir('asc'); }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border)] bg-[var(--surface-0)] px-6 py-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-lg font-bold text-[var(--text)]">Bookmarks</h1>
          <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--text-muted)]">{bookmarkedRows.length}</span>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <TenderTable
          columns={columns.visibleTenderColumns}
          getColWidth={columns.getTenderColWidth}
          tableWidth={columns.tenderTableWidth}
          sortCol={sortCol}
          sortDir={sortDir}
          onToggleSort={toggleSort}
          onStartResize={columns.startTenderColResize}
          rows={bookmarkedRows}
          isLoading={isLoading}
          emptyState={<EmptyState icon={Star} title="No bookmarked tenders" description="Star a tender in Online Tenders to see it here." />}
          renderCell={renderTenderCell}
          selectedId={selectedId}
          onSelectRow={(t) => setSelectedId(t.id === selectedId ? null : t.id)}
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PROJECTS  (list / cards, create, edit, checklist, archive)
   — dropped: "Fetch" tender-autofill button that matched against scraped
     tender data. Manual entry / editing only.
   ═══════════════════════════════════════════════════════════════════════════ */
function sanitizeFolderLeaf(value, fallback = 'Project') {
  const txt = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  return txt || fallback;
}

const PROJECT_COLUMNS = [
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

function StatsBar({ projects }) {
  const total = projects.length;
  const active = projects.filter(p => p.status === 'Active').length;
  const totalValue = projects.reduce((sum, p) => {
    const n = parseFloat(String(p.project_value || '').replace(/[₹,\s]/g, ''));
    return sum + (isNaN(n) ? 0 : n);
  }, 0);
  const fmt = (n) => n >= 1e7 ? `₹${(n / 1e7).toFixed(1)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : `₹${n.toLocaleString('en-IN')}`;

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

function Ring({ done, total, size = 34 }) {
  const pct = total ? done / total : 0;
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const col = pct === 1 ? '#10b981' : pct >= 0.6 ? 'var(--accent)' : '#f59e0b';
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={4} />
      {total > 0 && (
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={4} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={9} fontWeight={700} fill="var(--text)">{done}/{total}</text>
    </svg>
  );
}

function ProjectCard({ project, isSelected, isFocused, onClick, onDoubleClick }) {
  const { data: checklist } = useQuery({ queryKey: ['project-checklist-ring', project.id], queryFn: () => api.listChecklist(project.id) });
  const done = (checklist || []).filter((i) => i.status === 'Completed').length;
  const total = (checklist || []).length;
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
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <Ring done={done} total={total} />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-mono text-[var(--accent)] mb-1 truncate">{project.source_tender_id || '—'}</p>
            <p className="text-sm font-semibold text-[var(--text)] line-clamp-2 leading-snug">{project.title || 'Untitled'}</p>
          </div>
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

function ProjectsPage({ onOpenProjectWorkspace, archived = false }) {
  const qc = useQueryClient();
  const projectStatus = archived ? 'Archived' : 'Active';
  const { projectsTable, setProjectsHiddenColumns, setProjectsColumnOrder, setProjectsColumnWidth } = useAppStore();

  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState('table');
  const [selId, setSelId] = useState(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState([]);
  const [projectFocusId, setProjectFocusId] = useState(null);
  const [lastProjectClickedId, setLastProjectClickedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [formEditable, setFormEditable] = useState(true);
  const [showColsMenu, setShowColsMenu] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [form, setForm] = useState({ title: '', client_name: '', source_tender_id: '', project_value: '', prebid: '', deadline: '', description: '', status: projectStatus });
  const [newChecklistItem, setNewChecklistItem] = useState({ req_file_name: '', description: '', subfolder: 'Main' });
  const [confirmDelIds, setConfirmDelIds] = useState([]);

  const desktop = window.bidmanagerDesktop;

  const { data: projects, isLoading } = useQuery({ queryKey: ['projects', projectStatus, search], queryFn: () => api.listProjects(search, projectStatus) });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const projectsEntryMode = String(settings?.projects_entry_mode || 'inline').toLowerCase() === 'popup' ? 'popup' : 'inline';
  const selectedProject = useMemo(() => (projects || []).find((p) => p.id === selId) || null, [projects, selId]);
  const { data: checklist, isLoading: checklistLoading } = useQuery({ queryKey: ['project-checklist', selId], queryFn: () => api.listChecklist(selId), enabled: !!selId && showDetails });

  const createProject = useMutation({ mutationFn: (d) => api.createProject(d), onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); resetForm(); } });
  const updateProject = useMutation({ mutationFn: ({ id, data }) => api.updateProject(id, data), onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); resetForm(); } });
  const deleteProject = useMutation({
    mutationFn: async (ids) => {
      const uniqueIds = Array.from(new Set(ids.map(Number).filter(x => Number.isFinite(x) && x > 0)));
      if (!uniqueIds.length) return { ok: true };
      if (archived) await Promise.all(uniqueIds.map(id => api.deleteProject(id)));
      else await Promise.all(uniqueIds.map(id => api.archiveProject(id)));
      return { ok: true };
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'], refetchType: 'all' }); qc.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'all' }); setSelId(null); setSelectedProjectIds([]); setProjectFocusId(null); setLastProjectClickedId(null); setConfirmDelIds([]); },
    onError: (err) => alert(`${archived ? 'Delete' : 'Archive'} failed: ${err?.message || String(err)}`),
  });
  const restoreProjects = useMutation({
    mutationFn: () => api.restoreProjectsFromFolders(),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ['projects'], refetchType: 'all' }); qc.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'all' }); alert(`Restore complete\nScanned: ${res.scanned_folders}\nCreated: ${res.created_projects}\nUpdated: ${res.updated_projects}\nChecklist restored: ${res.restored_checklist_items}`); },
    onError: (err) => alert(`Restore failed: ${err?.message || String(err)}`),
  });
  const createChecklistItem = useMutation({ mutationFn: (p) => api.createChecklistItem(p.projectId, { req_file_name: p.req_file_name, description: p.description, subfolder: p.subfolder, status: 'Pending' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['project-checklist', selId] }); setNewChecklistItem({ req_file_name: '', description: '', subfolder: 'Main' }); } });
  const updateChecklistItem = useMutation({ mutationFn: ({ itemId, data }) => api.updateChecklistItem(itemId, data), onSuccess: () => qc.invalidateQueries({ queryKey: ['project-checklist', selId] }) });
  const deleteChecklistItem = useMutation({ mutationFn: (itemId) => api.deleteChecklistItem(itemId), onSuccess: () => qc.invalidateQueries({ queryKey: ['project-checklist', selId] }) });

  const resetForm = () => { setForm({ title: '', client_name: '', source_tender_id: '', project_value: '', prebid: '', deadline: '', description: '', status: projectStatus }); setShowForm(false); setEditMode(false); setFormEditable(true); };
  const loadIntoForm = (p) => { setForm({ title: p.title || '', client_name: p.client_name || '', source_tender_id: p.source_tender_id || '', project_value: p.project_value || '', prebid: p.prebid || '', deadline: p.deadline || '', description: p.description || '', status: p.status || 'Active' }); setSelId(p.id); setSelectedProjectIds([p.id]); setProjectFocusId(p.id); setLastProjectClickedId(p.id); setEditMode(true); setFormEditable(false); setShowForm(true); };
  const handleSubmit = () => { if (!form.title.trim()) return; if (editMode && selId) updateProject.mutate({ id: selId, data: form }); else createProject.mutate(form); };
  const uf = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const canEditForm = !editMode || formEditable;
  const copyText = async (v) => { try { await navigator.clipboard.writeText(String(v || '')); } catch { /* silent */ } };

  const openSelectedProjectFolder = async () => {
    if (!desktop?.openPath) { alert('Open Folder is available in the desktop app.'); return; }
    let rootFolder = '';
    try { const root = await api.getProjectsRootFolder(archived); rootFolder = String(root?.root_folder || '').trim(); } catch { /* compat */ }
    const rootCandidates = archived ? [rootFolder, 'backend/Archived Projects', 'Archived Projects'].filter(Boolean) : [rootFolder, 'backend/My_Tender_Projects', 'My_Tender_Projects'].filter(Boolean);
    if (archived) { try { const ar = await api.getProjectsRootFolder(false); const arp = String(ar?.root_folder || '').trim(); if (arp) { const p = arp.replace(/\\/g, '/').replace(/\/+$/, '').split('/').slice(0, -1).join('/'); if (p) rootCandidates.push(`${p}/Archived Projects`); } } catch { /* ignore */ } }
    const pc = []; let sti = ''; let st = '';
    if (selId) {
      let lp = null;
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

  const openProjectWorkspace = async (project) => {
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

  const applyRange = (project, additive) => {
    if (!lastProjectClickedId) return false;
    const ai = filtered.findIndex(x => x.id === lastProjectClickedId);
    const ci = filtered.findIndex(x => x.id === project.id);
    if (ai < 0 || ci < 0) return false;
    const rangeIds = filtered.slice(Math.min(ai, ci), Math.max(ai, ci) + 1).map(x => x.id);
    setSelectedProjectIds(additive ? Array.from(new Set([...selectedProjectIds, ...rangeIds])) : rangeIds);
    setSelId(project.id); setProjectFocusId(project.id);
    return true;
  };

  const handleProjectRowClick = (project, evt) => {
    setConfirmDelIds([]);
    const ctrl = evt.ctrlKey || evt.metaKey;
    if (evt.shiftKey && applyRange(project, ctrl)) { setLastProjectClickedId(project.id); return; }
    if (ctrl) { const e = selectedProjectIds.includes(project.id); setSelectedProjectIds(e ? selectedProjectIds.filter(id => id !== project.id) : [...selectedProjectIds, project.id]); setSelId(project.id); setProjectFocusId(project.id); setLastProjectClickedId(project.id); return; }
    if (selectedProjectIds.length === 1 && selectedProjectIds[0] === project.id) { setSelectedProjectIds([]); setSelId(null); setProjectFocusId(project.id); setLastProjectClickedId(project.id); return; }
    setSelectedProjectIds([project.id]); setSelId(project.id); setProjectFocusId(project.id); setLastProjectClickedId(project.id);
  };

  const onProjectsKeyDown = (evt) => {
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
  const orderedProjectCols = useMemo(() => { const byKey = new Map(PROJECT_COLUMNS.map(c => [c.key, c])); return projectColOrder.map(k => byKey.get(k)).filter(Boolean); }, [projectColOrder]);
  const visibleProjectCols = orderedProjectCols.filter(c => c.fixed || !projectHidden.has(c.key));
  const getProjectColWidth = (c) => { const v = projectsTable.columnWidths?.[c.key]; return Number.isFinite(v) && v > 0 ? v : c.width; };
  const toggleProjectCol = (key) => { const n = new Set(projectHidden); if (n.has(key)) n.delete(key); else n.add(key); setProjectsHiddenColumns(Array.from(n)); };
  const moveProjectCol = (from, to) => { if (from === to) return; const n = [...projectColOrder]; const [item] = n.splice(from, 1); n.splice(to, 0, item); setProjectsColumnOrder(n); };
  const startProjectColResize = (col, startX) => {
    const min = col.key === '_sr' ? 48 : 90; const sw = getProjectColWidth(col);
    const onMove = (e) => setProjectsColumnWidth(col.key, Math.max(min, sw + (e.clientX - startX)));
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };

  useEffect(() => { const iv = setInterval(() => qc.invalidateQueries({ queryKey: ['projects'] }), 60_000); return () => clearInterval(iv); }, [qc]);

  const CopyBtn = ({ val }) => (
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
          <div className="relative"><input value={form.source_tender_id} readOnly={!canEditForm} onChange={e => uf('source_tender_id', e.target.value)} placeholder="2025/PWD/MH/12345" className="input-field h-9 w-full pr-8 text-sm" /><CopyBtn val={form.source_tender_id} /></div>
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

  return (
    <div className="flex h-full flex-col">
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
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={archived ? 'Search archived…' : 'Search projects…'} className="input-field h-9 w-full text-sm" style={{ paddingLeft: '2.25rem' }} />
            {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)]"><X size={13} /></button>}
          </div>
          <div className="h-5 w-px bg-[var(--border)]" />
          <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-0.5 gap-0.5">
            {['table', 'cards'].map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)} className={cn('flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs transition-all', viewMode === mode ? 'bg-[var(--surface-0)] text-[var(--text)] shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text)]')}>
                {mode === 'table' ? <><List size={13} />Table</> : <><LayoutGrid size={13} />Cards</>}
              </button>
            ))}
          </div>
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

      {!isLoading && filtered.length > 0 && <StatsBar projects={filtered} />}

      {!archived && showForm && projectsEntryMode === 'inline' && (
        <div className="border-b border-[var(--border)] bg-[var(--surface-1)] px-6 py-5">{projectForm}</div>
      )}

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
                    return <td key={c.key} className="text-sm">{String(p[c.key] || '—')}</td>;
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

/* ═══════════════════════════════════════════════════════════════════════════
   PROJECT WORKSPACE
   — dropped: "Fetch tender info" (scraper + CAPTCHA sync) and "Check for
     Corrigendum" (scraper re-sync + CAPTCHA fallback). Tender ID / title /
     value / dates are edited manually here instead. Everything else —
     checklist by folder, local file attach/rename/delete, preview panel,
     manage-folders, save/apply template — is unchanged.
   ═══════════════════════════════════════════════════════════════════════════ */
const FOLDER_ORDER = ['Ready Docs', 'Tender Docs', 'Working Docs'];

function widenDateTimeGap(value) {
  const txt = String(value || '').trim();
  if (!txt) return '';
  return txt.replace(/(\d{2}-[A-Za-z]{3}-\d{4})\s+(\d{1,2}:\d{2}\s*(?:AM|PM))/i, '$1   $2');
}

function normalizeValue2dp(value) {
  const txt = String(value || '').trim();
  if (!txt) return '';
  const stripped = txt.replace(/[₹,\s]/g, '').replace(/Rs\.?/i, '').replace(/INR/i, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(stripped)) return txt;
  const n = Number(stripped);
  if (!Number.isFinite(n)) return txt;
  return n.toFixed(2);
}

function addIndianCommas(value) {
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

const WORKSPACE_VIEW_KEY = (projectId) => `bm-workspace-view-${projectId}`;

function fileNameOnly(path) {
  const txt = String(path || '');
  if (!txt) return '';
  const parts = txt.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || txt;
}

function sanitizeFileName(name) {
  return String(name || '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();
}

function toFileUrl(localPath) {
  return `file:///${encodeURI(localPath.replace(/\\/g, '/'))}`;
}

function parseDeadlineText(input) {
  const txt = String(input || '').trim();
  if (!txt) return null;
  const native = new Date(txt);
  if (!Number.isNaN(native.getTime())) return native;
  const m = txt.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AP]M))?$/i);
  if (!m) return null;
  const monMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const month = monMap[m[2].toLowerCase()];
  if (month === undefined) return null;
  let hour = Number(m[4] || '0');
  const ampm = String(m[6] || '').toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  const dt = new Date(Number(m[3]), month, Number(m[1]), hour, Number(m[5] || '0'), 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function getTimeRemaining(deadline) {
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

function WorkspaceCopyBtn({ val, className }) {
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

function InfoField({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">{label}</label>
      {children}
    </div>
  );
}

function ToolBtn({ icon: Icon, label, onClick, disabled, danger, active }) {
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

function ProjectWorkspacePage({ projectId, embedded = false }) {
  const qc = useQueryClient();
  const [docName, setDocName] = useState('');
  const [desc, setDesc] = useState('');
  const [folder, setFolder] = useState('Ready Docs');
  const [selectedId, setSelectedId] = useState(null);
  const [infoEditable, setInfoEditable] = useState(false);
  const [infoForm, setInfoForm] = useState({ source_tender_id: '', title: '', client_name: '', project_value: '', prebid: '', deadline: '' });
  const [previewWidth, setPreviewWidth] = useState(330);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [managedFolders, setManagedFolders] = useState([]);
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

  const desktop = window.bidmanagerDesktop;

  const { data: project, isLoading: projectLoading } = useQuery({ queryKey: ['project', projectId], queryFn: () => api.getProject(projectId) });
  const { data: checklist, isLoading: checklistLoading } = useQuery({ queryKey: ['project-checklist', projectId], queryFn: () => api.listChecklist(projectId) });
  const { data: allTemplates } = useQuery({ queryKey: ['templates'], queryFn: () => api.listTemplates(), enabled: applyTemplateOpen });

  const createItem = useMutation({
    mutationFn: () => api.createChecklistItem(projectId, { req_file_name: docName.trim(), description: desc.trim(), subfolder: folder, status: 'Pending' }),
    onSuccess: () => { setDocName(''); setDesc(''); qc.invalidateQueries({ queryKey: ['project-checklist', projectId] }); },
  });
  const updateItem = useMutation({
    mutationFn: (itemId) => api.updateChecklistItem(itemId, { req_file_name: docName.trim(), description: desc.trim(), subfolder: folder }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-checklist', projectId] }),
  });
  const deleteItem = useMutation({
    mutationFn: (itemId) => api.deleteChecklistItem(itemId),
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
    const names = new Set(FOLDER_ORDER);
    for (const f of managedFolders) { const c = String(f || '').trim(); if (c) names.add(c); }
    for (const row of checklist || []) { const c = String(row.subfolder || '').trim(); if (c) names.add(c); }
    const picked = String(folder || '').trim(); if (picked) names.add(picked);
    return Array.from(names);
  }, [managedFolders, checklist, folder]);

  const grouped = useMemo(() => {
    const source = checklist || [];
    const map = new Map();
    for (const key of folderOptions) map.set(key, []);
    for (const row of source) { const key = (row.subfolder || 'Ready Docs').trim() || 'Ready Docs'; if (!map.has(key)) map.set(key, []); map.get(key).push(row); }
    const ordered = [...FOLDER_ORDER.filter(k => map.has(k)), ...[...map.keys()].filter(k => !FOLDER_ORDER.includes(k)).sort()];
    return ordered.map(name => ({ name, rows: map.get(name) || [] }));
  }, [checklist, folderOptions]);

  const totalItems = (checklist || []).length;
  const completedItems = (checklist || []).filter(x => x.status === 'Completed').length;
  const progressPct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

  const projectFolderPath = useMemo(() => {
    const direct = String(project?.folder_path || '').trim();
    if (direct) return direct;
    const knownFolders = new Set([...FOLDER_ORDER, ...managedFolders, ...(checklist || []).map(x => String(x.subfolder || '').trim())].map(x => String(x || '').trim().toLowerCase()).filter(Boolean));
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

  const openPath = async (path) => { if (!path.trim() || !desktop?.openPath) return; await desktop.openPath(path); };

  const resolveExistingProjectFolder = async () => {
    let lp = null;
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
    if (!desktop?.openPath) { alert('Open Folder is available in the desktop app.'); return; }
    const existing = await resolveExistingProjectFolder();
    const candidates = Array.from(new Set([existing].map(x => String(x || '').trim()).filter(Boolean)));
    if (!candidates.length) { alert('Project folder is not available.'); return; }
    let msg = '';
    for (const c of candidates) { const res = await desktop.openPath(c); if (res?.ok) return; msg = String(res?.message || ''); }
    alert(msg ? `Open folder failed: ${msg}` : 'Project folder is not available.');
  };

  const uf = (k, v) => setInfoForm(prev => ({ ...prev, [k]: v }));

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

  const handleApplyTemplate = async (templateId) => {
    try {
      const result = await api.applyTemplateToProject(projectId, templateId);
      setApplyTemplateOpen(false);
      qc.invalidateQueries({ queryKey: ['project-checklist', projectId] });
      alert(`Template applied. ${result.added} item(s) added.`);
    } catch (err) { alert(`Apply template failed: ${err instanceof Error ? err.message : String(err)}`); }
  };

  const attachFile = async () => {
    if (!desktop?.pickPath || !desktop?.copyFileToFolder) { alert('File attachment is available in the desktop app.'); return; }
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

  const startPreviewResize = (startX) => {
    const startW = previewWidth;
    const onMove = (evt) => { const next = Math.max(240, Math.min(680, startW - (evt.clientX - startX))); setPreviewWidth(next); if (previewCollapsed) setPreviewCollapsed(false); };
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

  const ensureFolder = (name) => {
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

  useEffect(() => {
    if (!embedded) return;
    const onEditToggle = () => setInfoEditable(v => !v);
    const onSave = () => { if (!infoEditable || updateProjectInfo.isPending) return; updateProjectInfo.mutate(); };
    const onOpenFolder = () => { void openProjectFolder(); };
    window.addEventListener('bm-workspace-edit-toggle', onEditToggle);
    window.addEventListener('bm-workspace-save', onSave);
    window.addEventListener('bm-workspace-open-folder', onOpenFolder);
    return () => {
      window.removeEventListener('bm-workspace-edit-toggle', onEditToggle);
      window.removeEventListener('bm-workspace-save', onSave);
      window.removeEventListener('bm-workspace-open-folder', onOpenFolder);
    };
  }, [embedded, infoEditable, updateProjectInfo.isPending, projectFolderPath]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WORKSPACE_VIEW_KEY(projectId));
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (typeof saved.selectedId === 'number' || saved.selectedId === null) setSelectedId(saved.selectedId ?? null);
      if (typeof saved.folder === 'string' && saved.folder.trim()) setFolder(saved.folder.trim());
      if (typeof saved.previewWidth === 'number' && Number.isFinite(saved.previewWidth)) setPreviewWidth(Math.max(240, Math.min(680, saved.previewWidth)));
      if (typeof saved.previewCollapsed === 'boolean') setPreviewCollapsed(saved.previewCollapsed);
      if (typeof saved.infoEditable === 'boolean') setInfoEditable(saved.infoEditable);
      if (Array.isArray(saved.managedFolders)) setManagedFolders(saved.managedFolders.map((x) => String(x || '').trim()).filter(Boolean));
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

  if (projectLoading) return <div className="flex h-full items-center justify-center"><Spinner size={24} className="text-[var(--accent)]" /></div>;

  return (
    <div className={cn('flex flex-col bg-[var(--bg)] text-[var(--text)]', embedded ? 'h-full' : 'h-screen')}>
      {/* ── Info Panel ─────────────────────────────────────────────────────── */}
      <div className="border-b border-[var(--border)] bg-[var(--surface-0)] px-5 py-3">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2 mb-3">
          <div className="min-w-[190px] flex-[2.3]">
            <InfoField label="Tender ID">
              <div className="relative">
                <input value={infoForm.source_tender_id} readOnly={!infoEditable} onChange={e => uf('source_tender_id', e.target.value)} className="input-field h-8 w-full text-xs" style={{ paddingRight: '2rem' }} />
                <WorkspaceCopyBtn val={infoForm.source_tender_id} />
              </div>
            </InfoField>
          </div>
          <div className="min-w-[200px] flex-[3]">
            <InfoField label="Client">
              <div className="relative">
                <input value={infoForm.client_name} readOnly={!infoEditable} onChange={e => uf('client_name', e.target.value)} className="input-field h-8 w-full text-xs" style={{ paddingRight: '2rem' }} />
                <WorkspaceCopyBtn val={infoForm.client_name} />
              </div>
            </InfoField>
          </div>
          <div className="min-w-[120px] flex-[1.2]">
            <InfoField label="Value">
              <div className="relative">
                <input value={addIndianCommas(infoForm.project_value)} readOnly={!infoEditable} onChange={e => uf('project_value', e.target.value.replace(/,/g, ''))} className="input-field h-8 w-full text-xs" style={{ paddingRight: '2rem' }} />
                <WorkspaceCopyBtn val={infoForm.project_value} />
              </div>
            </InfoField>
          </div>
          <div className="min-w-[180px] flex-[1.7]">
            <InfoField label="Prebid">
              <div className="relative">
                <input value={infoForm.prebid} readOnly={!infoEditable} onChange={e => uf('prebid', e.target.value)} className="input-field h-8 w-full text-xs" style={{ paddingRight: '2rem' }} />
                <WorkspaceCopyBtn val={infoForm.prebid} />
              </div>
            </InfoField>
          </div>
          <div className="min-w-[160px] flex-[1.5]">
            <InfoField label="Deadline">
              <div className="relative">
                <input value={infoForm.deadline} readOnly={!infoEditable} onChange={e => uf('deadline', e.target.value)} className="input-field h-8 w-full text-xs" style={{ paddingRight: '2rem' }} />
                <WorkspaceCopyBtn val={infoForm.deadline} />
              </div>
            </InfoField>
          </div>
        </div>

        <div className="flex gap-4 items-start">
          <div className="flex-1 min-w-0">
            <InfoField label="Name of Work">
              <div className="relative">
                <textarea value={infoForm.title} readOnly={!infoEditable} onChange={e => uf('title', e.target.value)} rows={2} className="input-field w-full resize-none py-2 pr-8 text-xs leading-5" style={{ minHeight: 56, paddingRight: '2rem' }} />
                <WorkspaceCopyBtn val={infoForm.title} className="top-3 -translate-y-0" />
              </div>
            </InfoField>
          </div>
          <div className="shrink-0 w-48 flex flex-col gap-2.5 pt-0.5">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">Progress</span>
                <span className="text-xs font-bold text-[var(--text)]">{progressPct}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-[var(--surface-2)]">
                <div className={cn('h-1.5 rounded-full transition-all', progressPct === 100 ? 'bg-emerald-500' : 'bg-[var(--accent)]')} style={{ width: `${progressPct}%` }} />
              </div>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">{completedItems} of {totalItems} docs ready</p>
            </div>
            {!infoEditable ? (
              <button onClick={() => setInfoEditable(true)} className="btn-secondary gap-1.5 text-xs w-full justify-center"><Pencil size={12} />Edit Info</button>
            ) : (
              <div className="flex gap-1.5">
                <button onClick={() => setInfoEditable(false)} className="btn-ghost text-xs flex-1 justify-center">Cancel</button>
                <button onClick={() => updateProjectInfo.mutate()} disabled={updateProjectInfo.isPending} className="btn-primary gap-1 text-xs flex-1 justify-center">
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
          <input value={docName} onChange={e => setDocName(e.target.value)} placeholder="Document Name" className="input-field h-9 min-w-[160px] flex-1 text-sm" />
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description" className="input-field h-9 min-w-[140px] flex-[1.2] text-sm" />
          <select value={folder} onChange={e => setFolder(e.target.value)} className="input-field h-9 text-sm min-w-[130px]">
            {folderOptions.map(f => <option key={f}>{f}</option>)}
          </select>
          <div className="flex items-center gap-1.5 shrink-0">
            <button disabled={!docName.trim() || createItem.isPending} onClick={() => createItem.mutate()} className="btn-primary gap-1 text-xs h-9"><Plus size={13} />Add Item</button>
            <button onClick={attachFile} className="btn-secondary gap-1 text-xs h-9"><Paperclip size={13} />Attach File</button>
            <button disabled={!selectedItem || updateItem.isPending} onClick={() => selectedItem && updateItem.mutate(selectedItem.id)} className="btn-secondary text-xs h-9 px-3">Update</button>
            <button disabled={!selectedItem || deleteItem.isPending} onClick={deleteSelectedItem} className="btn-danger gap-1 text-xs h-9"><Trash2 size={13} />Delete Item</button>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-0.5 flex-wrap">
          <ToolBtn icon={Link2} label="Open File" disabled={!attachmentPath} onClick={() => openPath(attachmentPath)} />
          <ToolBtn icon={Pencil} label="Rename File" disabled={!attachmentPath} onClick={renameAttachedFile} />
          <ToolBtn icon={Trash2} label="Delete File" disabled={!attachmentPath} onClick={deleteAttachedFile} danger />
          <span className="mx-1 h-4 w-px bg-[var(--border)] shrink-0" />
          <ToolBtn icon={FolderCog} label="Manage Folders" onClick={() => setManageFoldersOpen(true)} />
          <ToolBtn icon={RefreshCw} label="Refresh" onClick={() => qc.invalidateQueries({ queryKey: ['project-checklist', projectId] })} />
          <ToolBtn icon={BookOpen} label="Apply Template" onClick={() => { setTemplateSearch(''); setApplyTemplateOpen(true); }} />
          <span className="mx-1 h-4 w-px bg-[var(--border)] shrink-0" />
          <ToolBtn icon={Save} label="Save Template" onClick={() => { setSaveTemplateForm(f => ({ ...f, template_name: String(project?.title || ''), organization: String(project?.client_name || '') })); setSaveTemplateOpen(true); }} />
        </div>
      </div>

      {/* ── Main Content ────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          {checklistLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Spinner size={18} className="text-[var(--accent)]" />
              <p className="text-xs text-[var(--text-muted)]">Loading checklist…</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th className="w-12">SR</th><th>Document Name</th><th>Description</th><th className="w-32">Status</th><th>Attachment</th></tr>
              </thead>
              <tbody>
                {grouped.map((g, gidx) => (
                  <Fragment key={`group-${g.name}-${gidx}`}>
                    <tr className="group/folder">
                      <td className="bg-[var(--surface-2)]/60 py-1.5"><span className="text-[10px] font-bold text-[var(--text-muted)]">{gidx + 1}</span></td>
                      <td colSpan={4} className="bg-[var(--surface-2)]/60 py-1.5">
                        <div className="flex items-center gap-2">
                          <FolderOpen size={13} className="text-[var(--accent)]/60 shrink-0" />
                          <span className="text-xs font-semibold text-[var(--text)]">{g.name}</span>
                          <span className="text-[10px] text-[var(--text-muted)] ml-1">{g.rows.filter(r => r.status === 'Completed').length}/{g.rows.length}</span>
                        </div>
                      </td>
                    </tr>
                    {g.rows.map((item, i) => (
                      <tr key={item.id} onClick={() => setSelectedId(item.id === selectedId ? null : item.id)} className={cn('cursor-pointer group/row', item.id === selectedId && 'row-selected')}>
                        <td className="text-center text-[var(--text-muted)] text-xs">{i + 1}</td>
                        <td><p className={cn('text-sm', item.status === 'Completed' && 'text-[var(--text-muted)]')}>{item.req_file_name || '-'}</p></td>
                        <td className="text-xs text-[var(--text-muted)]">{item.description || '-'}</td>
                        <td><Badge variant={item.status === 'Completed' ? 'success' : 'muted'}>{item.status}</Badge></td>
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
                    {g.rows.length === 0 && (
                      <tr><td /><td colSpan={4} className="py-2 text-xs text-[var(--text-muted)]/50 italic">No items in this folder</td></tr>
                    )}
                  </Fragment>
                ))}
                {(checklist || []).length === 0 && (
                  <tr><td colSpan={5}><EmptyState icon={FolderOpen} title="No items" description="Add first document item above." /></td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="relative shrink-0 border-l border-[var(--border)] bg-[var(--surface-0)]" style={{ width: previewCollapsed ? 16 : previewWidth }}>
          <button onClick={() => setPreviewCollapsed(v => !v)} className="absolute -left-3 top-1/2 z-10 flex h-10 w-3 -translate-y-1/2 items-center justify-center rounded-l border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors" title={previewCollapsed ? 'Show preview' : 'Hide preview'}>
            {previewCollapsed ? <ChevronLeft size={11} /> : <ChevronRight size={11} />}
          </button>
          {!previewCollapsed && (
            <div className="absolute -left-1 top-0 h-full w-2 cursor-col-resize hover:bg-[var(--accent)]/20 transition-colors" onMouseDown={e => { e.preventDefault(); startPreviewResize(e.clientX); }} title="Resize preview" />
          )}
          <aside className={cn('h-full overflow-auto p-4', previewCollapsed && 'hidden')}>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Preview</h4>
            {!selectedItem ? (
              <p className="text-xs text-[var(--text-muted)]">Select a row to preview details.</p>
            ) : (
              <div className="space-y-3">
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
                <div className="flex items-center gap-2">
                  <Badge variant={selectedItem.status === 'Completed' ? 'success' : 'muted'}>{selectedItem.status}</Badge>
                </div>
                {isImage && attachmentPath && (
                  <img src={toFileUrl(attachmentPath)} alt="Attachment" className="max-h-56 w-full rounded-lg border border-[var(--border)] object-contain" />
                )}
                {isPdf && attachmentPath && (
                  <iframe src={toFileUrl(attachmentPath)} className="h-64 w-full rounded-lg border border-[var(--border)] bg-white" title="PDF preview" />
                )}
                {isTextLike && (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-2">
                    {textPreview ? <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[11px] text-[var(--text)]">{textPreview}</pre> : <p className="text-xs text-[var(--text-muted)]">{textPreviewError || 'Loading preview…'}</p>}
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
            <div className="relative mb-3">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input value={templateSearch} onChange={e => setTemplateSearch(e.target.value)} placeholder="Search templates…" className="input-field h-9 w-full pl-9 text-sm" />
              {templateSearch && <button onClick={() => setTemplateSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)]"><X size={13} /></button>}
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
                    <button onClick={() => handleApplyTemplate(t.id)} className="btn-primary text-xs gap-1 shrink-0 ml-3"><Plus size={12} />Apply</button>
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
                { title: 'Add Folder', content: (
                  <div className="flex gap-2">
                    <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="Folder name" className="input-field h-8 flex-1 text-xs" />
                    <button onClick={addFolder} className="btn-primary text-xs px-3">Add</button>
                  </div>
                ) },
                { title: 'Rename Folder', content: (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <select value={renameFrom} onChange={e => setRenameFrom(e.target.value)} className="input-field h-8 text-xs"><option value="">From…</option>{folderOptions.map(f => <option key={`rf-${f}`}>{f}</option>)}</select>
                      <input value={renameTo} onChange={e => setRenameTo(e.target.value)} placeholder="New name" className="input-field h-8 text-xs" />
                    </div>
                    <button onClick={renameFolder} className="btn-secondary mt-2 text-xs">Rename</button>
                  </>
                ) },
                { title: 'Move Items Between Folders', content: (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <select value={moveFrom} onChange={e => setMoveFrom(e.target.value)} className="input-field h-8 text-xs"><option value="">From…</option>{folderOptions.map(f => <option key={`mf-${f}`}>{f}</option>)}</select>
                      <select value={moveTo} onChange={e => setMoveTo(e.target.value)} className="input-field h-8 text-xs"><option value="">To…</option>{folderOptions.map(f => <option key={`mt-${f}`}>{f}</option>)}</select>
                    </div>
                    <button onClick={moveFolderItems} className="btn-secondary mt-2 text-xs">Move</button>
                  </>
                ) },
                { title: 'Delete Folder', content: (
                  <>
                    <div className="flex gap-2">
                      <select value={deleteFolderName} onChange={e => setDeleteFolderName(e.target.value)} className="input-field h-8 flex-1 text-xs"><option value="">Select folder…</option>{folderOptions.map(f => <option key={`df-${f}`}>{f}</option>)}</select>
                      <button onClick={deleteFolder} className="btn-danger text-xs px-3">Delete</button>
                    </div>
                    <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">Items will be moved to another available folder.</p>
                  </>
                ) },
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

/* ═══════════════════════════════════════════════════════════════════════════
   TEMPLATES  (no scraper ties — carried over as-is)
   ═══════════════════════════════════════════════════════════════════════════ */
function TemplatesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const emptyForm = () => ({ template_no: '', organization: '', template_name: '', description: '', notes: '' });
  const [form, setForm] = useState(emptyForm());
  const [confirmDel, setConfirmDel] = useState(null);
  const [newItem, setNewItem] = useState({ req_file_name: '', description: '', subfolder: 'Ready Docs' });

  const { data: templates, isLoading } = useQuery({ queryKey: ['templates'], queryFn: () => api.listTemplates() });
  const { data: items } = useQuery({ queryKey: ['template-items', expandedId], queryFn: () => api.listTemplateItems(expandedId), enabled: expandedId !== null });

  const createTemplate = useMutation({
    mutationFn: (d) => api.createTemplate({ template_no: d.template_no ? Number(d.template_no) : undefined, organization: d.organization, template_name: d.template_name, description: d.description || undefined, notes: d.notes || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); resetForm(); },
  });
  const updateTemplate = useMutation({
    mutationFn: ({ id, d }) => api.updateTemplate(id, { template_no: d.template_no ? Number(d.template_no) : undefined, organization: d.organization, template_name: d.template_name, description: d.description || undefined, notes: d.notes || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); resetForm(); },
  });
  const deleteTemplate = useMutation({
    mutationFn: (id) => api.deleteTemplate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); setConfirmDel(null); setExpandedId(null); },
  });
  const createItem = useMutation({
    mutationFn: () => api.createTemplateItem(expandedId, newItem),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['template-items', expandedId] }); setNewItem({ req_file_name: '', description: '', subfolder: 'Ready Docs' }); },
  });
  const deleteItem = useMutation({
    mutationFn: (itemId) => api.deleteTemplateItem(itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['template-items', expandedId] }),
  });

  const resetForm = () => { setForm(emptyForm()); setShowForm(false); setEditId(null); };
  const openEdit = (t) => {
    setForm({ template_no: String(t.template_no ?? ''), organization: t.organization, template_name: t.template_name, description: t.description || '', notes: t.notes || '' });
    setEditId(t.id); setShowForm(true);
  };
  const handleSubmit = () => {
    if (!form.template_name.trim() || !form.organization.trim()) return;
    if (editId !== null) updateTemplate.mutate({ id: editId, d: form });
    else createTemplate.mutate(form);
  };
  const uf = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const filtered = (templates || []).filter(t =>
    !search || t.template_name.toLowerCase().includes(search.toLowerCase()) || t.organization.toLowerCase().includes(search.toLowerCase()) || (t.description || '').toLowerCase().includes(search.toLowerCase())
  );
  const groupedByOrg = filtered.reduce((acc, t) => {
    const org = t.organization || 'Uncategorized';
    if (!acc[org]) acc[org] = [];
    acc[org].push(t);
    return acc;
  }, {});

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border)] bg-[var(--surface-0)] px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-[var(--text)]">Checklist Templates</h1>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">Manage document checklists for bid submissions</p>
          </div>
          <button onClick={() => { resetForm(); setShowForm(v => !v); }} className="btn-primary text-sm gap-1.5"><Plus size={14} /> New Template</button>
        </div>
        <div className="mt-3 relative max-w-sm">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search templates..." className="input-field h-9 w-full !pl-10 text-sm" />
        </div>
      </div>

      {showForm && (
        <div className="border-b border-[var(--border)] bg-[var(--surface-1)] px-6 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--text)]">{editId ? 'Edit Template' : 'New Template'}</h3>
            <button onClick={resetForm} className="text-[var(--text-muted)]"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">No.</label>
              <input value={form.template_no} onChange={e => uf('template_no', e.target.value)} placeholder="1" className="input-field h-9 w-full text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Organization *</label>
              <input value={form.organization} onChange={e => uf('organization', e.target.value)} placeholder="PWD Maharashtra" className="input-field h-9 w-full text-sm" />
            </div>
            <div className="lg:col-span-2">
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Template Name *</label>
              <input value={form.template_name} onChange={e => uf('template_name', e.target.value)} placeholder="Template name" className="input-field h-9 w-full text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Description</label>
              <input value={form.description} onChange={e => uf('description', e.target.value)} className="input-field h-9 w-full text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-muted)]">Notes</label>
              <input value={form.notes} onChange={e => uf('notes', e.target.value)} className="input-field h-9 w-full text-sm" />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={resetForm} className="btn-ghost text-sm">Cancel</button>
            <button onClick={handleSubmit} disabled={!form.template_name.trim() || !form.organization.trim()} className="btn-primary gap-1.5 text-sm">
              <Save size={14} />{editId ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {confirmDel !== null && (
        <div className="flex items-center justify-between border-b border-rose-500/30 bg-rose-500/10 px-6 py-3">
          <p className="text-sm text-rose-400">Delete this template and all its items?</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmDel(null)} className="btn-ghost text-xs">Cancel</button>
            <button onClick={() => deleteTemplate.mutate(confirmDel)} className="btn-danger gap-1 text-xs"><Trash2 size={12} />Delete</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner size={24} className="text-[var(--accent)]" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={FileText} title="No templates yet" description="Create checklist templates to standardize your bid preparation workflow"
            action={<button onClick={() => setShowForm(true)} className="btn-primary text-sm gap-1.5"><Plus size={14} /> New Template</button>} />
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedByOrg).map(([org, items_list]) => (
              <div key={org}>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">{org}</h3>
                <div className="space-y-2">
                  {items_list.map(t => (
                    <div key={t.id} className="card border border-[var(--border)] overflow-hidden">
                      <div className="flex cursor-pointer items-center gap-3 p-4 hover:bg-[var(--surface-1)]" onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}>
                        {expandedId === t.id ? <ChevronDown size={14} className="text-[var(--text-muted)] shrink-0" /> : <ChevronRight size={14} className="text-[var(--text-muted)] shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-[var(--text)]">{t.template_name}</p>
                            {t.template_no && <Badge variant="muted">#{t.template_no}</Badge>}
                          </div>
                          {t.description && <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{t.description}</p>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                          <button onClick={() => openEdit(t)} className="btn-ghost gap-1 text-xs"><Edit3 size={12} />Edit</button>
                          <button onClick={() => setConfirmDel(t.id)} className="btn-ghost gap-1 text-xs text-rose-400 hover:text-rose-300"><Trash2 size={12} />Delete</button>
                        </div>
                      </div>
                      {expandedId === t.id && (
                        <div className="border-t border-[var(--border)] bg-[var(--surface-1)] p-4">
                          <div className="mb-3 flex items-center gap-2">
                            <input value={newItem.req_file_name} onChange={e => setNewItem(v => ({ ...v, req_file_name: e.target.value }))} placeholder="Document name" className="input-field h-8 flex-1 text-xs" />
                            <input value={newItem.description} onChange={e => setNewItem(v => ({ ...v, description: e.target.value }))} placeholder="Description" className="input-field h-8 flex-1 text-xs" />
                            <input value={newItem.subfolder} onChange={e => setNewItem(v => ({ ...v, subfolder: e.target.value }))} placeholder="Folder" className="input-field h-8 w-32 text-xs" />
                            <button disabled={!newItem.req_file_name.trim() || createItem.isPending} onClick={() => createItem.mutate()} className="btn-primary gap-1 text-xs shrink-0"><Plus size={12} />Add</button>
                          </div>
                          <TemplateItemsList templateId={t.id} onDelete={(itemId) => deleteItem.mutate(itemId)} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateItemsList({ templateId, onDelete }) {
  const { data: items, isLoading } = useQuery({ queryKey: ['template-items', templateId], queryFn: () => api.listTemplateItems(templateId) });
  if (isLoading) return <div className="flex justify-center py-4"><Spinner size={16} className="text-[var(--accent)]" /></div>;
  if (!items?.length) return <p className="text-xs text-[var(--text-muted)]">No items. Add the first document above.</p>;
  return (
    <table className="data-table">
      <thead><tr><th className="w-10">#</th><th>Document Name</th><th>Description</th><th className="w-32">Folder</th><th className="w-16 text-center">Del</th></tr></thead>
      <tbody>
        {items.map((item, i) => (
          <tr key={item.id}>
            <td className="text-[var(--text-muted)]">{i + 1}</td>
            <td className="text-sm">{item.req_file_name || '-'}</td>
            <td className="text-xs">{item.description || '-'}</td>
            <td className="text-xs">{item.subfolder || 'Ready Docs'}</td>
            <td className="text-center"><button onClick={() => onDelete(item.id)} className="text-rose-400 hover:text-rose-300"><Trash2 size={13} /></button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   FILES  (renamed from "Server Control" — a plain file browser over the
   shared project storage)
   — dropped: "Delete files older than N days" bulk-maintenance action. That
     is an operator/server-hygiene tool, not something a client user should
     be able to trigger. Browsing + single-folder delete is kept.
   ═══════════════════════════════════════════════════════════════════════════ */
const STORAGE_COLUMNS = [
  { key: 'name', label: 'Name', width: 360 },
  { key: 'type', label: 'Type', width: 130 },
  { key: 'size', label: 'Size', width: 140 },
  { key: 'modified', label: 'Modified', width: 220 },
];

function formatBytes(bytes) {
  const b = Number(bytes || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function FilesPage() {
  const qc = useQueryClient();
  const {
    serverStorageTable,
    setServerStorageHiddenColumns,
    setServerStorageColumnOrder,
    setServerStorageColumnWidth,
  } = useAppStore();

  const [relPath, setRelPath] = useState('');
  const [selectedRelPath, setSelectedRelPath] = useState('');
  const [showColsMenu, setShowColsMenu] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['client-files', relPath],
    queryFn: () => api.listServerStorage(relPath),
  });

  const selectedItem = useMemo(() => {
    const items = data?.items || [];
    return items.find((x) => x.rel_path === selectedRelPath) || null;
  }, [data?.items, selectedRelPath]);

  const storageColOrder = useMemo(
    () => (serverStorageTable.columnOrder?.length ? serverStorageTable.columnOrder : STORAGE_COLUMNS.map((c) => c.key)),
    [serverStorageTable.columnOrder]
  );
  const storageHidden = useMemo(() => new Set(serverStorageTable.hiddenColumns || []), [serverStorageTable.hiddenColumns]);
  const orderedStorageCols = useMemo(() => {
    const byKey = new Map(STORAGE_COLUMNS.map((c) => [c.key, c]));
    return storageColOrder.map((k) => byKey.get(k)).filter(Boolean);
  }, [storageColOrder]);
  const visibleStorageCols = orderedStorageCols.filter((c) => c.fixed || !storageHidden.has(c.key));
  const getStorageColWidth = (c) => {
    const v = serverStorageTable.columnWidths?.[c.key];
    return Number.isFinite(v) && v > 0 ? v : c.width;
  };
  const toggleStorageCol = (key) => {
    const next = new Set(storageHidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setServerStorageHiddenColumns(Array.from(next));
  };
  const moveStorageCol = (from, to) => {
    if (from === to) return;
    const next = [...storageColOrder];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setServerStorageColumnOrder(next);
  };
  const startStorageColResize = (col, startX) => {
    const startW = getStorageColWidth(col);
    const onMove = (evt) => {
      const next = Math.max(90, startW + (evt.clientX - startX));
      setServerStorageColumnWidth(col.key, next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const deleteFolder = useMutation({
    mutationFn: (path) => api.deleteServerFolder(path),
    onSuccess: () => {
      setSelectedRelPath('');
      qc.invalidateQueries({ queryKey: ['client-files', relPath] });
    },
  });

  const goParent = () => {
    const parent = data?.parent_rel_path || '';
    setRelPath(parent);
    setSelectedRelPath('');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border)] bg-[var(--surface-0)] px-6 py-4">
        <h1 className="text-lg font-bold text-[var(--text)]">Files</h1>
        <p className="mt-0.5 text-sm text-[var(--text-muted)]">Browse project storage</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={goParent} className="btn-ghost gap-1 text-xs" disabled={!data?.parent_rel_path}>
            <ArrowUp size={12} />
            Parent
          </button>
          <button onClick={() => qc.invalidateQueries({ queryKey: ['client-files', relPath] })} className="btn-ghost gap-1 text-xs">
            <RefreshCw size={12} className={cn(isFetching && 'animate-spin')} />
            Refresh
          </button>
          <button onClick={() => selectedItem?.is_dir && deleteFolder.mutate(selectedItem.rel_path)} className="btn-danger gap-1 text-xs" disabled={!selectedItem?.is_dir || deleteFolder.isPending}>
            <Trash2 size={12} />
            Delete Folder
          </button>
          <div className="relative ml-2">
            <button onClick={() => setShowColsMenu((v) => !v)} className="btn-ghost gap-1 text-xs">
              <Columns3 size={12} />
              Columns
            </button>
            {showColsMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowColsMenu(false)} />
                <div className="card absolute right-0 top-8 z-50 max-h-72 w-60 overflow-auto border border-[var(--border)] p-2 shadow-xl">
                  <p className="mb-1 border-b border-[var(--border)] px-2 pb-1 text-xs text-[var(--text-muted)]">Drag to reorder, toggle columns</p>
                  {orderedStorageCols.map((c, i) => (
                    <div key={c.key} draggable onDragStart={() => setDragIdx(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => {
                      if (dragIdx !== null) {
                        const fromKey = orderedStorageCols[dragIdx]?.key;
                        const toKey = orderedStorageCols[i]?.key;
                        if (fromKey && toKey) {
                          const fi = storageColOrder.indexOf(fromKey);
                          const ti = storageColOrder.indexOf(toKey);
                          if (fi >= 0 && ti >= 0) moveStorageCol(fi, ti);
                        }
                      }
                      setDragIdx(null);
                    }} className={cn('flex cursor-grab items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-[var(--surface-1)]', dragIdx === i && 'opacity-50')}>
                      <span className="select-none cursor-grab text-[var(--text-muted)]">::</span>
                      <input type="checkbox" checked={!storageHidden.has(c.key)} onChange={() => toggleStorageCol(c.key)} className="accent-[var(--accent)]" />
                      <span className="flex-1">{c.label}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="mt-2 text-xs text-[var(--text-muted)]">
          Root: <span className="font-mono">{data?.root_folder || '-'}</span>
          <br />
          Current: <span className="font-mono">{data?.current_rel_path || '/'}</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner size={24} className="text-[var(--accent)]" /></div>
        ) : (
          <>
            {!data?.items || data.items.length === 0 ? (
              <EmptyState icon={Server} title="No items" description="This folder is empty" />
            ) : (
              <table className="data-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <thead>
                  <tr>
                    {visibleStorageCols.map((c) => (
                      <th key={c.key} style={{ width: getStorageColWidth(c) }} className="relative">
                        <div className="flex items-center">{c.label}</div>
                        <div className="absolute right-0 top-0 h-full w-2 cursor-col-resize" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startStorageColResize(c, e.clientX); }} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.rel_path || item.name} onClick={() => setSelectedRelPath(item.rel_path)} onDoubleClick={() => {
                      if (item.is_dir) {
                        setRelPath(item.rel_path);
                        setSelectedRelPath('');
                      }
                    }} className={cn('cursor-pointer', selectedRelPath === item.rel_path && 'row-selected')}>
                      {visibleStorageCols.map((c) => {
                        if (c.key === 'name') return <td key={c.key} className="text-sm"><span className="inline-flex items-center gap-2">{item.is_dir ? <Folder size={14} /> : <FolderOpen size={14} />}{item.name}</span></td>;
                        if (c.key === 'type') return <td key={c.key} className="text-xs">{item.is_dir ? 'Folder' : 'File'}</td>;
                        if (c.key === 'size') return <td key={c.key} className="text-xs">{item.is_dir ? '-' : formatBytes(item.size_bytes)}</td>;
                        if (c.key === 'modified') return <td key={c.key} className="text-xs">{new Date(item.modified_at).toLocaleString()}</td>;
                        return <td key={c.key} className="text-xs" />;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SETTINGS  (client-relevant only)
   — dropped: CAPTCHA AI provider config, Backend/Cloud Run connection
     config (mode / URL / API & admin keys), and Update Manifest URL — all
     operator-only concerns. Kept & expanded: appearance/theming, workspace
     behavior, projects entry mode, the "show tender info" toggle, directory
     paths, server connection/sync, and local data & cache controls.

   Two separate stores of settings live on this page:
     1. Server-relevant `form` fields (unchanged plumbing) — saved via
        api.updateSettings() and shown under Workspace / Directories / Connection.
     2. Local-only `prefs` (accent, density, UI scale, startup page) — saved to
        localStorage via useClientPrefs(), applied instantly, never sent to
        the backend. See DEFAULT_CLIENT_PREFS above.
   ═══════════════════════════════════════════════════════════════════════════ */
const SETTINGS_TABS = [
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'workspace', label: 'Workspace', icon: LayoutGrid },
  { key: 'directories', label: 'Directories', icon: FolderOpen },
  { key: 'connection', label: 'Connection & Sync', icon: Server },
  { key: 'data', label: 'Data & Cache', icon: RotateCcw },
];

function SettingsPage() {
  const { theme, toggleTheme } = useAppStore();
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: () => api.health(), retry: false });

  const [form, setForm] = useState({
    parent_dir: '',
    project_details_show_tender_info: 'true',
    server_url: api.defaultServerUrl,
  });
  const [saved, setSaved] = useState(false);
  const [pathStatus, setPathStatus] = useState('');
  const [showChangePw, setShowChangePw] = useState(false);
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [pwStatus, setPwStatus] = useState('');
  const desktop = window.bidmanagerDesktop;

  const deriveParent = (s) => {
    if (s.parent_dir) return String(s.parent_dir);
    const proj = String(s.projects_dir || '');
    const marker = `${proj.includes('\\') ? '\\' : '/'}My_Tender_Projects`;
    if (proj.endsWith(marker)) return proj.slice(0, -marker.length);
    const db = String(s.db_file || '');
    const idx = Math.max(db.lastIndexOf('\\'), db.lastIndexOf('/'));
    return idx > 0 ? db.slice(0, idx) : '';
  };

  useEffect(() => {
    if (!settings) return;
    setForm((f) => ({
      ...f,
      parent_dir: deriveParent(settings) || f.parent_dir,
      project_details_show_tender_info: settings.project_details_show_tender_info || f.project_details_show_tender_info,
      server_url: settings.server_url || api.defaultServerUrl,
    }));
  }, [settings]);

  const saveMut = useMutation({
    mutationFn: async (patch) => { await api.updateSettings(patch); return api.ensureParentFolders(patch.parent_dir); },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      window.dispatchEvent(new Event('bm-settings-updated'));
      setPathStatus(result?.ok === false ? `Saved settings, but could not create folders: ${result.message}` : 'Saved.');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (error) => setPathStatus(`Save failed: ${error instanceof Error ? error.message : String(error)}`),
  });
  const handleSave = () => saveMut.mutate(form);
  const uf = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const folderPath = (name) => form.parent_dir ? `${form.parent_dir}${form.parent_dir.endsWith('\\') || form.parent_dir.endsWith('/') ? '' : '\\'}${name}` : '-';

  const connectionMut = useMutation({
    mutationFn: () => api.testConnection(form),
    onSuccess: (result) => setPathStatus(`Connected successfully. Server version: ${result.version || 'unknown'}. Read-only access confirmed.`),
    onError: (error) => setPathStatus(`Connection failed: ${error instanceof Error ? error.message : String(error)}`),
  });
  const syncMut = useMutation({
    mutationFn: () => api.syncFromServer(form),
    onSuccess: (result) => {
      qc.invalidateQueries();
      window.dispatchEvent(new Event('bm-settings-updated'));
      setPathStatus(`Imported ${result.tenders} tenders from ${result.websites} server sources. Local changes remain on this device.`);
    },
    onError: (error) => setPathStatus(`Sync failed: ${error instanceof Error ? error.message : String(error)}`),
  });
  const signOutMut = useMutation({
    mutationFn: () => api.signOut(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); qc.clear(); },
  });
  const changePasswordMut = useMutation({
    mutationFn: () => api.changePassword(pwForm),
    onSuccess: () => {
      setPwStatus('Password changed.');
      setPwForm({ current_password: '', new_password: '', confirm_password: '' });
      setTimeout(() => { setShowChangePw(false); setPwStatus(''); }, 1500);
    },
    onError: (err) => setPwStatus(err instanceof Error ? err.message : String(err)),
  });
  const submitChangePassword = () => {
    if (pwForm.new_password.length < 8) { setPwStatus('New password must be at least 8 characters.'); return; }
    if (pwForm.new_password !== pwForm.confirm_password) { setPwStatus('New passwords do not match.'); return; }
    changePasswordMut.mutate();
  };

  const browseForPath = async (key, label) => {
    try {
      if (!desktop?.pickPath) { setPathStatus('Browse is available in the desktop app.'); return; }
      const result = await desktop.pickPath({ file: false, title: `Select ${label}` });
      if (result?.ok && result.path) uf(key, result.path);
      else if (result && !result.canceled && result.message) setPathStatus(`Browse failed: ${result.message}`);
    } catch (e) {
      setPathStatus(`Browse failed: ${e?.message || String(e)}`);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-0)]">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-[var(--text)]">Settings</h1>
          <div>
            {health ? <Badge variant="success"><Wifi size={10} />Connected v{health.version}</Badge> : <Badge variant="danger"><WifiOff size={10} />Offline</Badge>}
          </div>
        </div>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size={24} className="text-[var(--accent)]" /></div>
      ) : (
        <div className="p-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            <div className="space-y-6 xl:col-span-7">
              <div className="card p-5 space-y-4">
                <h3 className="text-sm font-semibold text-[var(--text)]">Appearance</h3>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[var(--text)]">Theme</p>
                    <p className="text-xs text-[var(--text-muted)]">Light / Dark mode</p>
                  </div>
                  <button onClick={toggleTheme} className="btn-secondary text-sm gap-2">
                    {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                    {theme === 'dark' ? 'Light' : 'Dark'}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[var(--text)]">Show Tender Info panel</p>
                    <p className="text-xs text-[var(--text-muted)]">In project details view</p>
                  </div>
                  <input type="checkbox" checked={form.project_details_show_tender_info === 'true'} onChange={(e) => uf('project_details_show_tender_info', e.target.checked ? 'true' : 'false')} className="accent-[var(--accent)] w-5 h-5" />
                </div>
                <p className="flex items-start gap-2 text-[11px] text-[var(--text-muted)]">
                  <Info size={12} className="mt-0.5 shrink-0" />
                  The New/Edit Project form's Inline vs Popup mode moved to the Projects page toolbar.
                </p>
              </div>

              <div className="card p-5 space-y-4">
                <h3 className="text-sm font-semibold text-[var(--text)]">Directory Paths</h3>
                <p className="text-xs text-[var(--text-muted)]">Choose one parent folder — the four folders below are created automatically under it when you save.</p>
                <div>
                  <label className="text-xs text-[var(--text-muted)] mb-1 block">Parent Folder</label>
                  <div className="flex gap-2">
                    <input value={form.parent_dir} onChange={(e) => uf('parent_dir', e.target.value)} className="input-field h-9 text-sm flex-1" placeholder="Path to parent folder" />
                    <button onClick={() => browseForPath('parent_dir', 'Parent Folder')} className="btn-secondary text-xs px-3 gap-1 shrink-0"><FolderOpen size={13} />Browse</button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2 text-xs text-[var(--text-muted)]">
                  <div>Tender Downloads: <span className="text-[var(--text)]">{folderPath('Tender_Downloads')}</span></div>
                  <div>Projects: <span className="text-[var(--text)]">{folderPath('My_Tender_Projects')}</span></div>
                  <div>Archived: <span className="text-[var(--text)]">{folderPath('Archived Projects')}</span></div>
                  <div>Templates: <span className="text-[var(--text)]">{folderPath('Checklist_Templates')}</span></div>
                </div>
              </div>
            </div>

            <div className="space-y-6 xl:col-span-5">
              <div className="card p-5 space-y-4">
                <h3 className="text-sm font-semibold text-[var(--text)]">Account</h3>
                {settings?.auth_token ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm text-[var(--text)]">{settings.display_name || settings.user_email}</p>
                        <p className="text-[11px] text-[var(--text-muted)]">{settings.user_email}</p>
                      </div>
                      <button onClick={() => signOutMut.mutate()} disabled={signOutMut.isPending} className="btn-secondary text-xs gap-1.5">
                        {signOutMut.isPending ? <Spinner size={13} /> : <LogOut size={13} />}Sign Out
                      </button>
                    </div>
                    <div className="border-t border-[var(--border)] pt-3">
                      <button onClick={() => { setShowChangePw((v) => !v); setPwStatus(''); }} className="btn-ghost text-xs gap-1.5">
                        <KeyRound size={13} />{showChangePw ? 'Cancel' : 'Change Password'}
                      </button>
                      {showChangePw && (
                        <div className="mt-3 space-y-2">
                          <input type="password" value={pwForm.current_password} onChange={(e) => setPwForm((f) => ({ ...f, current_password: e.target.value }))} placeholder="Current password" className="input-field h-9 w-full text-sm" autoComplete="current-password" />
                          <input type="password" value={pwForm.new_password} onChange={(e) => setPwForm((f) => ({ ...f, new_password: e.target.value }))} placeholder="New password (min 8 characters)" className="input-field h-9 w-full text-sm" autoComplete="new-password" />
                          <input type="password" value={pwForm.confirm_password} onChange={(e) => setPwForm((f) => ({ ...f, confirm_password: e.target.value }))} placeholder="Confirm new password" className="input-field h-9 w-full text-sm" autoComplete="new-password" />
                          {pwStatus && <p className="text-xs text-rose-400">{pwStatus}</p>}
                          <button
                            onClick={submitChangePassword}
                            disabled={changePasswordMut.isPending || !pwForm.current_password || !pwForm.new_password || !pwForm.confirm_password}
                            className="btn-primary text-xs gap-1.5"
                          >
                            {changePasswordMut.isPending ? <Spinner size={13} /> : <KeyRound size={13} />}Update Password
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                ) : <p className="text-xs text-[var(--text-muted)]">Not signed in.</p>}
              </div>

              <div className="card p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text)]">Server & Sync</h3>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">The production URL is prefilled and remains editable. Only authenticated /client/* routes are used.</p>
                </div>
                <div>
                  <label className="text-xs text-[var(--text-muted)] mb-1 block">Backend URL</label>
                  <input
                    value={form.server_url}
                    onChange={(event) => uf('server_url', event.target.value)}
                    className="input-field h-9 w-full font-mono text-xs"
                    placeholder={api.defaultServerUrl}
                    spellCheck={false}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => connectionMut.mutate()} disabled={connectionMut.isPending || !settings?.auth_token} className="btn-secondary text-xs gap-1.5">
                    {connectionMut.isPending ? <Spinner size={13} /> : <Wifi size={13} />}Test Connection
                  </button>
                  <button onClick={() => syncMut.mutate()} disabled={syncMut.isPending || !settings?.auth_token} className="btn-primary text-xs gap-1.5">
                    {syncMut.isPending ? <Spinner size={13} /> : <RefreshCw size={13} />}Sync Tenders
                  </button>
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">Sync reads paginated tender data from Postgres through the backend and updates the offline cache. Projects, bookmarks, templates, settings, and local files are never uploaded.</p>
                {settings?.last_sync_at && <p className="text-[11px] text-[var(--text-muted)]">Last sync: {new Date(settings.last_sync_at).toLocaleString()}</p>}
                {pathStatus && <p className="text-xs text-rose-400">{pathStatus}</p>}
              </div>

              <div className="flex items-center gap-3 pb-6 xl:pb-0">
                <button onClick={handleSave} disabled={saveMut.isPending} className="btn-primary text-sm gap-1.5">
                  {saveMut.isPending ? <Spinner size={14} /> : saved ? <CheckCircle2 size={14} /> : <Save size={14} />}{saved ? 'Saved!' : 'Save Settings'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════════
   SIGN IN  — gates the whole app behind a per-user account (client_users on
   the server). Register/login both return a personal session token stored as
   settings.auth_token; api.js sends it as x-client-key on every /client/*
   call. See Server UI/server/client_api.py's /client/auth/* routes.
   ═══════════════════════════════════════════════════════════════════════════ */
function SignInScreen() {
  const qc = useQueryClient();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({ email: '', password: '', display_name: '' });
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const uf = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submitMut = useMutation({
    mutationFn: () => api.signIn(form, mode, remember),
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!form.email.trim() || !form.password.trim()) { setError('Enter your email and password.'); return; }
    submitMut.mutate();
  };

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--bg)] text-[var(--text)]">
      <form onSubmit={handleSubmit} className="card w-full max-w-sm space-y-4 p-6">
        <div className="text-center">
          <p className="text-sm font-bold tracking-tight text-[var(--accent)]">BID MANAGER</p>
          <h1 className="mt-1 text-lg font-semibold text-[var(--text)]">{mode === 'register' ? 'Create an account' : 'Sign in'}</h1>
        </div>

        {mode === 'register' && (
          <div>
            <label className="mb-1 block text-xs text-[var(--text-muted)]">Name</label>
            <input value={form.display_name} onChange={(e) => uf('display_name', e.target.value)} className="input-field h-9 w-full text-sm" placeholder="Your name" />
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs text-[var(--text-muted)]">Email</label>
          <input type="email" value={form.email} onChange={(e) => uf('email', e.target.value)} className="input-field h-9 w-full text-sm" placeholder="you@example.com" autoComplete="email" required />
        </div>
        <div>
          <label className="mb-1 block text-xs text-[var(--text-muted)]">Password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'} value={form.password} onChange={(e) => uf('password', e.target.value)}
              className="input-field h-9 w-full pr-9 text-sm" placeholder={mode === 'register' ? 'At least 8 characters' : 'Password'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required
            />
            <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)]">
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-[var(--accent)]" />
          Remember me on this device
        </label>

        {error && <p className="text-xs text-rose-400">{error}</p>}

        <button type="submit" disabled={submitMut.isPending} className="btn-primary flex w-full items-center justify-center gap-2 text-sm">
          {submitMut.isPending ? <Spinner size={14} /> : mode === 'register' ? <UserPlus size={14} /> : <LogIn size={14} />}
          {mode === 'register' ? 'Create account' : 'Sign in'}
        </button>

        <p className="text-center text-xs text-[var(--text-muted)]">
          {mode === 'register' ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button type="button" onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); }} className="text-[var(--accent)] hover:underline">
            {mode === 'register' ? 'Sign in' : 'Create one'}
          </button>
        </p>
      </form>
    </div>
  );
}

function formatAgo(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then)) return null;
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'just now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   APP SHELL
   — dropped: the background "auto-archive" polling loop that used to call
     api.listWebsites / api.checkArchivedTenderStatus / api.archiveCompletedTenders
     on a timer. That whole cycle was the scraper re-checking source portals
     for completed tenders — an operator-only background job.
   ═══════════════════════════════════════════════════════════════════════════ */
export default function App() {
  const qc = useQueryClient();
  const { theme, toggleTheme, sidebarCollapsed, toggleSidebar, notifications } = useAppStore();
  const { data: authSettings, isLoading: authLoading } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const { data: connected } = useQuery({
    queryKey: ['client-health', authSettings?.server_url, Boolean(authSettings?.auth_token)],
    queryFn: () => api.health(),
    enabled: Boolean(authSettings?.auth_token),
    retry: false,
  });
  const [page, setPage] = useState(() => {
    const allowed = ['dashboard', 'tenders', 'organizations', 'bookmarks', 'projects', 'templates', 'archived_projects', 'files', 'settings'];
    const startupPage = readClientPrefs().startupPage;
    if (startupPage && startupPage !== 'resume' && allowed.includes(startupPage)) return startupPage;
    const saved = localStorage.getItem('bm-client-last-page');
    return allowed.includes(saved) ? saved : 'dashboard';
  });
  const [showNotifications, setShowNotifications] = useState(false);
  const [workspaceProjectId, setWorkspaceProjectId] = useState(() => {
    const value = Number(new URLSearchParams(window.location.search).get('projectId'));
    return Number.isFinite(value) && value > 0 ? value : null;
  });
  const [workspaceTimeRemaining, setWorkspaceTimeRemaining] = useState('');

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => { localStorage.setItem('bm-client-last-page', page); }, [page]);

  useEffect(() => {
    document.body.classList.toggle('dark', theme === 'dark');
    document.body.classList.toggle('light', theme === 'light');
  }, [theme]);

  useEffect(() => {
    const onTime = (evt) => setWorkspaceTimeRemaining(String(evt.detail?.label || ''));
    window.addEventListener('bm-workspace-time-remaining', onTime);
    return () => window.removeEventListener('bm-workspace-time-remaining', onTime);
  }, []);

  // Keeps the offline cache current without relying on the user remembering
  // to press "Sync Tenders" in Settings — same pull-only sync, just scheduled.
  useEffect(() => {
    if (!authSettings?.auth_token) return undefined;
    const run = () => { api.syncFromServer().then(() => qc.invalidateQueries()).catch(() => {}); };
    const timer = setInterval(run, 15 * 60 * 1000);
    return () => clearInterval(timer);
  }, [authSettings?.auth_token, qc]);

  // A "Requested…" pill (TendersPage) is backed by a placeholder row in the
  // local `documents` store with the job id attached, but the setTimeout
  // polling chain in api.pollTenderDownloadJob only lives as long as the app
  // stays open — reattach it here so a still-pending request resumes polling
  // after a reload/restart instead of getting stuck "Requested…" forever.
  useEffect(() => {
    if (!authSettings?.auth_token) return;
    api.resumePendingDownloadJobs().catch(() => {});
  }, [authSettings?.auth_token]);

  if (!authLoading && !authSettings?.auth_token) return <SignInScreen />;

  // Clears the "came from Organizations" flag, then navigates — used by
  // every navigation path except openOrgTenders itself, so a stale "Back to
  // Organizations" button can't linger once the user has gone somewhere else.
  const navigate = (target) => {
    try { sessionStorage.removeItem(TENDERS_CAME_FROM_ORG_KEY); } catch { /* ignore storage failures */ }
    setPage(target);
  };

  // Websites are now a mandatory single-select filter (no "All" option), so
  // an org's own website must be preset explicitly — otherwise a different
  // website left selected in Tenders could hide this org's tenders entirely.
  const openOrgTenders = (orgName, websiteName) => {
    try {
      localStorage.setItem(TENDERS_FILTER_STATE_KEY, JSON.stringify({ org: orgName, location: '', category: '', website: websiteName || '' }));
      sessionStorage.setItem(TENDERS_FORCE_TAB_KEY, 'active');
      sessionStorage.setItem(TENDERS_CAME_FROM_ORG_KEY, '1');
    } catch { /* ignore storage failures */ }
    setPage('tenders');
  };

  const openWebsiteOrganizations = (websiteName) => {
    try { sessionStorage.setItem(ORGANIZATIONS_FORCE_WEBSITE_KEY, websiteName || ''); } catch { /* ignore storage failures */ }
    navigate('organizations');
  };

  // Dashboard stat cards navigate to a pre-filtered view — same cross-page
  // mechanism as openOrgTenders, minus the org filter. Deliberately leaves
  // `website` untouched (read-modify-write) since it's now a mandatory
  // single-select and shouldn't get silently reset by an unrelated card.
  const goToDashboardTarget = (target) => {
    if (target === 'tenders-active' || target === 'tenders-archived' || target === 'tenders-closing-7d') {
      try {
        const current = loadTenderFilterState();
        localStorage.setItem(TENDERS_FILTER_STATE_KEY, JSON.stringify({ ...current, org: '', location: '', category: '' }));
        sessionStorage.setItem(TENDERS_FORCE_TAB_KEY, target === 'tenders-archived' ? 'archived' : 'active');
        if (target === 'tenders-closing-7d') sessionStorage.setItem(TENDERS_FORCE_CLOSING_KEY, '1');
      } catch { /* ignore storage failures */ }
      navigate('tenders');
    } else if (target) {
      navigate(target);
    }
  };

  const pages = {
    dashboard: <DashboardPage onNavigate={goToDashboardTarget} onOpenProjectWorkspace={(projectId) => setWorkspaceProjectId(projectId)} onOpenWebsiteOrganizations={openWebsiteOrganizations} />,
    tenders: <TendersPage onBackToOrganizations={() => navigate('organizations')} />,
    organizations: <OrganizationsPage onOpenOrgTenders={openOrgTenders} />,
    bookmarks: <BookmarksPage />,
    projects: <ProjectsPage key="projects-active" onOpenProjectWorkspace={(projectId) => setWorkspaceProjectId(projectId)} />,
    archived_projects: <ProjectsPage key="projects-archived" archived onOpenProjectWorkspace={(projectId) => setWorkspaceProjectId(projectId)} />,
    templates: <TemplatesPage />,
    files: <FilesPage />,
    settings: <SettingsPage />,
  };

  return (
    <div className="h-screen flex flex-col bg-[var(--bg)] text-[var(--text)]">
      <header className="h-11 flex items-center px-4 border-b border-[var(--border)] bg-[var(--surface-0)] shrink-0 relative z-30">
        <span className="text-xs text-[var(--text-muted)] font-medium">Tender & Bid Manager</span>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          {connected ? (
            <span title="Connected to the server">
              <Badge variant="success"><Wifi size={10} />{formatAgo(authSettings?.last_sync_at) ? `Synced ${formatAgo(authSettings.last_sync_at)}` : null}</Badge>
            </span>
          ) : (
            <span title="Not connected — check Settings › Connection & Sync"><Badge variant="danger"><WifiOff size={10} />Offline</Badge></span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowNotifications(!showNotifications)} className="relative p-1.5 rounded-md hover:bg-[var(--surface-1)] text-[var(--text-muted)]">
            <Bell size={16} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-[var(--danger)] text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">{unreadCount}</span>
            )}
          </button>
          <button onClick={toggleTheme} className="p-1.5 rounded-md hover:bg-[var(--surface-1)] text-[var(--text-muted)]">
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
        <NotificationPanel open={showNotifications} onClose={() => setShowNotifications(false)} />
      </header>

      <div className="flex flex-1 overflow-hidden">
        <Sidebar active={page} onNavigate={navigate} collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
        <main className="flex-1 overflow-hidden bg-[var(--bg)]">
          <RenderErrorBoundary>{pages[page]}</RenderErrorBoundary>
        </main>
      </div>

      {workspaceProjectId && (
        <>
          <div className="fixed inset-0 z-40 bg-black/35" onClick={() => setWorkspaceProjectId(null)} />
          <aside className="fixed inset-y-0 right-0 z-50 w-[86vw] max-w-[1500px] border-l border-[var(--border)] bg-[var(--bg)] shadow-2xl">
            <div className="flex h-11 items-center justify-between border-b border-[var(--border)] bg-[var(--surface-0)] px-3">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-[var(--text)]">Project Workspace</h3>
                {workspaceTimeRemaining && <span className="text-xs text-[var(--text-muted)]">{workspaceTimeRemaining}</span>}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => window.dispatchEvent(new CustomEvent('bm-workspace-edit-toggle'))} className="btn-ghost gap-1 text-xs"><Edit3 size={12} />Edit Info</button>
                <button onClick={() => window.dispatchEvent(new CustomEvent('bm-workspace-save'))} className="btn-primary gap-1 text-xs"><Save size={12} />Save</button>
                <button onClick={() => window.dispatchEvent(new CustomEvent('bm-workspace-open-folder'))} className="btn-ghost gap-1 text-xs"><FolderOpen size={12} />Open Folder</button>
                <button onClick={() => setWorkspaceProjectId(null)} className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-1)] hover:text-[var(--text)]"><X size={16} /></button>
              </div>
            </div>
            <div className="h-[calc(100%-44px)]">
              <ProjectWorkspacePage projectId={workspaceProjectId} embedded />
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
