import { jobToInput, saveJobKeepingPause } from '../src/lib/savedJobs';
import type { SavedJob } from '../src/lib/types';

const base: SavedJob = {
  id: 2, owner_name: 'Raksh', name: 'Sweep', website_id: 1, job_type: 'scrape',
  org_ids: [1, 2], tender_ids: [], all_organizations: false, download_mode: 'auto',
  schedule_enabled: true, schedule_mode: 'interval', interval_minutes: 360,
  scheduled_for_at: 0, next_run_at: 0, last_run_at: null, created_by: 'admin',
  run_days: ['mon'], created_at: 0,
};
const now = 2_000_000_000_000;

test('keeps an upcoming run, else sends 0 for a repeating job', () => {
  const ahead = jobToInput({ ...base, next_run_at: now / 1000 + 600 }, {}, now);
  expect('error' in ahead ? null : ahead.scheduled_for_at).toBe(now / 1000 + 600);
  const past = jobToInput({ ...base, next_run_at: now / 1000 - 600 }, { org_ids: [1] }, now);
  expect('error' in past ? null : [past.scheduled_for_at, past.org_ids]).toEqual([0, [1]]);
});

test('a finished one-off job asks for a new time', () => {
  const r = jobToInput({ ...base, schedule_mode: 'once', next_run_at: 0 }, {}, now);
  expect('error' in r).toBe(true);
});

test('a paused job is paused again after saving', async () => {
  const api = { saveJob: jest.fn(async () => ({ ok: true, id: 2 })), setSavedJobSchedule: jest.fn(async () => ({ enabled: false })) };
  const input = jobToInput({ ...base, schedule_enabled: false }, {}, now);
  if ('error' in input) throw new Error(input.error);
  await saveJobKeepingPause(api as never, input, 2, true);
  expect(api.setSavedJobSchedule).toHaveBeenCalledWith(2, false);
  await saveJobKeepingPause(api as never, input, 2, false);
  expect(api.setSavedJobSchedule).toHaveBeenCalledTimes(1);
});
