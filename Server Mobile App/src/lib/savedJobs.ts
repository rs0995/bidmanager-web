import type { Api } from './api';
import { fmtDays, fmtEvery, fmtShortDateTime, fromSecs } from './format';
import type { SavedJob, SavedJobInput } from './types';

// Helpers for saved custom jobs, shared by the job card, the job page and the
// editor.

/** "9 Orgs" · "Entire website" · "4 Tenders" · "9 Orgs + 2 Tenders". */
export function scopeLabel(job: SavedJob): string {
  if (job.all_organizations) return 'Entire website';
  const parts: string[] = [];
  const o = job.org_ids.length;
  const t = job.tender_ids.length;
  if (o) parts.push(`${o} Org${o === 1 ? '' : 's'}`);
  if (t) parts.push(`${t} Tender${t === 1 ? '' : 's'}`);
  return parts.join(' + ') || 'Nothing selected';
}

/** "Every 4h · M Tu W Th F Sa" · "Once · 19 Oct 10:00" · "Manual". */
export function scheduleLabel(job: SavedJob): string {
  if (job.schedule_mode === 'once')
    return `Once · ${fmtShortDateTime(fromSecs(job.next_run_at || job.scheduled_for_at))}`;
  if (job.schedule_mode === 'interval')
    return `${fmtEvery(job.interval_minutes)} · ${fmtDays(job.run_days)}`;
  return 'Manual';
}

export const isPaused = (job: SavedJob) =>
  job.schedule_mode !== 'manual' && !job.schedule_enabled;

/**
 * Full PUT body for an existing job with some fields changed (e.g. its scope).
 * The server insists a scheduled time is in the future, so the job's upcoming
 * run is sent when there is one. For a repeating job with none, 0 lets the
 * server start it one interval from now. A one-off job whose time has passed
 * needs a new time first, and that returns an error message instead.
 */
export function jobToInput(
  job: SavedJob,
  overrides: Partial<SavedJobInput> = {},
  nowMs = Date.now(),
): SavedJobInput | { error: string } {
  const upcoming =
    job.next_run_at && job.next_run_at * 1000 > nowMs ? job.next_run_at : 0;
  if (job.schedule_mode === 'once' && !upcoming && !overrides.scheduled_for_at) {
    return {
      error:
        'This one-off run has already happened. Use Edit schedule to pick a new time or switch it to Manual.',
    };
  }
  return {
    owner_name: job.owner_name,
    name: job.name,
    website_id: job.website_id,
    job_type: job.job_type,
    org_ids: job.org_ids,
    tender_ids: job.tender_ids,
    all_organizations: job.all_organizations,
    download_mode: (['auto', 'full', 'update'].includes(job.download_mode)
      ? job.download_mode
      : 'auto') as SavedJobInput['download_mode'],
    schedule_enabled: job.schedule_mode !== 'manual',
    schedule_mode: job.schedule_mode,
    interval_minutes: job.schedule_mode === 'interval' ? job.interval_minutes : 0,
    scheduled_for_at: job.schedule_mode === 'manual' ? 0 : upcoming,
    run_days: job.schedule_mode === 'interval' ? job.run_days : undefined,
    ...overrides,
  };
}

/**
 * Saves a job and keeps a paused job paused. A PUT always switches a scheduled
 * job back on, so a job that was paused before is paused again afterwards.
 */
export async function saveJobKeepingPause(
  api: Api,
  input: SavedJobInput,
  id: number | undefined,
  wasPaused: boolean,
) {
  const saved = await api.saveJob(input, id);
  if (id && wasPaused && input.schedule_mode !== 'manual') {
    await api.setSavedJobSchedule(id, false);
  }
  return saved;
}
