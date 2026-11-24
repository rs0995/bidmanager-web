import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { AppHeader } from '../../components/AppHeader';
import { QueryState } from '../../components/QueryState';
import {
  Button,
  Card,
  Screen,
  SettingRow,
  TextField,
  Toggle,
  Txt,
  WeekdayPicker,
} from '../../components/ui';
import { useAction, useConfig } from '../../lib/queries';
import type { Settings } from '../../lib/types';
import { useSession } from '../../state/session';

// Only the "Job queue" card of the desktop's Settings (ConfigPanel). Keys are the
// server's own names; values are normalised because the server returns stored
// strings coerced loosely ("true" → true, "45" → 45).
type JobQueue = {
  dedupe_by_tender_id: boolean;
  job_ttl_minutes: number;
  max_queue_depth: number;
  poll_interval_ms: number;
  archive_daily_enabled: boolean;
  archive_daily_hour: number;
  scheduler_downtime_from: string;
  scheduler_downtime_to: string;
  scheduler_downtime_days: string;
};
type Key = keyof JobQueue;

const bool = (v: unknown, d: boolean) =>
  v == null ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
const num = (v: unknown, d: number) => {
  const n = Number(v);
  return v === '' || v == null || !Number.isFinite(n) ? d : n;
};
const str = (v: unknown) => (v == null ? '' : String(v));

function pick(s: Settings): JobQueue {
  return {
    dedupe_by_tender_id: bool(s.dedupe_by_tender_id, true),
    job_ttl_minutes: num(s.job_ttl_minutes, 45),
    max_queue_depth: num(s.max_queue_depth, 25),
    poll_interval_ms: num(s.poll_interval_ms, 1200),
    archive_daily_enabled: bool(s.archive_daily_enabled, true),
    archive_daily_hour: num(s.archive_daily_hour, 20),
    scheduler_downtime_from: str(s.scheduler_downtime_from),
    scheduler_downtime_to: str(s.scheduler_downtime_to),
    scheduler_downtime_days: str(s.scheduler_downtime_days),
  };
}

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

export function SettingsScreen() {
  const config = useConfig();
  return config.data ? (
    // Remount the form whenever fresh settings arrive from the server.
    <SettingsForm key={JSON.stringify(pick(config.data))} saved={pick(config.data)} />
  ) : (
    <Screen header={<AppHeader back code="CFG" title="Job queue" />}>
      <QueryState
        what="settings"
        loading={config.isPending}
        error={config.error}
        onRetry={() => config.refetch()}
      />
    </Screen>
  );
}

