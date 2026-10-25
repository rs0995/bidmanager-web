import { __resetKV } from '../src/lib/kv';
import { setSession } from '../src/lib/auth';
import {
  addAlert,
  newTendersMessage,
  unreadOrgs,
  upsertOrgAlert,
  alertTime,
  getAlerts,
  markAllRead,
  markRead,
  markReadForPush,
  rehydrateAlerts,
  unreadCount,
} from '../src/lib/alerts';
import { checkForAlerts, daysUntil } from '../src/lib/alertChecks';
import { docDate } from '../src/data/docs';
import {
  getSettings,
  rehydrateStore,
  setBookmarks,
  setSettings,
} from '../src/lib/store';
import { syncTime } from '../src/data/actions';
import {
  addChecklistItem,
  attachToItem,
  createProjectFromTender,
  rehydrateProjects,
  setChecklistStatus,
} from '../src/lib/sharedProjects';
import { rehydrateDocuments } from '../src/lib/documents';
import {
  disableAppLock,
  enableAppLock,
  isAppLockEnabled,
} from '../src/lib/appLock';
import type { ServerTender } from '../src/lib/api';

jest.mock('../src/platform/files', () => ({
  files: {
    abs: (rel: string) => `/Docs/${rel}`,
    download: jest.fn(async () => 100),
    exists: jest.fn(async () => true),
    remove: jest.fn(async () => {}),
    copy: jest.fn(async () => {}),
  },
}));

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const tender = (id: number, over: Partial<ServerTender> = {}) =>
  ({
    id,
    tender_id: `T${id}`,
    title: `Tender ${id}`,
    organization: 'PWD',
    website_name: 'Mahatenders',
    closing_date: iso(Date.now() + 20 * DAY),
    status: 'Open',
    prebid_count: 0,
    corrigendum_count: 0,
    is_archived: false,
    ...over,
  } as ServerTender);

const fetchMock = jest.fn();
const ok = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: async () => body });
let server: Record<number, ServerTender> = {};
let changes: unknown = { now: 100, tenders: [], new_by_org: {} };

beforeEach(() => {
  __resetKV();
  rehydrateStore();
  rehydrateProjects();
  rehydrateAlerts();
  rehydrateDocuments();
  server = {};
  changes = { now: 100, tenders: [], new_by_org: {} };
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    if (path === '/client/changes') return ok(changes);
    const m = /^\/client\/tenders\/(\d+)$/.exec(path);
    if (m) return ok(server[Number(m[1])]);
    if (path.endsWith('/request-download')) return ok({ job_id: 'j' });
    if (path.endsWith('/download-status')) return ok({ status: 'running' });
    return ok({});
  });
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  setSession({ token: 'tok', user_id: 1, email: 'a@b.c' });
  (globalThis as { __faceIdPass?: boolean }).__faceIdPass = true;
});

describe('feed', () => {
  it('labels times so the Alerts tab groups Today and Earlier', () => {
    const now = new Date(2026, 9, 16, 15, 0);
    expect(alertTime(new Date(2026, 9, 16, 14, 48).toISOString(), now)).toBe(
      '12 min ago',
    );
    expect(alertTime(new Date(2026, 9, 16, 11, 0).toISOString(), now)).toBe(
      '4 hours ago',
    );
    expect(alertTime(new Date(2026, 9, 15, 23, 0).toISOString(), now)).toBe(
      'Yesterday',
    );
    expect(alertTime(new Date(2026, 7, 22, 9, 0).toISOString(), now)).toBe(
      '22-Aug',
    );
  });

  it('counts unread and marks read', () => {
    const a = addAlert({ kind: 'change', message: 'x' });
    addAlert({ kind: 'new', message: 'y' });
    expect(unreadCount()).toBe(2);
    markRead(a.id);
    expect(unreadCount()).toBe(1);
    markAllRead();
    expect(unreadCount()).toBe(0);
  });
});

