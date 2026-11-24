import React from 'react';
import { Globe, FolderOpen, Clock } from 'lucide-react';
import { StatCard } from '../components/dashboard/StatCard.jsx';
import { BookmarksStatCard } from '../components/dashboard/BookmarksStatCard.jsx';
import { NeedsAttentionCard } from '../components/dashboard/NeedsAttentionCard.jsx';
import { DeadlineGroups } from '../components/dashboard/DeadlineGroups.jsx';
import { SkeletonList } from '../components/feedback/Skeleton.jsx';
import { ErrorState } from '../components/feedback/ErrorState.jsx';
import { useStats } from '../hooks/useStats.js';
import { useBookmarkToggle, useBookmarkedTenders, useOrgBookmarkToggle } from '../hooks/useBookmarks.js';
import { useProjects } from '../lib/projects.js';
import { useSettings } from '../lib/store.js';
import { syncNow } from '../lib/sync.js';
import { fmtINR, timeRemaining, parseINR } from '../lib/format.js';
import { useToast } from '../components/feedback/ToastProvider.jsx';
import { useState } from 'react';

const STALE_MS = 30 * 60 * 1000;

export function OverviewScreen() {
  const { data: stats, isLoading, isError, error, refetch } = useStats();
  const { bookmarkedIds } = useBookmarkToggle();
  const { bookmarkedOrgNames } = useOrgBookmarkToggle();
  const { tenders: trackedTenders } = useBookmarkedTenders();
  const projects = useProjects();
  const { lastSyncAt } = useSettings();
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);

  const activeProjects = projects.filter((p) => p.status !== 'Archived');
  const pipelineValue = activeProjects.reduce((sum, p) => sum + parseINR(p.project_value), 0);
  const closingThisWeek = trackedTenders.filter((t) => {
    const { totalDays, expired } = timeRemaining(t.closing_date);
    return !expired && totalDays != null && totalDays <= 7;
  }).length;

  const isStale = !lastSyncAt || (Date.now() - new Date(lastSyncAt).getTime()) > STALE_MS;
  const [pipelineAmount, pipelineUnit] = fmtINR(pipelineValue).split(' ');

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
      <div className="p-4">
        <h1 className="text-2xl font-bold m-0 mb-4">Overview</h1>
        {isLoading && <SkeletonList count={2} />}
        {isError && <ErrorState message={error?.message} onRetry={refetch} />}
        {stats && (
          <>
            <NeedsAttentionCard />

            <div className="kpi-grid mb-4">
              <StatCard label="Tenders synced" value={stats.active_tenders} to="/tenders" icon={Globe} variant="accent" />
              <StatCard label="Active projects" value={activeProjects.length} to="/projects" icon={FolderOpen} variant="ok" />
              <BookmarksStatCard orgCount={bookmarkedOrgNames.size} tenderCount={bookmarkedIds.size} to="/bookmarks" />
              <StatCard label="Closing this week" value={closingThisWeek} to="/tenders?closing5=1" icon={Clock} variant="danger" alert={closingThisWeek > 0} />
            </div>

            <button className="panel tap mb-4" style={{ display: 'block' }}>
              <div className="pipe-head">
                <h3>Pipeline value — bids in preparation</h3>
                <span className="chip plain">{activeProjects.length} projects</span>
              </div>
              <div className="pipe-val">{pipelineAmount}{pipelineUnit && <span> {pipelineUnit}</span>}</div>
            </button>

            <div className={isStale ? 'sync mb-4' : 'sync done mb-4'}>
              <div>
                <h3>{isStale ? 'Sync tenders' : 'Up to date'}</h3>
                <p>
                  {lastSyncAt ? `Last synced ${new Date(lastSyncAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Never synced yet'}
                </p>
              </div>
              <button onClick={handleSync} disabled={syncing}>
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            </div>

            <DeadlineGroups />
          </>
        )}
      </div>
    </div>
  );
}
