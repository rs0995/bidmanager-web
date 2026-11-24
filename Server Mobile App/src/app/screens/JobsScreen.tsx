import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Layers, RotateCcw, Trash2, X } from 'lucide-react-native';
import { AppHeader } from '../../components/AppHeader';
import { QueryState } from '../../components/QueryState';
import {
  Button,
  Card,
  EmptyState,
  FilterChips,
  IconButton,
  MeterBar,
  Screen,
  StatStrip,
  StatusPill,
  Txt,
} from '../../components/ui';
import { fmtDur, pad2 } from '../../lib/format';
import { useAction, useJobs } from '../../lib/queries';
import { Tone, useTheme } from '../../theme';

type Filter = 'all' | 'running' | 'queued' | 'done' | 'failed';

const TONE: Record<string, Tone> = {
  running: 'info',
  queued: 'neutral',
  done: 'ok',
  failed: 'bad',
  cancelled: 'warn',
};

// "fetch_tenders_selected" → "fetch tenders selected"; a few get friendlier names.
const ACTION_NAMES: Record<string, string> = {
  portal_search_tender: 'Portal search (by a user)',
};
const humanAction = (a: string) => ACTION_NAMES[a] ?? a.replace(/_/g, ' ');

// JobsPanel from the desktop: GET /admin/jobs every 5 s while open,
// Cancel (running/queued), Retry (failed/cancelled), Clear finished (purge).
export function JobsScreen() {
  const t = useTheme();
  const jobs = useJobs();
  const { run, busy } = useAction();
  const [filter, setFilter] = useState<Filter>('all');

  const list = useMemo(() => jobs.data ?? [], [jobs.data]);
  const counts = useMemo(
    () =>
      list.reduce<Record<string, number>>(
        (a, j) => ({ ...a, [j.status]: (a[j.status] || 0) + 1 }),
        {},
      ),
    [list],
  );
  const shown = filter === 'all' ? list : list.filter(j => j.status === filter);

  return (
    <Screen
      tabBar
      header={
        <AppHeader
          code="JOB"
          title="Jobs"
          right={
            <IconButton
              icon={Trash2}
              label="Clear finished"
              onPress={() =>
                run('purge', a => a.purgeJobs(), {
                  success: r =>
                    `Cleared ${r.removed} finished job${r.removed === 1 ? '' : 's'}`,
                  invalidate: ['jobs'],
                })
              }
            />
          }
        />
      }
    >
      {!jobs.data ? (
        <QueryState
          what="the queue"
          loading={jobs.isPending}
          error={jobs.error}
          onRetry={() => jobs.refetch()}
        />
      ) : (
        <>
          <StatStrip
            items={[
              { label: 'Running', value: pad2(counts.running || 0), tone: 'info' },
              { label: 'Queued', value: pad2(counts.queued || 0) },
              { label: 'Done', value: pad2(counts.done || 0), tone: 'ok' },
              { label: 'Failed', value: pad2(counts.failed || 0), tone: 'bad' },
            ]}
          />

          <FilterChips<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All', count: list.length },
              { value: 'running', label: 'Running' },
              { value: 'queued', label: 'Queued' },
              { value: 'done', label: 'Done' },
              { value: 'failed', label: 'Failed' },
            ]}
          />

          <Card pad={false}>
            {shown.length === 0 ? (
              <EmptyState icon={Layers} title="Nothing in this state right now." />
            ) : (
              shown.map((j, i) => (
                <View
                  key={j.id}
                  style={[
                    styles.job,
                    i > 0 && { borderTopWidth: 1, borderTopColor: t.colors.hairSoft },
                  ]}
                >
                  <View style={styles.jobHead}>
                    <Txt variant="monoSmall" color="ink3" numberOfLines={1} style={styles.flex}>
                      {j.id.slice(0, 8)} · {j.kind || 'job'}
                      {j.portal ? ` · ${j.portal}` : ''}
                    </Txt>
                    <StatusPill tone={TONE[j.status] ?? 'neutral'} label={j.status} />
                  </View>
                  <Txt variant="bodyStrong" numberOfLines={1}>
                    {humanAction(j.action) || 'job'}
                  </Txt>
                  {j.tenderId ? (
                    <Txt variant="mono" numberOfLines={1}>
                      {j.tenderId}
                    </Txt>
                  ) : null}
                  {j.error ? (
                    <Txt variant="small" color="bad" numberOfLines={3}>
                      {j.error}
                    </Txt>
                  ) : null}
                  <View style={styles.progressRow}>
                    <MeterBar pct={j.progress} tone={TONE[j.status] ?? 'neutral'} />
                    <Txt variant="monoSmall" color="ink2" style={styles.pct}>
                      {j.progress}%
                    </Txt>
                    <Txt variant="monoSmall" color="ink3" style={styles.elapsed}>
                      {j.startedAt ? fmtDur(Date.now() - j.startedAt) : '—'}
                    </Txt>
                  </View>
                  {j.status === 'running' || j.status === 'queued' ? (
                    <Button
                      label="Cancel"
                      size="sm"
                      variant="danger"
                      icon={X}
                      busy={busy === `cancel:${j.id}`}
                      style={styles.action}
                      onPress={() =>
                        run(`cancel:${j.id}`, a => a.cancelJob(j.id), {
                          success: 'Job cancelled',
                          invalidate: ['jobs'],
                        })
                      }
                    />
                  ) : j.status === 'failed' || j.status === 'cancelled' ? (
                    <Button
                      label="Retry"
                      size="sm"
                      icon={RotateCcw}
                      busy={busy === `retry:${j.id}`}
                      style={styles.action}
                      onPress={() =>
                        run(`retry:${j.id}`, a => a.retryJob(j.id), {
                          success: 'Job queued again',
                          invalidate: ['jobs'],
                        })
                      }
                    />
                  ) : null}
                </View>
              ))
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  job: { padding: 14, gap: 5 },
  jobHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  pct: { width: 38, textAlign: 'right' },
  elapsed: { width: 58, textAlign: 'right' },
  action: { alignSelf: 'flex-start', marginTop: 4 },
});
