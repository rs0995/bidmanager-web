import { __resetKV } from '../src/lib/kv';
import { clearSession, getToken, setSession } from '../src/lib/auth';
import { AuthError, errorMessage, request } from '../src/lib/http';
import { parseCrores, splitValue } from '../src/lib/format';
import {
  countdown,
  fmtINR,
  formatDateTime,
  parseFlexibleDate,
  toTender,
} from '../src/lib/serverTender';
import {
  addChecklistItem,
  attachToItem,
  createProjectFromTender,
  getProjectsState,
  mergeFromServer,
  READY_SUBFOLDER,
  rehydrateProjects,
} from '../src/lib/sharedProjects';
import { buildPushBody, pull } from '../src/lib/sync';
import {
  getBookmarks,
  rehydrateStore,
  setBookmarks,
  setBookmarkedOrgs,
} from '../src/lib/store';
import { toProject } from '../src/live/LiveProviders';
import type { ServerTender } from '../src/lib/api';

jest.mock('../src/platform/files', () => {
  const present = new Set<string>();
  return {
    files: {
      abs: (rel: string) => `/Docs/${rel}`,
      copy: jest.fn(async (_src: string, dest: string) => {
        present.add(dest);
      }),
      remove: jest.fn(async (p: string) => {
        [...present].filter(x => x.startsWith(p)).forEach(x => present.delete(x));
      }),
      exists: jest.fn(async (p: string) => present.has(p)),
      open: jest.fn(async () => {}),
    },
  };
});

const serverTender = (over: Partial<ServerTender> = {}): ServerTender => ({
  id: 42,
  website_id: 1,
  website_name: 'Mahatenders',
  website_url: 'https://mahatenders.gov.in',
  organization: 'PWD Konkan',
  tender_id: '2026_PWD_1_1',
  title: 'Widening of Panvel–Uran road including CD works and drainage',
  work_description: 'Widening and strengthening',
  tender_value: '42800000',
  emd: '428000',
  closing_date: '2026-09-08T15:00:00',
  opening_date: '',
  published_date: '2026-08-20',
  pre_bid_meeting_date: '',
  location: 'Raigad',
  category: 'Civil works',
  status: 'Open',
  is_archived: false,
  has_documents: true,
  document_count: 3,
  prebid_count: 0,
  corrigendum_count: 1,
  last_update_checked_at: null,
  last_status_checked_at: null,
  tender_url: 'https://mahatenders.gov.in/t/42',
  ...over,
});

const fetchMock = jest.fn();
beforeEach(() => {
  __resetKV();
  rehydrateStore();
  rehydrateProjects();
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

const respond = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body });

describe('dates and values', () => {
  it('parses ISO and portal text (Hermes-safe month lookup)', () => {
    expect(parseFlexibleDate('08-Sep-2026 03:00 PM')?.getHours()).toBe(15);
    expect(parseFlexibleDate('08-Sep-2026 03:00 PM')?.getMonth()).toBe(8);
    expect(parseFlexibleDate('')).toBeNull();
    expect(parseFlexibleDate('not a date')).toBeNull();
    // Space-separated ISO (Hermes rejects it) reads as local time.
    const spaced = parseFlexibleDate('2026-10-25 15:00');
    expect([spaced?.getMonth(), spaced?.getDate(), spaced?.getHours()]).toEqual([9, 25, 15]);
    // Day-first Indian dates, not month-first.
    const dmy = parseFlexibleDate('05/11/2026 3:00 PM');
    expect([dmy?.getMonth(), dmy?.getDate(), dmy?.getHours()]).toEqual([10, 5, 15]);
    expect(parseFlexibleDate('25-10-2026')?.getMonth()).toBe(9);
    expect(formatDateTime('08-Sep-2026 03:00 PM')).toBe('08 Sep 2026, 3:00 PM');
    expect(formatDateTime('2026-09-08T00:00:00')).toBe('08 Sep 2026');
  });

  it('counts down in the dashboard format with Critical / Soon / ok', () => {
    const now = new Date(2026, 8, 1, 12, 0).getTime();
    const at = (h: number) => new Date(now + h * 3_600_000);
    expect(countdown(at(6), now)).toEqual({ closeIn: '6h', state: 'crit' });
    expect(countdown(at(52), now)).toEqual({ closeIn: '2d 4h', state: 'soon' });
    expect(countdown(at(5 * 24), now)).toEqual({ closeIn: '5d', state: 'soon' });
    expect(countdown(at(8 * 24), now)).toEqual({ closeIn: '8d', state: 'ok' });
    expect(countdown(at(-2), now).closeIn).toBe('Closed');
    expect(countdown(null, now).closeIn).toBe('—');
  });

  it('formats rupees as Cr / L and reads them back in crores', () => {
    expect(fmtINR('42800000')).toBe('₹4.28 Cr');
    expect(fmtINR('864000')).toBe('₹8.6 L');
    expect(fmtINR('')).toBe('—');
    expect(parseCrores('₹42.80 Cr')).toBe(42.8);
    expect(parseCrores('₹86.4 L')).toBeCloseTo(0.864);
    expect(parseCrores('₹9,50,000')).toBeCloseTo(0.095);
    expect(splitValue('₹42.80 Cr')).toEqual({ amount: '₹42.80', unit: 'Cr' });
    expect(splitValue('₹8.6 L')).toEqual({ amount: '₹8.6', unit: 'L' });
  });

  it('maps a server tender onto the Bidwise Tender shape', () => {
    const now = new Date('2026-09-01T12:00:00').getTime();
    const t = toTender(serverTender(), now);
    expect(t.id).toBe('42');
    expect(t.refId).toBe('2026_PWD_1_1');
    expect(t.portal).toBe('Mahatenders');
    expect(t.org).toBe('PWD Konkan');
    expect(t.value).toBe('₹4.28 Cr');
    expect(t.closeIn).toBe('7d');
    expect(t.state).toBe('ok');
    expect(t.url).toBe('https://mahatenders.gov.in/t/42');
    expect(t.short.length).toBeLessThanOrEqual(57);
  });
});

