import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, RefreshCw } from 'lucide-react-native';
import { AppHeader } from '../../components/AppHeader';
import { QueryState } from '../../components/QueryState';
import {
  Button,
  Card,
  EmptyState,
  FilterChips,
  IconButton,
  Screen,
  SearchField,
  StatusPill,
  Txt,
  useToast,
} from '../../components/ui';
import { fmtAgo, fromSecs } from '../../lib/format';
import {
  useAction,
  useServerQuery,
  useTenders,
  useWebsites,
} from '../../lib/queries';
import { useSession } from '../../state/session';
import { useTheme } from '../../theme';

// ArchivePanel from the desktop. "Fetch status" queues a server job; while any
// are pending the screen polls /admin/jobs every 3 s, and when a job finishes
// (or disappears) it reloads the list so the new `status` shows.
export function ArchiveScreen() {
  const t = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { base } = useSession();
  const { run } = useAction();
  const websites = useWebsites();
  const [siteId, setSiteId] = useState<number | undefined>();
  const [query, setQuery] = useState('');
  // tender DB id → job id
  const [pending, setPending] = useState<Record<number, string>>({});

  useEffect(() => {
    if (siteId == null && websites.data?.length) setSiteId(websites.data[0].id);
  }, [siteId, websites.data]);

  const tenders = useTenders(siteId, true);
  const watching = Object.keys(pending).length > 0;
  const jobs = useServerQuery(['jobs'], a => a.jobs(), {
    poll: 3_000,
    enabled: watching,
  });

  useEffect(() => {
    if (!watching || !jobs.data) return;
    const byId = new Map(jobs.data.map(j => [j.id, j]));
    const finished = Object.entries(pending).filter(([, jobId]) => {
      const job = byId.get(jobId);
      return !job || ['done', 'failed', 'cancelled'].includes(job.status);
    });
    if (!finished.length) return;
    finished.forEach(([, jobId]) => {
      const job = byId.get(jobId);
      if (job?.status === 'failed') toast(job.error || 'Status check failed');
    });
    setPending(p => {
      const next = { ...p };
      finished.forEach(([id]) => delete next[Number(id)]);
      return next;
    });
    queryClient.invalidateQueries({ queryKey: [base, 'tenders'] });
  }, [jobs.data, pending, watching, toast, queryClient, base]);

  const rows = useMemo(
    () =>
      (tenders.data ?? []).filter(a =>
        `${a.tender_id ?? ''} ${a.title ?? ''} ${a.org_chain ?? ''}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [tenders.data, query],
  );

  const fetchStatus = async (id: number) => {
    const r = await run(`status:${id}`, a => a.fetchTenderStatus(id));
    const jobId = r?.job_id || r?.id;
    if (jobId) setPending(p => ({ ...p, [id]: jobId }));
  };

  return (
    <Screen
      header={
        <AppHeader
          back
          code="ARC"
          title="Archive"
          right={
            <IconButton
              icon={RefreshCw}
              label="Refresh"
              onPress={() => tenders.refetch()}
            />
          }
        />
      }
    >
      {!websites.data ? (
        <QueryState
          what="websites"
          loading={websites.isPending}
          error={websites.error}
          onRetry={() => websites.refetch()}
        />
      ) : (
        <>
          <FilterChips
            value={String(siteId ?? '')}
            onChange={v => setSiteId(Number(v))}
            options={websites.data.map(w => ({ value: String(w.id), label: w.name }))}
          />
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Search archived tenders"
          />
          {!tenders.data ? (
            <QueryState
              what="archived tenders"
              loading={tenders.isPending}
              error={tenders.error}
              onRetry={() => tenders.refetch()}
            />
          ) : (
            <Card pad={false}>
              {rows.length === 0 ? (
                <EmptyState icon={Archive} title="No archived tenders here." />
              ) : (
                rows.map((a, i) => {
                  const checking = a.id in pending;
                  return (
                    <View
                      key={a.id}
                      style={[
                        styles.row,
                        i > 0 && { borderTopWidth: 1, borderTopColor: t.colors.hairSoft },
                      ]}
                    >
                      <Txt variant="bodyStrong" numberOfLines={2}>
                        {a.title || a.tender_id || `Tender ${a.id}`}
                      </Txt>
                      <Txt variant="monoSmall" color="ink3" numberOfLines={1}>
                        {a.tender_id ?? '—'} · closed {a.closing_date || '—'}
                      </Txt>
                      <View style={styles.statusRow}>
                        <StatusPill
                          tone={checking ? 'neutral' : a.status ? 'info' : 'neutral'}
                          label={checking ? 'checking…' : a.status || 'not fetched'}
                        />
                        <Txt variant="monoSmall" color="ink3" style={styles.flex}>
                          {a.last_scraped_at ? `scraped ${fmtAgo(fromSecs(a.last_scraped_at))}` : ''}
                        </Txt>
                        <Button
                          label="Fetch status"
                          size="sm"
                          busy={checking}
                          disabled={!a.tender_id}
                          onPress={() => fetchStatus(a.id)}
                        />
                      </View>
                    </View>
                  );
                })
              )}
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { padding: 14, gap: 5 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
});
