import { useQuery } from '@tanstack/react-query';
import {
  Globe, FolderOpen, Bookmark, AlertTriangle, IndianRupee,
  Calendar, Activity, Building2, FileText, Users, RefreshCw,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn, formatCrores, formatINR } from '../lib/utils';
import { Badge, TimeBadge, EmptyState, Spinner } from '../components/ui/shared';

export default function DashboardPage() {
  const { data: stats, isLoading, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.dashboardStats,
    refetchInterval: 60000,
  });

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
        description="Could not reach backend API. In Electron dev, restart with npm run dev:electron."
      />
    );
  }

  const statCards = [
    { label: 'Active Tenders', value: stats.active_tenders, icon: Globe, color: 'text-sky-400', bg: 'bg-sky-500/10' },
    { label: 'Active Projects', value: stats.active_projects, icon: FolderOpen, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'Bookmarked', value: stats.bookmarked_tenders, icon: Bookmark, color: 'text-amber-400', bg: 'bg-amber-500/10' },
    { label: 'Archived', value: stats.archived_tenders, icon: AlertTriangle, color: 'text-rose-400', bg: 'bg-rose-500/10' },
  ];

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Dashboard</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">Overview of your tender pipeline</p>
        </div>
        <button onClick={() => refetch()} className="btn-secondary flex items-center gap-2 text-sm">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s, i) => (
          <div key={i} className="card p-4 flex items-center gap-4">
            <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center', s.bg)}>
              <s.icon size={20} className={s.color} />
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--text)]">{s.value}</p>
              <p className="text-xs text-[var(--text-muted)]">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Pipeline Value */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <IndianRupee size={16} className="text-[var(--accent)]" />
            <h3 className="text-sm font-semibold text-[var(--text)]">Pipeline Value</h3>
          </div>
          <p className="text-3xl font-bold text-[var(--text)]">
            {formatCrores(stats.total_pipeline_value)}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            across selected tenders
          </p>
        </div>

        {/* Upcoming Deadlines */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={16} className="text-[var(--accent)]" />
            <h3 className="text-sm font-semibold text-[var(--text)]">Upcoming Deadlines</h3>
          </div>
          <div className="space-y-1">
            {stats.upcoming_deadlines.length === 0 && (
              <p className="text-sm text-[var(--text-muted)] py-4 text-center">No upcoming deadlines</p>
            )}
            {stats.upcoming_deadlines.slice(0, 6).map((d, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0">
                <div className="flex-1 min-w-0 mr-4">
                  <p className="text-xs font-mono text-[var(--accent)]">{d.tender_id}</p>
                  <p className="text-sm text-[var(--text)] truncate">{d.title}</p>
                </div>
                <TimeBadge dateStr={d.closing_date} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Website Coverage */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={16} className="text-[var(--accent)]" />
          <h3 className="text-sm font-semibold text-[var(--text)]">Website Coverage</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {stats.websites.map((w) => (
            <div key={w.id} className="bg-[var(--surface-1)] rounded-lg p-4">
              <p className="font-medium text-sm text-[var(--text)]">{w.name}</p>
              <div className="mt-2 flex items-center gap-4 text-xs text-[var(--text-muted)]">
                <span className="flex items-center gap-1"><Building2 size={12} /> {w.orgs} orgs</span>
                <span className="flex items-center gap-1"><FileText size={12} /> {w.active_tenders} active</span>
                <span className="flex items-center gap-1"><Users size={12} /> {w.selected_orgs} selected</span>
              </div>
            </div>
          ))}
          {stats.websites.length === 0 && (
            <p className="text-sm text-[var(--text-muted)] col-span-3 text-center py-4">No websites configured</p>
          )}
        </div>
      </div>
    </div>
  );
}
