import { api, ServerTender } from './api';
import { addAlert, upsertOrgAlert } from './alerts';
import { getRaw, readJSON, setRaw, writeJSON } from './kv';
import {
  getBookmarks,
  getSettings,
  prebidReminderOn,
  setSettings,
} from './store';
import { getProjectsState, STATUS_ARCHIVED } from './sharedProjects';
import { parseFlexibleDate, prebidTime } from './serverTender';
import { startJob } from './documents';
import { queryClient } from './queryClient';

// What turns live data into Alerts. Ported from BM Pro's lib/sync.js (status / corrigendum
// snapshot + /client/changes) and lib/closingReminders.js, plus Bidwise's "Documents
// pending" nudge for project tenders about to close with unready checklist items.

const SNAPSHOT_KEY = 'bw.tenderSnapshot';
const CHANGES_KEY = 'bw.lastChangesAt';
const FIRED_KEY = 'bw.remindersFired';
export const ALERT_CHECK_KEYS = [SNAPSHOT_KEY, CHANGES_KEY, FIRED_KEY];

const PREP_WITHIN_DAYS = 3;

type Snap = {
  closing_date: string;
  status: string;
  prebid_count: number;
  corrigendum_count: number;
};

const title = (t: Partial<ServerTender> & { id: number }) =>
  t.title || t.tender_id || `Tender #${t.id}`;