describe('checks', () => {
  it('says nothing on first sight, then reports status and corrigendum changes', async () => {
    setBookmarks([1]);
    server[1] = tender(1);
    expect(await checkForAlerts()).toBe(0);

    server[1] = tender(1, {
      status: 'Technical evaluation',
      corrigendum_count: 1,
    });
    expect(await checkForAlerts()).toBe(2);
    const messages = getAlerts().map(a => a.message);
    expect(messages).toContain('“Tender 1” is now Technical evaluation.');
    expect(messages).toContain(
      'A new corrigendum was published for “Tender 1”.',
    );
    // The new corrigendum files are fetched from the portal.
    expect(
      fetchMock.mock.calls.some(c =>
        String(c[0]).includes('/tenders/1/request-download'),
      ),
    ).toBe(true);
  });

  it('turns server changes into closing-date and new-tender alerts (after the first cursor)', async () => {
    expect(await checkForAlerts()).toBe(0); // since=0 only sets the cursor
    changes = {
      now: 200,
      tenders: [{ id: 7, title: 'Bridge', changed_fields: ['closing_date'] }],
      new_by_org: {
        PWD: [{ id: 8, title: 'Road' }],
        MJP: Array.from({ length: 12 }, (_, i) => ({ id: 100 + i })),
      },
    };
    expect(await checkForAlerts()).toBe(3);
    const a = getAlerts();
    expect(
      a.find(x => x.kind === 'new' && x.orgName === 'MJP')?.newTenderIds,
    ).toHaveLength(12);
    expect(a.find(x => x.tenderId === '8')?.message).toBe(
      '“Road” was added under PWD.',
    );
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('since=100');
  });

  it('fires a closing reminder once per threshold', async () => {
    setBookmarks([3]);
    setSettings({ reminderDays: [1, 3] });
    // Midday two calendar days ahead, so the test doesn't depend on the time it runs.
    const closes = new Date();
    closes.setDate(closes.getDate() + 2);
    closes.setHours(12, 0, 0, 0);
    server[3] = tender(3, { closing_date: closes.toISOString() });
    expect(daysUntil(server[3].closing_date)).toBe(2);
    await checkForAlerts();
    await checkForAlerts();
    const reminders = getAlerts().filter(a => a.kind === 'deadline');
    expect(reminders).toHaveLength(1);
    expect(reminders[0].message).toBe('“Tender 3” closes in 2 days.');
  });

  it('nudges about pending documents on a project closing within 3 days', async () => {
    const t = tender(4, { closing_date: iso(Date.now() + DAY + 3_600_000) });
    server[4] = t;
    const p = createProjectFromTender(t);
    addChecklistItem(p.id, 'EMD bank guarantee');
    await checkForAlerts();
    await checkForAlerts();
    const prep = getAlerts().filter(a => a.kind === 'prep');
    expect(prep).toHaveLength(1);
    expect(prep[0].message).toContain('needs 1 document: EMD bank guarantee');
    expect(prep[0].projectId).toBe(String(p.id));
  });
});

it('raises "100% ready" when the last checklist item is done', async () => {
  const p = createProjectFromTender(tender(5));
  const a = addChecklistItem(p.id, 'A');
  const b = addChecklistItem(p.id, 'B');
  setChecklistStatus(a.id, 'Completed');
  expect(getAlerts()).toHaveLength(0);
  await attachToItem(b.id, { name: 'b.pdf', uri: 'file:///b.pdf' });
  expect(getAlerts()[0].message).toBe('“Tender 5” is 100% ready for bid.');
});

describe('app lock', () => {
  it('turns on only after Face ID passes, and needs it again to turn off', async () => {
    await enableAppLock();
    expect(isAppLockEnabled()).toBe(true);
    (globalThis as { __faceIdPass?: boolean }).__faceIdPass = false;
    await expect(disableAppLock()).rejects.toThrow('still on');
    expect(isAppLockEnabled()).toBe(true);
    (globalThis as { __faceIdPass?: boolean }).__faceIdPass = true;
    await disableAppLock();
    expect(isAppLockEnabled()).toBe(false);
  });

  it('stays off when Face ID is cancelled while turning it on', async () => {
    (globalThis as { __faceIdPass?: boolean }).__faceIdPass = false;
    await expect(enableAppLock()).rejects.toThrow('wasn’t turned on');
    expect(isAppLockEnabled()).toBe(false);
  });
});

