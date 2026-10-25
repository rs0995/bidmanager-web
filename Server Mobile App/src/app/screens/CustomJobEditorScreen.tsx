import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppHeader } from '../../components/AppHeader';
import { QueryState } from '../../components/QueryState';
import {
  Button,
  Card,
  Checkbox,
  DateTimePicker,
  ListRow,
  Screen,
  SearchField,
  Section,
  SegmentedControl,
  SettingRow,
  TextField,
  Toggle,
  Txt,
  WeekdayPicker,
} from '../../components/ui';
import {
  useAction,
  useOrganizations,
  useSavedJobs,
  useTenders,
  useWebsites,
} from '../../lib/queries';
import { formatIst, nextWholeHour, parseIst } from '../../lib/format';
import { isPaused, saveJobKeepingPause } from '../../lib/savedJobs';
import type { SavedJob, SavedJobInput, ScheduleMode } from '../../lib/types';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'CustomJobEditor'>;

// Remembered between sessions, like the desktop's bidmanager.admin.owner.v1.
const OWNER_KEY = 'bm.admin.owner';
const DEFAULT_DAYS = 'mon,tue,wed,thu,fri,sat';

// Repeat interval as a number + unit, like the desktop (any value, not a fixed list).
type Unit = 'minutes' | 'hours' | 'days';
const UNIT_MIN: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };

function splitInterval(minutes: number): { count: string; unit: Unit } {
  const m = minutes > 0 ? minutes : 1440;
  if (m % 1440 === 0) return { count: String(m / 1440), unit: 'days' };
  if (m % 60 === 0) return { count: String(m / 60), unit: 'hours' };
  return { count: String(m), unit: 'minutes' };
}

// Create / edit a saved job (the desktop ScraperPanel's job form). Waits for the
// saved job to load when editing, then hands it to the form.
export function CustomJobEditorScreen({ route, navigation }: Props) {
  const { jobId, websiteId } = route.params;
  const saved = useSavedJobs();
  const job = jobId != null ? saved.data?.find(j => j.id === Number(jobId)) : undefined;
  const loading = jobId != null && !job;

  return loading ? (
    <Screen header={<AppHeader back code="JOB" title="Edit job" />}>
      <QueryState
        what="the saved job"
        loading={saved.isPending}
        error={saved.error ?? (saved.data ? new Error('This saved job no longer exists.') : null)}
        onRetry={() => saved.refetch()}
      />
    </Screen>
  ) : (
    <JobForm
      job={job}
      websiteId={job?.website_id ?? Number(websiteId)}
      onDone={() => navigation.goBack()}
    />
  );
}

