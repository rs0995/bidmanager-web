import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ChevronRight, Pause, Play, Trash2 } from 'lucide-react-native';
import { fmtAgo, fmtShortDateTime, fromSecs } from '../lib/format';
import { isPaused, scheduleLabel, scopeLabel } from '../lib/savedJobs';
import type { SavedJob } from '../lib/types';
import { fonts, useTheme } from '../theme';
import { Button, IconButton, StatusPill, Txt } from './ui';

type Props = {
  job: SavedJob;
  /** Tap on the card body: opens the job page. Omit on the job page itself. */
  onOpen?: () => void;
  onRun: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
  running?: boolean;
  toggling?: boolean;
};

/** Name / type line, scope · schedule line, last / next line. Used by the job page too. */
export function JobSummary({ job, chevron }: { job: SavedJob; chevron?: boolean }) {
  const t = useTheme();
  const paused = isPaused(job);
  return (
    <View style={styles.summary}>
      <View style={styles.titleRow}>
        <Txt style={[styles.name, { color: t.colors.ink }]} numberOfLines={1}>
          {job.name}
        </Txt>
        <StatusPill
          tone={job.job_type === 'scrape' ? 'info' : 'neutral'}
          label={job.job_type}
        />
        {paused ? <StatusPill tone="warn" label="paused" /> : null}
        {chevron ? <ChevronRight size={18} color={t.colors.ink3} /> : null}
      </View>
      <Txt variant="bodyStrong" numberOfLines={2}>
        {scopeLabel(job)}
        <Txt color="ink3">{'  ·  '}</Txt>
        {scheduleLabel(job)}
      </Txt>
      <View style={styles.runRow}>
        <Txt variant="monoSmall" color="ink2">
          {job.last_run_at ? `Last ${fmtAgo(fromSecs(job.last_run_at))}` : 'Never run'}
        </Txt>
        {job.schedule_mode === 'manual' ? null : paused ? (
          <Txt variant="monoSmall" color="warn">
            Next: Paused
          </Txt>
        ) : (
          <Txt variant="monoSmall" color="ink2">
            Next {fmtShortDateTime(fromSecs(job.next_run_at))}
          </Txt>
        )}
      </View>
    </View>
  );
}

// One saved job (desktop square-and-ruled style): the summary on top, then an
// action bar with Run once, Pause/Resume and a red icon-only delete.
export function JobCard({
  job,
  onOpen,
  onRun,
  onTogglePause,
  onDelete,
  running,
  toggling,
}: Props) {
  const t = useTheme();
  const paused = isPaused(job);
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.colors.surface, borderColor: t.colors.hair },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${job.name}`}
        onPress={onOpen}
        disabled={!onOpen}
        style={({ pressed }) => pressed && { backgroundColor: t.colors.raised }}
      >
        <JobSummary job={job} chevron={!!onOpen} />
      </Pressable>
      <View
        style={[
          styles.actions,
          { backgroundColor: t.colors.raised, borderTopColor: t.colors.hairSoft },
        ]}
      >
        <Button
          label="Run once"
          icon={Play}
          size="sm"
          variant="primary"
          busy={running}
          onPress={onRun}
        />
        {job.schedule_mode !== 'manual' ? (
          <Button
            label={paused ? 'Resume' : 'Pause'}
            icon={paused ? Play : Pause}
            size="sm"
            busy={toggling}
            onPress={onTogglePause}
          />
        ) : null}
        <View style={styles.flex} />
        <IconButton icon={Trash2} label={`Delete ${job.name}`} tone="danger" onPress={onDelete} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderWidth: 1 },
  summary: { padding: 14, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontFamily: fonts.cond, fontSize: 17 },
  runRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
});