describe('http', () => {
  it('only allows /client/* routes and needs a token', async () => {
    await expect(request('/admin/x')).rejects.toThrow('Only /client/*');
    clearSession();
    await expect(request('/client/stats')).rejects.toBeInstanceOf(AuthError);
  });

  it('sends the token and turns 401 into AuthError', async () => {
    setSession({ token: 'tok', user_id: 1, email: 'a@b.c' });
    fetchMock.mockReturnValueOnce(respond(401, { detail: 'Sign in again.' }));
    await expect(request('/client/stats')).rejects.toBeInstanceOf(AuthError);
    expect(fetchMock.mock.calls[0][1].headers['x-client-key']).toBe('tok');
    fetchMock.mockReturnValueOnce(respond(500, { detail: 'Boom' }));
    await expect(request('/client/stats')).rejects.toThrow('Boom');
    expect(errorMessage([{ msg: 'a' }, { type: 'b' }], 422)).toBe('a; b');
    expect(errorMessage(undefined, 502)).toBe('Request failed (HTTP 502).');
    expect(getToken()).toBe('tok');
  });
});

describe('shared projects (desktop / BM Pro format)', () => {
  it('creates rows with exactly the shared fields', async () => {
    const p = createProjectFromTender(serverTender());
    expect(Object.keys(p).sort()).toEqual(
      [
        'client_name',
        'deadline',
        'description',
        'emd',
        'id',
        'prebid',
        'project_value',
        'source_tender_db_id',
        'source_tender_id',
        'status',
        'title',
      ].sort(),
    );
    expect(p.status).toBe('Active');
    const item = addChecklistItem(p.id, 'Technical proposal');
    expect(item.subfolder).toBe(READY_SUBFOLDER);
    expect(item.status).toBe('Pending');
    await attachToItem(item.id, { name: 'tp.pdf', uri: 'file:///tp.pdf', size: 10 });
    const row = getProjectsState().checklist[0];
    expect(row.status).toBe('Completed');
    expect(row.attachment?.name).toBe('tp.pdf');
  });

  it('keeps this device’s attachments when the server copy arrives', async () => {
    const p = createProjectFromTender(serverTender());
    const item = addChecklistItem(p.id, 'EMD');
    await attachToItem(item.id, { name: 'bg.pdf', uri: 'file:///bg.pdf' });
    mergeFromServer(getProjectsState().projects, [
      { ...getProjectsState().checklist[0], attachment: null },
    ]);
    expect(getProjectsState().checklist[0].attachment?.name).toBe('bg.pdf');
  });

  it('shows shared rows the Bidwise way', () => {
    const p = createProjectFromTender(serverTender());
    addChecklistItem(p.id, 'Company registration');
    const view = toProject(
      { ...p, status: 'Submitted' },
      getProjectsState().checklist,
      [{ id: 'x', name: 'Cost.xlsx', size: 2048 }],
      new Date('2026-09-01T12:00:00').getTime(),
    );
    expect(view.status).toBe('Submitted');
    expect(view.sourceTenderId).toBe('42');
    expect(view.checklist[0].name).toBe('Ready for Bid');
    expect(view.checklist[0].items[0].name).toBe('Company registration');
    expect(view.prepDocs[0].meta).toBe('2 KB · Added by you');
  });
});

describe('sync blob', () => {
  it('pushes local state plus what was removed since the last pull', async () => {
    setSession({ token: 'tok', user_id: 1, email: 'a@b.c' });
    fetchMock.mockReturnValueOnce(
      respond(200, {
        data: { bookmarks: [1, 2, 3], bookmarkedOrgs: ['A', 'B'], projects: [], checklist: [] },
        updated_at: 100,
      }),
    );
    expect(await pull()).toBe(true);
    expect([...getBookmarks()]).toEqual([1, 2, 3]);

    setBookmarks([1, 3, 9]);
    setBookmarkedOrgs(['B']);
    const body = buildPushBody();
    expect(body.data.bookmarks).toEqual([1, 3, 9]);
    expect(body.removed.bookmarks).toEqual([2]);
    expect(body.removed.bookmarkedOrgs).toEqual(['A']);
    expect(body.base_updated_at).toBe(100);
  });
});
