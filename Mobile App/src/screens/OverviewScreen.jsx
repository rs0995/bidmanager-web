import React from 'react';
import { Globe, Bookmark, FolderOpen, Clock, IndianRupee, RefreshCw } from 'lucide-react';
import { ScreenHeader } from '../components/shell/ScreenHeader.jsx';
import { StatCard } from '../components/dashboard/StatCard.jsx';
import { NeedsAttentionCard } from '../components/dashboard/NeedsAttentionCard.jsx';
import { DeadlineGroups } from '../components/dashboard/DeadlineGroups.jsx';
import { SkeletonList } from '../components/feedback/Skeleton.jsx';
import { ErrorState } from '../components/feedback/ErrorState.jsx';
import { Button } from '../components/common/Button.jsx';
import { useStats } from '../hooks/useStats.js';
import { useBookmarkToggle, useBookmarkedTenders } from '../hooks/useBookmarks.js';
import { useProjects } from '../lib/projects.js';
import { useSettings } from '../lib/store.js';
import { syncNow } from '../lib/sync.js';
import { fmtINR, timeRemaining } from '../lib/format.js';
import { useToast } from '../components/feedback/ToastProvider.jsx';
import { useState } from 'react';

const STALE_MS = 30 * 60 * 1000;

export function OverviewScreen() {
  const { data: stats, isLoading, isError, error, refetch } = useStats();
  const { bookmarkedIds } = useBookmarkToggle();
  const { tenders: trackedTenders } = useBookmarkedTenders();
  const projects = useProjects();
  const { lastSyncAt } = useSettings();
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);

  const activeProjects = projects.filter((p) => p.status !== 'Archived');
  const pipelineValue = activeProjects.reduce((sum, p) => sum + (Number(p.project_value) || 0), 0);
  const closingThisWeek = trackedTenders.filter((t) => {
    const { totalDays, expired } = timeRemaining(t.closing_date);
    return !expired && totalDays != null && totalDays <= 7;
  }).length;

  const isStale = !lastSyncAt || (Date.now() - new Date(lastSyncAt).getTime()) > STALE_MS;

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncNow();
      await refetch();
      toast?.push({ title: 'Sync complete' });
    } catch (e) {
      toast?.push({ title: 'Sync failed', body: e?.message, type: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <ScreenHeader title="Overview" />
      <div className="p-4">
        {isLoading && <SkeletonList count={2} />}
        {isError && <ErrorState message={error?.message} onRetry={refetch} />}
        {stats && (
          <>
            <NeedsAttentionCard />

            <div className="grid grid-cols-2 gap-3 mb-4">
              <StatCard icon={Globe} label="Tenders synced" value={stats.active_tenders} to="/tenders" />
              <StatCard icon={FolderOpen} label="Active projects" value={activeProjects.length} to="/projects" />
              <StatCard icon={Bookmark} label="Bookmarked" value={bookmarkedIds.size} to="/tenders?bookmarked_only=1" />
              <StatCard icon={Clock} label="Closing this week" value={closingThisWeek} to="/tenders?closing5=1" alert={closingThisWeek > 0} />
            </div>

            <div className="card p-4 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <IndianRupee size={14} style={{ color: 'var(--accent)' }} />
                <h3 className="m-0 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Pipeline value</h3>
              </div>
              <p className="m-0 text-2xl font-bold">{fmtINR(pipelineValue)}</p>
              <p className="m-0 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Sum of your local project values ({activeProjects.length} active)</p>
            </div>

            <div
              className="rounded-2xl p-4 mb-4 flex items-center gap-3"
              style={{ background: isStale ? 'var(--accent-bg)' : 'var(--surface-1)', border: `1px solid ${isStale ? 'var(--accent)' : 'var(--border)'}` }}
            >
              <div className="flex-1">
                <h3 className="m-0 text-sm font-semibold" style={{ color: isStale ? 'var(--accent)' : 'var(--text)' }}>
                  {isStale ? 'Sync tenders' : 'Up to date'}
                </h3>
                <p className="m-0 mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {lastSyncAt ? `Last synced ${new Date(lastSyncAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Never synced yet'}
                </p>
              </div>
              <Button onClick={handleSync} disabled={syncing}>
                <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing…' : 'Sync now'}
              </Button>
            </div>

            <DeadlineGroups />
          </>
        )}
      </div>
    </div>
  );
}
