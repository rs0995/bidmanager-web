import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react-native';
import { AppHeader } from '../../components/AppHeader';
import { JobCard } from '../../components/JobCard';
import { QueryState } from '../../components/QueryState';
import {
  Button,
  Card,
  Checkbox,
  ConfirmSheet,
  KeyValue,
  ListRow,
  Screen,
  SearchField,
  Section,
  Txt,
  useToast,
} from '../../components/ui';
import { fmtDateTime, fromSecs } from '../../lib/format';
import {
  useAction,
  useSavedJobs,
  useSavedJobScope,
  useWebsites,
} from '../../lib/queries';
import { isPaused, jobToInput, saveJobKeepingPause } from '../../lib/savedJobs';
import type { SavedJob } from '../../lib/types';
import { useSession } from '../../state/session';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'JobDetail'>;

// One saved job: its summary and run controls, then its scope as a checklist.
// Unticking items and saving removes them from the job. Adding items, and the
// timer and schedule, are changed in the full editor ("Edit schedule & scope").
export function JobDetailScreen({ route, navigation }: Props) {
  const saved = useSavedJobs();
  const job = saved.data?.find(j => j.id === Number(route.params.jobId));

  if (!job) {
    return (
      <Screen header={<AppHeader back code="JOB" title="Saved job" />}>
        <QueryState
          what="the saved job"
          loading={saved.isPending}
          error={saved.error ?? (saved.data ? new Error('This saved job no longer exists.') : null)}
          onRetry={() => saved.refetch()}
        />
      </Screen>
    );
  }
  return <JobDetail job={job} onGone={() => navigation.goBack()} navigation={navigation} />;
}

function JobDetail({
  job,
  onGone,
  navigation,
}: {
  job: SavedJob;
  onGone: () => void;
  navigation: Props['navigation'];
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { base } = useSession();
  const { run, busy } = useAction();
  const websites = useWebsites();
  const scope = useSavedJobScope(job.id);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isDownload = job.job_type === 'download';
  const items = useMemo(() => {
    const d = scope.data;
    if (!d) return [];
    return isDownload
      ? d.tenders.map(x => ({
          id: x.id,
          title: x.title || x.tender_id,
          meta: `${x.tender_id}${x.closing_date ? ` · closes ${x.closing_date}` : ''}`,
        }))
      : d.organizations.map(o => ({ id: o.id, title: o.name, meta: '' }));
  }, [scope.data, isDownload]);
  const shown = items.filter(i => i.title.toLowerCase().includes(query.toLowerCase()));
  const kept = items.filter(i => !removed.has(i.id));
  const site = websites.data?.find(w => w.id === job.website_id);

  const toggle = (id: number) =>
    setRemoved(r => {
      const n = new Set(r);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const saveScope = async () => {
    if (kept.length === 0) {
      toast(isDownload ? 'Keep at least one tender.' : 'Keep at least one organization.');
      return;
    }
    const ids = kept.map(i => i.id);
    const input = jobToInput(job, isDownload ? { tender_ids: ids } : { org_ids: ids });
    if ('error' in input) {
      toast(input.error);
      return;
    }
    const ok = await run(
      'scope',
      a => saveJobKeepingPause(a, input, job.id, isPaused(job)),
      { success: 'Scope saved', invalidate: ['savedJobs'] },
    );
    if (ok) {
      setRemoved(new Set());
      queryClient.invalidateQueries({ queryKey: [base, 'savedJobScope', job.id] });
    }
  };

  return (
    <Screen
      header={
        <AppHeader back code="JOB" title={job.name} />
      }
      footer={
        removed.size ? (
          <View style={styles.footer}>
            <Button label="Discard" onPress={() => setRemoved(new Set())} style={styles.flex} />
            <Button
              label={`Save scope (${removed.size} removed)`}
              variant="primary"
              busy={busy === 'scope'}
              onPress={saveScope}
              style={styles.flex}
            />
          </View>
        ) : undefined
      }
    >
      <JobCard
        job={job}
        running={busy === 'run'}
        toggling={busy === 'sched'}
        onRun={() =>
          run('run', a => a.runSavedJob(job.id, job.owner_name), {
            success: r => `${r.queued_count} job${r.queued_count === 1 ? '' : 's'} queued`,
            invalidate: ['jobs', 'savedJobs'],
          })
        }
        onTogglePause={() =>
          run('sched', a => a.setSavedJobSchedule(job.id, !job.schedule_enabled), {
            success: r => (r.enabled ? 'Schedule resumed' : 'Schedule paused'),
            invalidate: ['savedJobs'],
          })
        }
        onDelete={() => setConfirmDelete(true)}
      />

      <Card>
        <KeyValue label="Website" value={site?.name ?? `#${job.website_id}`} />
        <KeyValue
          label="Owner"
          value={job.created_by === 'user' ? 'Auto (client bookmarks)' : job.owner_name || '—'}
        />
        <KeyValue label="Created" value={fmtDateTime(fromSecs(job.created_at))} />
        {isDownload ? <KeyValue label="Download mode" value={job.download_mode} /> : null}
      </Card>

      <Button
        label="Edit schedule & scope"
        icon={Pencil}
        onPress={() =>
          navigation.navigate('CustomJobEditor', { jobId: job.id, websiteId: job.website_id })
        }
        block
      />

      <Section
        title={isDownload ? 'Tenders' : 'Organizations'}
        meta={
          job.all_organizations
            ? 'entire website'
            : scope.data
            ? `${kept.length} of ${items.length}`
            : undefined
        }
        pad={false}
      >
        {job.all_organizations ? (
          <Txt color="ink2" style={styles.note}>
            Scrapes every organization on this website.
          </Txt>
        ) : !scope.data ? (
          <View style={styles.inset}>
            <QueryState
              what="the scope"
              loading={scope.isPending}
              error={scope.error}
              onRetry={() => scope.refetch()}
            />
          </View>
        ) : (
          <>
            {items.length > 8 ? (
              <View style={styles.search}>
                <SearchField value={query} onChangeText={setQuery} placeholder="Filter" />
              </View>
            ) : null}
            {shown.map((i, n) => (
              <ListRow
                key={i.id}
                title={i.title}
                meta={i.meta || undefined}
                divider={n > 0}
                onPress={() => toggle(i.id)}
                left={
                  <Checkbox
                    checked={!removed.has(i.id)}
                    onChange={() => toggle(i.id)}
                    label={i.title}
                  />
                }
              />
            ))}
            <Txt variant="small" color="ink3" style={styles.note}>
              Untick to remove from this job. To add more, use Edit schedule & scope.
            </Txt>
          </>
        )}
      </Section>

      <ConfirmSheet
        visible={confirmDelete}
        title="Delete saved job?"
        message={
          job.created_by === 'user'
            ? `“${job.name}” keeps bookmarked tenders up to date. Deleting it turns bookmark updates off for this website until you resume them.`
            : `“${job.name}” and its schedule will be removed.`
        }
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          const ok = await run('delete', a => a.deleteSavedJob(job.id, job.owner_name), {
            success: 'Saved job deleted',
            invalidate: ['savedJobs', 'suppressed'],
          });
          if (ok) onGone();
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  footer: { flexDirection: 'row', gap: 10 },
  inset: { paddingHorizontal: 14 },
  search: { paddingHorizontal: 14, paddingBottom: 10 },
  note: { padding: 14 },
});
