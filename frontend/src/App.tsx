import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard, Globe, FolderOpen, FileText, Server, Settings,
  Bell, Sun, Moon, PanelLeftClose, PanelLeft, X, AlertTriangle,
  Zap, Activity, Calendar, Edit3, Save,
} from 'lucide-react';
import { useAppStore, type Notification } from './lib/store';
import { cn } from './lib/utils';
import { NotificationIcon } from './components/ui/shared';
import { api } from './lib/api';

import DashboardPage from './pages/DashboardPage';
import TendersPage from './pages/TendersPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectWorkspacePage from './pages/ProjectWorkspacePage';
import TemplatesPage from './pages/TemplatesPage';
import SettingsPage from './pages/SettingsPage';
import ServerPage from './pages/ServerPage';

type Page = 'dashboard' | 'tenders' | 'projects' | 'templates' | 'archived_projects' | 'server' | 'settings';

class RenderErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown error');
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown) {
    // Keep a breadcrumb in console for quick diagnosis in Electron devtools.
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
              <button className="btn-primary text-xs" onClick={() => window.location.reload()}>
                Reload App
              </button>
              <button className="btn-ghost text-xs" onClick={() => this.setState({ hasError: false, message: '' })}>
                Try Continue
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Sidebar ────────────────────────────────────────────────────────────────

function Sidebar({
  active, onNavigate, collapsed, onToggle,
}: {
  active: Page;
  onNavigate: (p: Page) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const mainItems: { key: Page; label: string; icon: typeof LayoutDashboard }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'tenders', label: 'Online Tenders', icon: Globe },
    { key: 'projects', label: 'Projects', icon: FolderOpen },
    { key: 'templates', label: 'Templates', icon: FileText },
  ];
  const bottomItems: { key: Page; label: string; icon: typeof Server }[] = [
    { key: 'archived_projects', label: 'Archived Projects', icon: FolderOpen },
    { key: 'server', label: 'Server Control', icon: Server },
    { key: 'settings', label: 'Settings', icon: Settings },
  ];

  const NavButton = ({ item }: { item: { key: Page; label: string; icon: any } }) => (
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
          <span className="text-sm font-bold tracking-tight text-[var(--accent)] truncate">
            BID MANAGER
          </span>
        )}
        <button
          onClick={onToggle}
          className={cn('p-1 rounded hover:bg-[var(--surface-1)] text-[var(--text-muted)]', collapsed && 'mx-auto')}
        >
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

// ── Notification Panel ─────────────────────────────────────────────────────

function NotificationPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { notifications, markRead, markAllRead } = useAppStore();

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-10 right-2 w-80 z-50 card shadow-xl border border-[var(--border)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <span className="text-sm font-semibold text-[var(--text)]">Notifications</span>
          <div className="flex items-center gap-2">
            <button onClick={markAllRead} className="text-xs text-[var(--accent)] hover:underline">
              Mark all read
            </button>
            <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)]">
              <X size={14} />
            </button>
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

// ── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const { theme, toggleTheme, sidebarCollapsed, toggleSidebar, notifications } = useAppStore();
  const [page, setPage] = useState<Page>(() => {
    const saved = localStorage.getItem('bm-last-page');
    const allowed: Page[] = ['dashboard', 'tenders', 'projects', 'templates', 'archived_projects', 'server', 'settings'];
    return allowed.includes(saved as Page) ? (saved as Page) : 'dashboard';
  });
  const [showNotifications, setShowNotifications] = useState(false);
  const [workspaceProjectId, setWorkspaceProjectId] = useState<number | null>(null);
  const [workspaceTimeRemaining, setWorkspaceTimeRemaining] = useState('');
  const [archiveSettingsRevision, setArchiveSettingsRevision] = useState(0);
  const projectWindowId = (() => {
    const raw = new URLSearchParams(window.location.search).get('projectId');
    const n = Number(raw || '');
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const unreadCount = notifications.filter(n => !n.read).length;

  // Apply theme class to body
  useEffect(() => {
    document.body.className = theme;
  }, [theme]);
  useEffect(() => {
    void api.initRouteSet();
  }, []);
  useEffect(() => {
    localStorage.setItem('bm-last-page', page);
  }, [page]);
  useEffect(() => {
    const onSettingsUpdated = () => setArchiveSettingsRevision((revision) => revision + 1);
    window.addEventListener('bm-settings-updated', onSettingsUpdated);
    return () => window.removeEventListener('bm-settings-updated', onSettingsUpdated);
  }, []);
  useEffect(() => {
    const onTime = (evt: Event) => {
      const e = evt as CustomEvent<{ label?: string }>;
      setWorkspaceTimeRemaining(String(e.detail?.label || ''));
    };
    window.addEventListener('bm-workspace-time-remaining', onTime as EventListener);
    return () => {
      window.removeEventListener('bm-workspace-time-remaining', onTime as EventListener);
    };
  }, []);

  useEffect(() => {
    if (projectWindowId) return;
    let stopped = false;
    let startupTimer: ReturnType<typeof setTimeout> | null = null;
    let intervalTimer: ReturnType<typeof setInterval> | null = null;
    let running = false;

    const waitForJob = async (jobId: string, timeoutMs = 10 * 60 * 1000) => {
      const started = Date.now();
      while (!stopped && Date.now() - started < timeoutMs) {
        try {
          const job = await api.getJob(jobId);
          if (job?.status === 'completed') return true;
          if (job?.status === 'failed') return false;
        } catch {
          return false;
        }
        await new Promise((r) => setTimeout(r, 1200));
      }
      return false;
    };

    const runArchiveCycle = async () => {
      if (running || stopped) return;
      running = true;
      try {
        const websites = await api.listWebsites();
        for (const site of websites || []) {
          if (stopped) break;
          try {
            const statusJob = await api.checkArchivedTenderStatus(site.id);
            await waitForJob(String(statusJob.job_id || ''));
            const archiveJob = await api.archiveCompletedTenders(site.id);
            await waitForJob(String(archiveJob.job_id || ''));
          } catch {
            // continue with next website
          }
        }
      } catch {
        // no-op
      } finally {
        running = false;
      }
    };

    const setup = async () => {
      let intervalHours = 12;
      try {
        const settings = await api.getSettings();
        const enabled = String(settings?.auto_archive_enabled ?? 'false').trim().toLowerCase() === 'true';
        if (!enabled) return;
        const raw = String(settings?.local_archive_interval_hours ?? '12').trim();
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed >= 1) intervalHours = parsed;
      } catch {
        intervalHours = 12;
      }
      const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000;
      startupTimer = setTimeout(() => {
        void runArchiveCycle();
      }, 20_000);
      intervalTimer = setInterval(() => {
        void runArchiveCycle();
      }, intervalMs);
    };

    void setup();
    return () => {
      stopped = true;
      if (startupTimer) clearTimeout(startupTimer);
      if (intervalTimer) clearInterval(intervalTimer);
    };
  }, [projectWindowId, archiveSettingsRevision]);

  if (projectWindowId) {
    return (
      <RenderErrorBoundary>
        <ProjectWorkspacePage projectId={projectWindowId} />
      </RenderErrorBoundary>
    );
  }

  const pages: Record<Page, JSX.Element> = {
    dashboard: <DashboardPage />,
    tenders: <TendersPage />,
    projects: <ProjectsPage key="projects-active" onOpenProjectWorkspace={(projectId) => setWorkspaceProjectId(projectId)} />,
    archived_projects: <ProjectsPage key="projects-archived" archived onOpenProjectWorkspace={(projectId) => setWorkspaceProjectId(projectId)} />,
    templates: <TemplatesPage />,
    server: <ServerPage />,
    settings: <SettingsPage />,
  };

  return (
    <div className="h-screen flex flex-col bg-[var(--bg)] text-[var(--text)]">
      {/* Top bar */}
      <header className="h-11 flex items-center px-4 border-b border-[var(--border)] bg-[var(--surface-0)] shrink-0 relative z-30">
        <span className="text-xs text-[var(--text-muted)] font-medium">
          Tender & Bid Manager Pro
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-1.5 rounded-md hover:bg-[var(--surface-1)] text-[var(--text-muted)]"
          >
            <Bell size={16} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-[var(--danger)] text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                {unreadCount}
              </span>
            )}
          </button>
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-md hover:bg-[var(--surface-1)] text-[var(--text-muted)]"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
        <NotificationPanel open={showNotifications} onClose={() => setShowNotifications(false)} />
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          active={page}
          onNavigate={setPage}
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
        />
        <main className="flex-1 overflow-hidden bg-[var(--bg)]">
          <RenderErrorBoundary>
            {pages[page]}
          </RenderErrorBoundary>
        </main>
      </div>
      {workspaceProjectId && (
        <>
          <div className="fixed inset-0 z-40 bg-black/35" onClick={() => setWorkspaceProjectId(null)} />
          <aside className="fixed inset-y-0 right-0 z-50 w-[86vw] max-w-[1500px] border-l border-[var(--border)] bg-[var(--bg)] shadow-2xl">
            <div className="flex h-11 items-center justify-between border-b border-[var(--border)] bg-[var(--surface-0)] px-3">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-[var(--text)]">Project Workspace</h3>
                {workspaceTimeRemaining && (
                  <span className="text-xs text-[var(--text-muted)]">{workspaceTimeRemaining}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('bm-workspace-edit-toggle'))}
                  className="btn-ghost gap-1 text-xs"
                >
                  <Edit3 size={12} />
                  Edit Info
                </button>
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('bm-workspace-save'))}
                  className="btn-primary gap-1 text-xs"
                >
                  <Save size={12} />
                  Save
                </button>
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('bm-workspace-open-folder'))}
                  className="btn-ghost gap-1 text-xs"
                >
                  <FolderOpen size={12} />
                  Open Folder
                </button>
                <button onClick={() => setWorkspaceProjectId(null)} className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-1)] hover:text-[var(--text)]">
                  <X size={16} />
                </button>
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