function JobForm({
  job,
  websiteId,
  onDone,
}: {
  job?: SavedJob;
  websiteId: number;
  onDone: () => void;
}) {
  const { run, busy } = useAction();
  const websites = useWebsites();
  const site = websites.data?.find(w => w.id === websiteId);

  const [owner, setOwner] = useState(job?.owner_name ?? '');
  const [name, setName] = useState(job?.name ?? '');
  const [type, setType] = useState<'scrape' | 'download'>(job?.job_type ?? 'scrape');
  const [allOrgs, setAllOrgs] = useState(job?.all_organizations ?? false);
  const [orgIds, setOrgIds] = useState(new Set(job?.org_ids ?? []));
  const [tenderIds, setTenderIds] = useState(new Set(job?.tender_ids ?? []));
  const [mode, setMode] = useState<ScheduleMode>(job?.schedule_mode ?? 'manual');
  const [runAt, setRunAt] = useState(() => {
    const upcoming = job?.next_run_at && job.next_run_at * 1000 > Date.now() ? job.next_run_at : 0;
    return formatIst(upcoming || nextWholeHour());
  });
  const [every, setEvery] = useState(() => splitInterval(job?.interval_minutes ?? 0));
  const intervalMinutes = (Number(every.count) || 0) * UNIT_MIN[every.unit];
  const [days, setDays] = useState(job?.run_days?.join(',') || DEFAULT_DAYS);
  const [query, setQuery] = useState('');

  // New jobs default to the last owner name used on this device.
  useEffect(() => {
    if (job) return;
    AsyncStorage.getItem(OWNER_KEY)
      .then(v => v && setOwner(o => o || v))
      .catch(() => {});
  }, [job]);

  const orgs = useOrganizations(type === 'scrape' ? websiteId : undefined);
  const tenders = useTenders(type === 'download' ? websiteId : undefined, false);

  const shownOrgs = useMemo(
    () =>
      (orgs.data ?? []).filter(o => o.name.toLowerCase().includes(query.toLowerCase())),
    [orgs.data, query],
  );
  const shownTenders = useMemo(
    () =>
      (tenders.data ?? []).filter(x =>
        `${x.tender_id ?? ''} ${x.title ?? ''}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [tenders.data, query],
  );

  const runAtSecs = parseIst(runAt);
  const problem = !owner.trim()
    ? 'Enter an owner name.'
    : !name.trim()
    ? 'Enter a job name.'
    : type === 'scrape' && !allOrgs && orgIds.size === 0
    ? 'Pick at least one organization, or the entire website.'
    : type === 'download' && tenderIds.size === 0
    ? 'Pick at least one tender.'
    : mode !== 'manual' && (!runAtSecs || runAtSecs * 1000 <= Date.now())
    ? 'Pick a future date and time (or type it as YYYY-MM-DD HH:MM).'
    : mode === 'interval' && intervalMinutes <= 0
    ? 'Enter how often the job repeats.'
    : mode === 'interval' && !days
    ? 'Pick at least one run day.'
    : '';

  const save = async (asNew: boolean) => {
    const input: SavedJobInput = {
      owner_name: owner.trim(),
      name: name.trim(),
      website_id: websiteId,
      job_type: type,
      org_ids: [...orgIds],
      tender_ids: [...tenderIds],
      all_organizations: type === 'scrape' && allOrgs,
      download_mode: 'auto',
      schedule_enabled: mode !== 'manual',
      schedule_mode: mode,
      interval_minutes: mode === 'interval' ? intervalMinutes : 0,
      // Once: the run time. Repeat: the first run, like the desktop.
      scheduled_for_at: mode === 'manual' ? 0 : runAtSecs ?? 0,
      run_days: mode === 'interval' ? days.split(',').filter(Boolean) : undefined,
    };
    const updating = job && !asNew;
    // Editing a paused job must not quietly resume it.
    const wasPaused = !!(updating && isPaused(job));
    const ok = await run('save', a => saveJobKeepingPause(a, input, updating ? job.id : undefined, wasPaused), {
      success: updating ? 'Saved job updated' : 'Saved job created',
      invalidate: ['savedJobs'],
    });
    if (ok) {
      AsyncStorage.setItem(OWNER_KEY, input.owner_name).catch(() => {});
      onDone();
    }
  };

  const toggle = (set: Set<number>, id: number) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };

  return (
    <Screen
      header={
        <AppHeader back code="JOB" title={job ? 'Edit job' : 'New job'} />
      }
      footer={
        <View style={styles.footerWrap}>
          {problem ? (
            <Txt variant="small" color="warn">
              {problem}
            </Txt>
          ) : null}
          <View style={styles.footer}>
            {job ? (
              <Button
                label="Save as new"
                disabled={!!problem || !!busy}
                onPress={() => save(true)}
                style={styles.flex}
              />
            ) : null}
            <Button
              label={job ? 'Update' : 'Save job'}
              variant="primary"
              busy={busy === 'save'}
              disabled={!!problem}
              onPress={() => save(false)}
              style={styles.flex}
            />
          </View>
        </View>
      }
    >
      <Card>
        <View style={styles.fields}>
          <Txt variant="label">{site?.name ?? `Website ${websiteId}`}</Txt>
          <TextField
            label="Owner"
            value={owner}
            onChangeText={setOwner}
            placeholder="Your name"
            editable={!job}
            // The server matches updates on id + owner, so the owner is fixed once saved.
            hint={job ? 'Owner can’t be changed on an existing job.' : undefined}
          />
          <TextField
            label="Job name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. PWD morning sweep"
          />
          <View style={styles.field}>
            <Txt variant="bodyStrong">Task</Txt>
            <SegmentedControl
              value={type}
              onChange={v => {
                setType(v);
                setQuery('');
              }}
              options={[
                { value: 'scrape', label: 'Scrape' },
                { value: 'download', label: 'Download' },
              ]}
            />
          </View>
        </View>
      </Card>

      <Section title="Schedule">
        <View style={styles.fields}>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            options={[
              { value: 'manual', label: 'Manual' },
              { value: 'once', label: 'Run once at' },
              { value: 'interval', label: 'Repeat' },
            ]}
          />
          {mode === 'interval' ? (
            <>
              <View style={styles.field}>
                <Txt variant="bodyStrong">Every</Txt>
                <View style={styles.everyRow}>
                  <TextField
                    compact
                    mono
                    keyboardType="number-pad"
                    value={every.count}
                    onChangeText={v => setEvery(e => ({ ...e, count: v.replace(/\D/g, '') }))}
                    label="Repeat count"
                  />
                  <View style={styles.flex}>
                    <SegmentedControl<Unit>
                      value={every.unit}
                      onChange={unit => setEvery(e => ({ ...e, unit }))}
                      options={[
                        { value: 'minutes', label: 'Mins' },
                        { value: 'hours', label: 'Hours' },
                        { value: 'days', label: 'Days' },
                      ]}
                    />
                  </View>
                </View>
              </View>
              <View style={styles.field}>
                <Txt variant="bodyStrong">Run on</Txt>
                <WeekdayPicker value={days} onChange={setDays} />
              </View>
            </>
          ) : null}
          {mode !== 'manual' ? (
            <View style={styles.field}>
              <TextField
                label={mode === 'once' ? 'Run at (IST)' : 'First run (IST)'}
                value={runAt}
                onChangeText={setRunAt}
                placeholder="2026-10-15 09:30"
                mono
              />
              <DateTimePicker
                value={runAt}
                onChange={setRunAt}
                fallbackSecs={nextWholeHour()}
              />
              {mode === 'interval' ? (
                <Txt variant="small" color="ink3">
                  The scheduler's downtime window and pause days (Job queue
                  settings) still apply.
                </Txt>
              ) : null}
            </View>
          ) : (
            <Txt variant="small" color="ink3">
              Runs only when you tap Run once.
            </Txt>
          )}
        </View>
      </Section>

      <Section
        title={type === 'scrape' ? 'Organizations' : 'Tenders'}
        meta={
          type === 'scrape'
            ? allOrgs
              ? 'entire website'
              : `${orgIds.size} selected`
            : `${tenderIds.size} selected`
        }
        pad={false}
      >
        {type === 'scrape' ? (
          <View style={styles.inset}>
            <SettingRow label="Entire website" hint="Every organization on this portal">
              <Toggle value={allOrgs} onChange={setAllOrgs} label="Entire website" />
            </SettingRow>
          </View>
        ) : null}
        {type === 'download' || !allOrgs ? (
          <>
            <View style={styles.search}>
              <SearchField value={query} onChangeText={setQuery} placeholder="Filter" />
            </View>
            {type === 'scrape' ? (
              !orgs.data ? (
                <View style={styles.inset}>
                  <QueryState
                    what="organizations"
                    loading={orgs.isPending}
                    error={orgs.error}
                    onRetry={() => orgs.refetch()}
                  />
                </View>
              ) : (
                shownOrgs.map(o => (
                  <ListRow
                    key={o.id}
                    title={o.name}
                    meta={`${o.tender_count} tenders`}
                    divider
                    onPress={() => setOrgIds(s => toggle(s, o.id))}
                    left={
                      <Checkbox
                        checked={orgIds.has(o.id)}
                        onChange={() => setOrgIds(s => toggle(s, o.id))}
                        label={o.name}
                      />
                    }
                  />
                ))
              )
            ) : !tenders.data ? (
              <View style={styles.inset}>
                <QueryState
                  what="tenders"
                  loading={tenders.isPending}
                  error={tenders.error}
                  onRetry={() => tenders.refetch()}
                />
              </View>
            ) : (
              shownTenders.map(x => (
                <ListRow
                  key={x.id}
                  title={x.title || x.tender_id || `Tender ${x.id}`}
                  meta={`${x.tender_id ?? '—'} · closes ${x.closing_date || '—'}`}
                  divider
                  onPress={() => setTenderIds(s => toggle(s, x.id))}
                  left={
                    <Checkbox
                      checked={tenderIds.has(x.id)}
                      onChange={() => setTenderIds(s => toggle(s, x.id))}
                      label={x.tender_id ?? String(x.id)}
                    />
                  }
                />
              ))
            )}
          </>
        ) : null}
      </Section>

    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fields: { gap: 14 },
  field: { gap: 6 },
  everyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inset: { paddingHorizontal: 14 },
  search: { paddingHorizontal: 14, paddingBottom: 10 },
  footerWrap: { gap: 8 },
  footer: { flexDirection: 'row', gap: 10 },
});
