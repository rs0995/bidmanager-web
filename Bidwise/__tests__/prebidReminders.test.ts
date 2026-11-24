import { __resetKV, writeJSON } from '../src/lib/kv';
import {
  getPrebidOff,
  getPrebidOn,
  prebidReminderOn,
  rehydrateStore,
  setBookmarks,
  setPrebidLists,
  setPrebidReminder,
  setSettings,
  tenderKey,
} from '../src/lib/store';
import { applyServerNotificationPrefs, buildPushBody } from '../src/lib/sync';
import { checkReminders, prebidIn } from '../src/lib/alertChecks';
import { getAlerts, rehydrateAlerts } from '../src/lib/alerts';
import { prebidTime } from '../src/lib/serverTender';
import { prebidSummary } from '../src/app/screens/NotificationSettingsScreen';
import type { ServerTender } from '../src/lib/api';

// Pre-bid meeting reminders: a per-tender switch (by portal tender ID, shared with the
// organisation through the sync blob) and the lead times in the push preferences.

beforeEach(() => {
  __resetKV();
  rehydrateStore();
  rehydrateAlerts();
});

describe('the per-tender switch', () => {
  it('is off by default, and auto-on only for bookmarked tenders', () => {
    expect(prebidReminderOn('PWD/2026/1', true)).toBe(false);
    setSettings({ prebidAutoBookmarked: true });
    expect(prebidReminderOn('PWD/2026/1', true)).toBe(true);
    expect(prebidReminderOn('PWD/2026/1', false)).toBe(false);
  });

  it('switched by hand beats auto, either way', () => {
    setSettings({ prebidAutoBookmarked: true });
    setPrebidReminder('PWD/2026/1', false);
    expect(prebidReminderOn('PWD/2026/1', true)).toBe(false);
    setPrebidReminder('PWD/2026/1', true);
    expect(prebidReminderOn('PWD/2026/1', false)).toBe(true);
    expect(getPrebidOff().size).toBe(0);
  });

  it('keys by portal tender ID as the server stores it', () => {
    expect(tenderKey('  2026_dtedm_1350593_1 ')).toBe('2026_DTEDM_1350593_1');
    setPrebidReminder('2026_dtedm  1', true);
    expect([...getPrebidOn()]).toEqual(['2026_DTEDM 1']);
    expect(prebidReminderOn('2026_DTEDM 1', false)).toBe(true);
  });
});

describe('sync', () => {
  it('sends the switch lists, and what was dropped since the last pull', () => {
    setPrebidReminder('T/1', true);
    setPrebidReminder('T/2', false);
    let body = buildPushBody();
    expect(body.data.prebidReminderIds).toEqual(['T/1']);
    expect(body.data.prebidReminderOffIds).toEqual(['T/2']);
    // After a pull that had T/1 on, switching it off sends it as removed.
    writeJSON('bw.syncBlob', {
      prebidReminderIds: ['T/1'],
    });
    setPrebidReminder('T/1', false);
    body = buildPushBody();
    expect(body.removed.prebidReminderIds).toEqual(['T/1']);
    expect(body.data.prebidReminderOffIds).toEqual(
      expect.arrayContaining(['T/1', 'T/2']),
    );
  });

  it('sends and applies the lead times with the push preferences', () => {
    setSettings({
      prebidLeads: [120, 60],
      prebidAutoBookmarked: true,
      notificationPrefsUpdatedAt: 5,
    });
    const prefs = buildPushBody().data.notificationPrefs!;
    expect(prefs.prebidLeads).toEqual([120, 60]);
    expect(prefs.prebidAutoBookmarked).toBe(true);
    applyServerNotificationPrefs({
      notifyOrgAlertsOn: false,
      notifyTenderAlertsOn: false,
      reminderDays: [],
      prebidLeads: [1440],
      prebidAutoBookmarked: false,
      updatedAt: 9,
    });
    const after = buildPushBody().data.notificationPrefs!;
    expect(after.prebidLeads).toEqual([1440]);
    expect(after.prebidAutoBookmarked).toBe(false);
  });

  it('keeps this phone’s pre-bid choice when the server copy predates it (BM Pro)', () => {
    setSettings({ prebidLeads: [60], notificationPrefsUpdatedAt: 1 });
    applyServerNotificationPrefs({
      notifyOrgAlertsOn: true,
      notifyTenderAlertsOn: false,
      reminderDays: [],
      updatedAt: 2,
    });
    expect(buildPushBody().data.notificationPrefs!.prebidLeads).toEqual([60]);
  });

  it('takes the organisation’s switches from a pull', () => {
    setPrebidLists(['a/1'], ['b/2']);
    expect(prebidReminderOn('A/1', false)).toBe(true);
    expect([...getPrebidOff()]).toEqual(['B/2']);
  });
});

describe('meeting time and labels', () => {
  it('needs a time of day', () => {
    expect(prebidTime('20-Sep-2026 11:30 AM')).not.toBeNull();
    expect(prebidTime('20-Sep-2026')).toBeNull();
    expect(prebidTime('NA')).toBeNull();
    expect(prebidTime(null)).toBeNull();
  });

  it('summarises the chosen times', () => {
    expect(prebidSummary([])).toBe('Off');
    expect(prebidSummary([120])).toBe('2 h before');
    expect(prebidSummary([120, 1440])).toBe('1 day and 2 h before');
    expect(prebidSummary([60, 240, 1440])).toBe('1 day, 4 h and 1 h before');
    expect(prebidIn(45)).toBe('45 minutes');
    expect(prebidIn(120)).toBe('2 hours');
    expect(prebidIn(1440)).toBe('1 day');
  });
});

describe('Alerts tab', () => {
  const meeting = new Date(2026, 9, 20, 15, 0);
  const tender = {
    id: 7,
    tender_id: 'PWD/7',
    title: 'Road works',
    is_archived: 0,
    closing_date: '2026-10-30 15:00',
    pre_bid_meeting_date: '2026-10-20 15:00',
  } as unknown as ServerTender;

  it('adds one alert for the nearest time crossed, then not again', () => {
    setBookmarks([7]);
    setPrebidReminder('PWD/7', true);
    setSettings({ prebidLeads: [1440, 120, 60] });
    // 90 minutes before: the 2 h time is the nearest crossed (1 day counts as done).
    const at = new Date(meeting.getTime() - 90 * 60_000);
    checkReminders([tender], at);
    const prebid = getAlerts().filter(a => /Pre-bid/.test(a.message));
    expect(prebid.map(a => a.message)).toEqual([
      'Pre-bid meeting for “Road works” in 2 hours.',
    ]);
    checkReminders([tender], new Date(at.getTime() + 60_000));
    expect(getAlerts().filter(a => /Pre-bid/.test(a.message))).toHaveLength(1);
    // 1 h before is a new time.
    checkReminders([tender], new Date(meeting.getTime() - 50 * 60_000));
    expect(getAlerts().filter(a => /Pre-bid/.test(a.message))).toHaveLength(2);
  });

  it('says nothing for a tender that isn’t switched on', () => {
    setBookmarks([7]);
    checkReminders([tender], new Date(meeting.getTime() - 30 * 60_000));
    expect(getAlerts().some(a => /Pre-bid/.test(a.message))).toBe(false);
  });
});