describe('opening a notification', () => {
  it('marks the alerts it was about as read, and only those', () => {
    addAlert({ kind: 'change', message: 'Fee changed', tenderId: '7' });
    addAlert({ kind: 'deadline', message: 'Closes tomorrow', tenderId: '7' });
    addAlert({ kind: 'download', message: 'Saved', tenderId: '8' });
    upsertOrgAlert('PWD', [{ id: '9', title: 'Road' }]);
    upsertOrgAlert('MJP', [{ id: '10', title: 'Pipe' }]);
    expect(unreadCount()).toBe(5);

    expect(markReadForPush({ thread: 'tender', tenderId: 7 })).toBe(1);
    expect(markReadForPush({ thread: 'download', tenderId: '8' })).toBe(1);
    expect(markReadForPush({ thread: 'org', orgName: 'PWD' })).toBe(1);
    const unread = getAlerts().filter(a => !a.read);
    expect(unread.map(a => a.kind).sort()).toEqual(['deadline', 'new']);
    expect(unread.find(a => a.kind === 'new')?.orgName).toBe('MJP');
    // Not built yet: nothing to mark, so the app syncs and tries again.
    expect(markReadForPush({ thread: 'closing', tenderId: '99' })).toBe(0);
    expect(markReadForPush({ thread: 'captcha' })).toBe(0);
  });
});

describe('new tenders under an organisation', () => {
  const items = (n: number, from = 1) =>
    Array.from({ length: n }, (_, i) => ({
      id: String(from + i),
      title: `Job ${from + i}`,
    }));

  it('names up to 3 tenders, and counts above that', () => {
    expect(newTendersMessage('PWD', items(1))).toBe(
      '“Job 1” was added under PWD.',
    );
    expect(newTendersMessage('PWD', items(3))).toBe(
      '“Job 1”, “Job 2” and “Job 3” were added under PWD.',
    );
    expect(newTendersMessage('PWD', items(4))).toBe(
      '4 new tenders were added under PWD.',
    );
  });

  it('groups later tenders into the unread alert: one alert, one badge', () => {
    expect(upsertOrgAlert('PWD', items(2))).toBe(true);
    expect(upsertOrgAlert('PWD', items(3, 3))).toBe(false); // joins the unread one
    const pwd = getAlerts().filter(a => a.orgName === 'PWD');
    expect(pwd).toHaveLength(1);
    expect(pwd[0].message).toBe('5 new tenders were added under PWD.');
    expect(pwd[0].newTenderIds).toEqual(['1', '2', '3', '4', '5']);
    expect(pwd[0].tenderId).toBeUndefined();
    expect(unreadCount()).toBe(1);
    expect(unreadOrgs()).toEqual(['PWD']);
  });

  it('a tender seen again does not change the alert', () => {
    upsertOrgAlert('PWD', items(1));
    upsertOrgAlert('PWD', items(1));
    const [a] = getAlerts();
    expect(a.message).toBe('“Job 1” was added under PWD.');
    expect(a.tenderId).toBe('1'); // a single tender opens it directly
  });

  it('starts a new alert once the earlier one has been read', () => {
    upsertOrgAlert('PWD', items(1));
    markRead(getAlerts()[0].id);
    expect(upsertOrgAlert('PWD', items(1, 2))).toBe(true);
    const pwd = getAlerts().filter(a => a.orgName === 'PWD');
    expect(pwd).toHaveLength(2);
    expect(pwd[0].message).toBe('“Job 2” was added under PWD.');
    expect(unreadOrgs()).toEqual(['PWD']);
  });

  it('keeps organisations apart', () => {
    upsertOrgAlert('PWD', items(1));
    upsertOrgAlert('MJP', items(1, 9));
    expect(unreadCount()).toBe(2);
    expect(unreadOrgs().sort()).toEqual(['MJP', 'PWD']);
  });
});

describe('document dates', () => {
  it('shows the day the server picked the file up, as BM Pro', () => {
    expect(docDate('2026-09-08T10:15:00')).toBe('08 Sep 2026');
    expect(docDate('')).toBe('');
    expect(docDate(null)).toBe('');
  });
});

describe('last synced', () => {
  it('is recorded whenever a check reaches the server, not only on Sync now', async () => {
    expect(getSettings().lastSyncAt).toBeNull();
    await checkForAlerts(); // the automatic check (launch, foreground, notification)
    expect(getSettings().lastSyncAt).not.toBeNull();
  });

  it('is left alone when the server could not be reached', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));
    await checkForAlerts();
    expect(getSettings().lastSyncAt).toBeNull();
  });

  it('reads like BM Pro: "22 Oct, 10:52 am"', () => {
    expect(syncTime(new Date(2026, 9, 22, 10, 52).getTime())).toBe(
      '22 Oct, 10:52 am',
    );
    expect(syncTime(new Date(2026, 9, 22, 15, 5).getTime())).toBe(
      '22 Oct, 3:05 pm',
    );
    expect(syncTime(null)).toBe('never');
  });
});
