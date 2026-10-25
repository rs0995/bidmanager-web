import { __resetKV } from '../src/lib/kv';
import { setSession } from '../src/lib/auth';
import { rehydrateStore, setBookmarks } from '../src/lib/store';
import {
  createProjectFromTender,
  rehydrateProjects,
  updateProject,
} from '../src/lib/sharedProjects';
import {
  collectTenders,
  exportFileName,
  exportTenders,
  projectTenderIds,
} from '../src/lib/exportCsv';
import { files } from '../src/platform/files';
import type { ServerTender } from '../src/lib/api';

jest.mock('../src/platform/files', () => ({
  files: {
    abs: (rel: string) => `/Docs/${rel}`,
    writeText: jest.fn(async () => {}),
    share: jest.fn(),
  },
}));

const t = (id: number, organization: string, extra: Partial<ServerTender> = {}) =>
  ({ id, organization, tender_id: `T${id}`, title: `Tender ${id}`, ...extra } as ServerTender);

const fetchMock = jest.fn();
const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const page = (items: unknown[], p = 1, pages = 1) => ({ items, page: p, page_size: 100, total: items.length, pages });

beforeEach(() => {
  __resetKV();
  rehydrateStore();
  rehydrateProjects();
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  setSession({ token: 'tok', user_id: 1, email: 'a@b.c' });
  (files.writeText as jest.Mock).mockClear();
  (files.share as jest.Mock).mockClear();
});

it('exports bookmarked tenders, skipping ones the server no longer has', async () => {
  setBookmarks([1, 2, 3]);
  fetchMock.mockImplementation((url: string) => {
    const id = Number(url.split('/').pop());
    return id === 2
      ? Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: 'Not found' }) })
      : ok(t(id, 'PWD'));
  });
  const rows = await collectTenders({ kind: 'bookmarked' });
  expect(rows.map(r => r.id)).toEqual([1, 3]);
});

it('exports the tenders behind projects, not archived projects', async () => {
  createProjectFromTender(t(10, 'PWD'));
  const p = createProjectFromTender(t(11, 'MJP'));
  updateProject(p.id, { status: 'Archived' });
  expect(projectTenderIds()).toEqual([10]);
  fetchMock.mockImplementation(() => ok(t(10, 'PWD')));
  const rows = await collectTenders({ kind: 'projects' });
  expect(rows.map(r => r.id)).toEqual([10]);
});

it('exports selected organisations: exact names, all pages, no duplicates', async () => {
  fetchMock.mockImplementation((url: string) => {
    const q = new URLSearchParams(url.split('?')[1]);
    expect(q.get('archived')).toBe('false');
    if (q.get('organization') === 'PWD') {
      // The server matches by substring: "PWD Konkan" must be dropped.
      return q.get('page') === '1'
        ? ok(page([t(1, 'PWD'), t(2, 'PWD Konkan')], 1, 2))
        : ok(page([t(3, 'pwd ')], 2, 2));
    }
    return ok(page([t(3, 'MJP'), t(4, 'MJP')]));
  });
  const progress = jest.fn();
  const rows = await collectTenders(
    {
      kind: 'orgs',
      includeClosed: false,
      orgs: [
        { name: 'PWD', websiteId: 1 },
        { name: 'MJP', websiteId: 2 },
      ],
    },
    progress,
  );
  expect(rows.map(r => r.id)).toEqual([1, 3, 4]);
  expect(progress).toHaveBeenLastCalledWith(2, 2);
});

it('includes closed tenders when asked', async () => {
  fetchMock.mockImplementation((url: string) => {
    expect(new URLSearchParams(url.split('?')[1]).has('archived')).toBe(false);
    return ok(page([t(1, 'PWD')]));
  });
  await collectTenders({ kind: 'orgs', includeClosed: true, orgs: [{ name: 'PWD', websiteId: 1 }] });
});

it('writes the CSV, opens the share sheet and names the file by scope', async () => {
  setBookmarks([5]);
  fetchMock.mockImplementation(() => ok(t(5, 'PWD')));
  expect(await exportTenders({ kind: 'bookmarked' })).toBe(1);
  const path = (files.writeText as jest.Mock).mock.calls[0][0] as string;
  expect(path).toMatch(/^\/Docs\/exports\/tenders-bookmarked-\d{4}-\d{2}-\d{2}\.csv$/);
  expect(files.share).toHaveBeenCalledWith(path);

  const date = new Date('2026-10-16T10:00:00Z');
  expect(exportFileName({ kind: 'projects' }, date)).toBe('tenders-projects-2026-10-16.csv');
  expect(
    exportFileName({ kind: 'orgs', includeClosed: false, orgs: [{ name: 'PWD, Konkan', websiteId: 1 }] }, date),
  ).toBe('tenders-PWD-Konkan-2026-10-16.csv');
  expect(
    exportFileName(
      { kind: 'orgs', includeClosed: false, orgs: [{ name: 'A', websiteId: 1 }, { name: 'B', websiteId: 1 }] },
      date,
    ),
  ).toBe('tenders-organisations-2026-10-16.csv');
});

it('exports nothing (and opens no sheet) when the set is empty', async () => {
  setBookmarks([]);
  expect(await exportTenders({ kind: 'bookmarked' })).toBe(0);
  expect(files.share).not.toHaveBeenCalled();
});