/** Calendar days until close (0 = closes today, negative = closed). */
export function daysUntil(
  dateLike: string | null | undefined,
  now = new Date(),
): number | null {
  const d = parseFlexibleDate(dateLike);
  if (!d) return null;
  const a = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Tender ids the user follows: saved tenders plus tenders behind active projects. */
/** Bookmarked tenders plus the tenders behind active projects. */
export function followedIds(): number[] {
  const ids = new Set<number>(getBookmarks());
  getProjectsState()
    .projects.filter(p => p.status !== STATUS_ARCHIVED && p.source_tender_db_id)
    .forEach(p => ids.add(Number(p.source_tender_db_id)));
  return [...ids];
}

/** Status, corrigendum and pre-bid changes on followed tenders since the last check. */
async function checkSnapshot(tenders: ServerTender[]): Promise<number> {
  const prev = readJSON<Record<string, Snap>>(SNAPSHOT_KEY, {});
  const next: Record<string, Snap> = {};
  let count = 0;
  for (const t of tenders) {
    const cur: Snap = {
      closing_date: t.closing_date,
      status: t.status,
      prebid_count: Number(t.prebid_count) || 0,
      corrigendum_count: Number(t.corrigendum_count) || 0,
    };
    next[t.id] = cur;
    const old = prev[t.id];
    if (!old) continue; // first sighting: nothing to compare yet
    const id = String(t.id);
    if (old.status !== cur.status && cur.status) {
      count += 1;
      addAlert({
        kind: 'change',
        message: `“${title(t)}” is now ${cur.status}.`,
        tenderId: id,
      });
    }
    if (cur.corrigendum_count > old.corrigendum_count) {
      count += 1;
      addAlert({
        kind: 'change',
        message: `A new corrigendum was published for “${title(t)}”.`,
        tenderId: id,
      });
      // Fetch the new files so they're ready on the tender (as BM Pro does).
      if (!t.is_archived) startJob(t, 'update').catch(() => {});
    } else if (cur.prebid_count > old.prebid_count) {
      count += 1;
      addAlert({
        kind: 'change',
        message: `Pre-bid clarifications were added for “${title(t)}”.`,
        tenderId: id,
      });
    }
  }
  writeJSON(SNAPSHOT_KEY, next);
  return count;
}

/** Server-side changes since the last cursor: closing-date moves and new tenders. */
async function checkServerChanges(): Promise<number> {
  const since = Number(getRaw(CHANGES_KEY)) || 0;
  const res = await api.changes(since).catch(() => null);
  if (!res) return 0;
  // Reached the server and fetched what changed: that is a sync, whatever started it.
  setSettings({ lastSyncAt: new Date().toISOString() });
  let count = 0;
  if (since > 0) {
    for (const t of res.tenders ?? []) {
      if ((t.changed_fields ?? []).includes('closing_date')) {
        count += 1;
        addAlert({
          kind: 'change',
          message: `“${title(t)}” — closing date changed.`,
          tenderId: String(t.id),
        });
      }
    }
    // One alert per organisation: named up to 3 tenders, otherwise a count, and later
    // tenders join it while it is unread (lib/alerts.ts upsertOrgAlert).
    for (const [org, list] of Object.entries(res.new_by_org ?? {})) {
      if (!list?.length) continue;
      const added = upsertOrgAlert(
        org,
        list.map(t => ({
          id: String(t.id),
          title: t.title || t.tender_id || `Tender #${t.id}`,
        })),
      );
      if (added) count += 1;
    }
  }
  if (res.now) setRaw(CHANGES_KEY, String(res.now));
  return count;
}

/**
 * Closing reminders at the chosen days-before (Push notifications & Alerts screen), once
 * per tender and threshold; pre-bid meetings at the chosen times; and a "Documents pending" nudge for project tenders closing
 * within 3 days whose Ready for Bid checklist isn't complete (once per project per day).
 */
export function checkReminders(
  tenders: ServerTender[],
  now = new Date(),
): number {
  const fired = readJSON<Record<string, true>>(FIRED_KEY, {});
  const days = getSettings().reminderDays;
  const saved = getBookmarks();
  const byId = new Map(tenders.map(t => [t.id, t]));
  let count = 0;

  for (const t of tenders) {
    if (t.is_archived || !saved.has(t.id)) continue;
    const left = daysUntil(t.closing_date, now);
    if (left === null || left < 0) continue;
    for (const d of days) {
      const key = `closing:${t.id}:${d}`;
      if (left <= d && !fired[key]) {
        fired[key] = true;
        count += 1;
        addAlert({
          kind: 'deadline',
          message:
            left === 0
              ? `“${title(t)}” closes today.`
              : `“${title(t)}” closes in ${left} ${
                  left === 1 ? 'day' : 'days'
                }.`,
          tenderId: String(t.id),
        });
        break; // one reminder per check, for the nearest threshold crossed
      }
    }
  }

  // Pre-bid meetings switched on (or auto for bookmarks): the server pushes these at the
  // chosen times; this puts the same reminder in the Alerts tab, once per lead.
  const leads = [...getSettings().prebidLeads].sort((a, b) => a - b);
  for (const t of tenders) {
    if (t.is_archived || !leads.length) continue;
    if (!prebidReminderOn(t.tender_id, saved.has(t.id))) continue;
    const at = prebidTime(t.pre_bid_meeting_date);
    if (at === null || now.getTime() >= at) continue;
    const mins = (at - now.getTime()) / 60_000;
    const lead = leads.find(l => mins <= l);
    if (lead === undefined) continue;
    const key = `prebid:${t.tender_id}:${lead}:${at}`;
    if (fired[key]) continue;
    // The nearest time crossed stands for the earlier ones too.
    for (const l of leads)
      if (l >= lead) fired[`prebid:${t.tender_id}:${l}:${at}`] = true;
    count += 1;
    addAlert({
      kind: 'deadline',
      message: `Pre-bid meeting for “${title(t)}” in ${prebidIn(mins)}.`,
      tenderId: String(t.id),
    });
  }

  const { projects, checklist } = getProjectsState();
  for (const p of projects) {
    if (p.status !== 'Active' || !p.source_tender_db_id) continue;
    const t = byId.get(Number(p.source_tender_db_id));
    const left = daysUntil(t?.closing_date ?? p.deadline, now);
    if (left === null || left < 0 || left > PREP_WITHIN_DAYS) continue;
    const pending = checklist.filter(
      r => r.project_id === p.id && r.status !== 'Completed',
    );
    if (!pending.length) continue;
    const key = `prep:${p.id}:${now.toDateString()}`;
    if (fired[key]) continue;
    fired[key] = true;
    count += 1;
    const names = pending
      .slice(0, 2)
      .map(r => r.req_file_name)
      .join(' and ');
    addAlert({
      kind: 'prep',
      message: `${p.title} needs ${pending.length} ${
        pending.length === 1 ? 'document' : 'documents'
      }: ${names}${pending.length > 2 ? ' and more' : ''} still pending.`,
      projectId: String(p.id),
    });
  }

  writeJSON(FIRED_KEY, fired);
  return count;
}

/** "45 minutes", "2 hours", "1 day" until a pre-bid meeting. */
export function prebidIn(mins: number) {
  if (mins < 60) return `${Math.max(1, Math.round(mins))} minutes`;
  if (mins < 1440) {
    const h = Math.round(mins / 60);
    return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  }
  const d = Math.round(mins / 1440);
  return `${d} ${d === 1 ? 'day' : 'days'}`;
}

let inFlight: Promise<number> | null = null;

/** Runs every check once; concurrent callers share the same run. Resolves new alerts. */
export function checkForAlerts(): Promise<number> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    // Always fresh (changes are what we look for), 4 at a time, written to the same
    // ['tender', id] cache entries the Dashboard and Projects read.
    const tenders: ServerTender[] = [];
    const ids = followedIds();
    for (let i = 0; i < ids.length; i += 4) {
      const batch = await Promise.all(
        ids.slice(i, i + 4).map(
          id =>
            queryClient
              .fetchQuery({
                queryKey: ['tender', String(id)],
                queryFn: () => api.tender(id),
                staleTime: 0,
              })
              .catch(() => null), // gone from the server or offline: skip it
        ),
      );
      batch.forEach(t => t && tenders.push(t));
    }
    let count = await checkSnapshot(tenders);
    count += await checkServerChanges();
    count += checkReminders(tenders);
    return count;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