function SettingsForm({ saved }: { saved: JobQueue }) {
  const queryClient = useQueryClient();
  const { base } = useSession();
  const { run, busy } = useAction();
  const [draft, setDraft] = useState(saved);

  const set = <K extends Key>(k: K, v: JobQueue[K]) => setDraft(d => ({ ...d, [k]: v }));
  const dirty = (k: Key) => draft[k] !== saved[k];
  const changed = (Object.keys(draft) as Key[]).filter(dirty);

  const problem =
    draft.archive_daily_hour < 0 || draft.archive_daily_hour > 23
      ? 'Archive run time must be an hour from 0 to 23.'
      : (draft.scheduler_downtime_from && !HHMM.test(draft.scheduler_downtime_from)) ||
        (draft.scheduler_downtime_to && !HHMM.test(draft.scheduler_downtime_to))
      ? 'Downtime times must be HH:MM (24-hour), or blank.'
      : draft.max_queue_depth < 1
      ? 'Queue depth limit must be at least 1.'
      : '';

  const save = async () => {
    const patch: Settings = {};
    changed.forEach(k => {
      patch[k] = draft[k];
    });
    const next = await run('save', a => a.saveConfig(patch), {
      success: `Saved ${changed.length} change${changed.length === 1 ? '' : 's'}`,
    });
    // The PUT answers with the full settings; this remounts the form clean.
    if (next) queryClient.setQueryData([base, 'config'], next);
  };

  const numField = (k: Key, suffix?: string) => (
    <TextField
      compact
      mono
      keyboardType="number-pad"
      value={String(draft[k])}
      onChangeText={v => set(k, (Number(v.replace(/\D/g, '')) || 0) as never)}
      suffix={suffix}
      label={k}
    />
  );

  return (
    <Screen
      header={<AppHeader back code="CFG" title="Job queue" />}
      footer={
        changed.length ? (
          <View style={styles.footerWrap}>
            {problem ? (
              <Txt variant="small" color="warn">
                {problem}
              </Txt>
            ) : null}
            <View style={styles.footer}>
              <Button label="Discard" onPress={() => setDraft(saved)} style={styles.flex} />
              <Button
                label={`Save ${changed.length} change${changed.length === 1 ? '' : 's'}`}
                variant="primary"
                busy={busy === 'save'}
                disabled={!!problem}
                onPress={save}
                style={styles.flex}
              />
            </View>
          </View>
        ) : undefined
      }
    >
      <Card style={styles.card}>
        <SettingRow
          label="Skip tenders already in the queue"
          hint="Stops two sessions opening for the same tender ID"
          dirty={dirty('dedupe_by_tender_id')}
        >
          <Toggle
            value={draft.dedupe_by_tender_id}
            onChange={v => set('dedupe_by_tender_id', v)}
            label="Skip tenders already in the queue"
          />
        </SettingRow>
        <SettingRow label="Abandon a job after" dirty={dirty('job_ttl_minutes')} divider>
          {numField('job_ttl_minutes', 'min')}
        </SettingRow>
        <SettingRow label="Queue depth limit" dirty={dirty('max_queue_depth')} divider>
          {numField('max_queue_depth')}
        </SettingRow>
        <SettingRow
          label="Client poll interval"
          hint="How often the desktop app asks for job progress"
          dirty={dirty('poll_interval_ms')}
          divider
        >
          {numField('poll_interval_ms', 'ms')}
        </SettingRow>
        <SettingRow
          label="Daily tender archive"
          hint="Archive tenders 24h+ past their closing date, once per day"
          dirty={dirty('archive_daily_enabled')}
          divider
        >
          <Toggle
            value={draft.archive_daily_enabled}
            onChange={v => set('archive_daily_enabled', v)}
            label="Daily tender archive"
          />
        </SettingRow>
        <SettingRow
          label="Archive run time"
          hint="Hour of day (IST, 0–23) to run the daily archive sweep"
          dirty={dirty('archive_daily_hour')}
          divider
        >
          {numField('archive_daily_hour', ':00 IST')}
        </SettingRow>
      </Card>

      <Txt variant="label" style={styles.groupTitle}>
        Scheduler downtime (IST)
      </Txt>
      <Card style={styles.card}>
        <Txt variant="small" color="ink3" style={styles.note}>
          Between From and To no jobs run; a job due in that window runs at the To
          time. Leave both blank to run 24/7.
        </Txt>
        <SettingRow label="From" dirty={dirty('scheduler_downtime_from')}>
          <TextField
            compact
            mono
            value={draft.scheduler_downtime_from}
            onChangeText={v => set('scheduler_downtime_from', v.trim())}
            placeholder="HH:MM"
            label="Downtime from"
          />
        </SettingRow>
        <SettingRow label="To" dirty={dirty('scheduler_downtime_to')} divider>
          <TextField
            compact
            mono
            value={draft.scheduler_downtime_to}
            onChangeText={v => set('scheduler_downtime_to', v.trim())}
            placeholder="HH:MM"
            label="Downtime to"
          />
        </SettingRow>
        <SettingRow
          label="Pause on these days"
          hint="Paused all day, regardless of the window above. Also overrides the run days on saved jobs."
          dirty={dirty('scheduler_downtime_days')}
          stacked
          divider
        >
          <WeekdayPicker
            value={draft.scheduler_downtime_days}
            onChange={v => set('scheduler_downtime_days', v)}
          />
        </SettingRow>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { paddingVertical: 4 },
  groupTitle: { marginTop: 6, paddingHorizontal: 2 },
  note: { paddingTop: 10 },
  footerWrap: { gap: 8 },
  footer: { flexDirection: 'row', gap: 10 },
});
