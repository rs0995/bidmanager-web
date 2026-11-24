import { __resetKV } from '../src/lib/kv';
import { setSession } from '../src/lib/auth';
import {
  canCheckNow,
  docsForTender,
  downloadDocument,
  getDocsState,
  isCorrupt,
  openDocument,
  rehydrateDocuments,
  signedUrl,
  startJob,
  syncTenderDocuments,
  toCsv,
  UNREADABLE_ZIP,
  zipEntries,
} from '../src/lib/documents';
import { files } from '../src/platform/files';
import { push } from '../src/platform/push';

jest.mock('../src/platform/push', () => ({
  push: {
    getPermission: jest.fn(async () => 'granted'),
    notify: jest.fn(),
    setBadge: jest.fn(),
  },
}));

jest.mock('../src/platform/files', () => {
  const store = new Map<string, number>();
  return {
    files: {
      abs: (rel: string) => `/Docs/${rel}`,
      download: jest.fn(async (_url: string, abs: string) => {
        store.set(abs, abs.includes('broken') ? 0 : 2048);
        return store.get(abs);
      }),
      exists: jest.fn(async (abs: string) => store.has(abs)),
      remove: jest.fn(async (abs: string) => store.delete(abs)),
      open: jest.fn(async () => {}),
      walk: jest.fn(async () => []),
      unzip: jest.fn(async () => {}),
      writeText: jest.fn(async () => {}),
      share: jest.fn(),
      __store: store,
    },
  };
});

const fetchMock = jest.fn();
const ok = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  __resetKV();
  rehydrateDocuments();
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  setSession({ token: 'tok', user_id: 1, email: 'a@b.c' });
});

const tender = { id: 42, tender_id: 'PWD/42', title: 'Road widening' };
const item = (id: number, name: string, size = 2048) => ({
  id,
  name,
  type: 'document',
  size_bytes: size,
  downloaded_at: '',
  status: 'complete',
  downloadable: true,
});

describe('signed download links', () => {
  it('always use the app’s https backend', () => {
    expect(signedUrl('http://10.0.0.5:8000/client/documents/3/download?token=x')).toBe(
      'https://161.118.170.233.sslip.io/client/documents/3/download?token=x',
    );
    expect(signedUrl('/client/documents/3/download?token=x')).toBe(
      'https://161.118.170.233.sslip.io/client/documents/3/download?token=x',
    );
  });
});

describe('document store', () => {
  it('downloads to a relative path and records the size', async () => {
    syncTenderDocuments(tender, [item(1, 'NIT.pdf')]);
    fetchMock.mockReturnValueOnce(ok({ url: 'http://x/client/documents/1/download?token=t' }));
    const row = await downloadDocument({ id: 1, tender_db_id: 42, file_name: 'NIT.pdf', size_bytes: 2048 });
    expect(row.status).toBe('downloaded');
    expect(row.local_rel).toBe('documents/1/NIT.pdf');
    expect(isCorrupt(row)).toBe(false);
    expect((files.download as jest.Mock).mock.calls[0][0]).toMatch(/^https:\/\/161\.118/);
    await openDocument(row);
    expect(files.open).toHaveBeenCalledWith('/Docs/documents/1/NIT.pdf');
  });

  it('flags an empty file as incomplete and a missing one on open', async () => {
    fetchMock.mockReturnValueOnce(ok({ url: '/client/documents/2/download?token=t' }));
    const row = await downloadDocument({ id: 2, tender_db_id: 42, file_name: 'broken.pdf', size_bytes: 9000 });
    expect(isCorrupt(row)).toBe(true);
    await expect(
      openDocument({ ...row, id: 99, local_rel: 'documents/99/gone.pdf', file_name: 'gone.pdf' }),
    ).rejects.toThrow('no longer on this device');
  });

  it('flags a full-size ZIP that won’t open, and clears it on a fresh copy', async () => {
    syncTenderDocuments(tender, [item(3, 'Tender.zip')]);
    fetchMock.mockReturnValue(ok({ url: '/client/documents/3/download?token=t' }));
    const row = await downloadDocument({ id: 3, tender_db_id: 42, file_name: 'Tender.zip', size_bytes: 2048 });
    expect(isCorrupt(row)).toBe(false);
    (files.unzip as jest.Mock).mockRejectedValueOnce(new Error('failed to open zip file'));
    await expect(zipEntries(row)).rejects.toThrow(UNREADABLE_ZIP);
    const flagged = docsForTender(42).find(d => d.id === 3)!;
    expect(flagged.unreadable).toBe(true);
    expect(isCorrupt(flagged)).toBe(true);
    expect(files.remove).toHaveBeenCalledWith('/Docs/zip-extracted/3');
    const fresh = await downloadDocument(flagged);
    expect(fresh.unreadable).toBe(false);
    expect(isCorrupt(fresh)).toBe(false);
  });

  it('keeps local download state when the server list is refreshed', async () => {
    syncTenderDocuments(tender, [item(1, 'NIT.pdf')]);
    fetchMock.mockReturnValueOnce(ok({ url: '/client/documents/1/download?token=t' }));
    await downloadDocument({ id: 1, tender_db_id: 42, file_name: 'NIT.pdf' });
    syncTenderDocuments(tender, [item(1, 'NIT.pdf'), item(5, 'Corrigendum 1.pdf')]);
    const rows = docsForTender(42);
    expect(rows.find(d => d.id === 1)?.status).toBe('downloaded');
    expect(rows.find(d => d.id === 5)?.status).toBe('synced');
  });
});

describe('server jobs', () => {
  it('requests documents, waits for the job, then saves every file', async () => {
    const done = jest.fn();
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/request-download')) return ok({ job_id: 'j1', created: true });
      if (url.includes('/download-status')) return ok({ job_id: 'j1', status: 'completed', error: '' });
      if (url.includes('/documents?')) return ok({ items: [item(7, 'Tender.pdf'), item(8, 'BOQ.xls')], page: 1, page_size: 100, total: 2, pages: 1 });
      if (url.includes('/download-request')) return ok({ url: '/client/documents/x/download?token=t' });
      return ok({});
    });
    await startJob(tender, 'request', done);
    await new Promise(r => setTimeout(r, 0));
    for (let i = 0; i < 10 && !done.mock.calls.length; i++) await new Promise(r => setTimeout(r, 0));
    expect(done).toHaveBeenCalledWith({ ok: true, newDocuments: 2 });
    expect(docsForTender(42).every(d => d.status === 'downloaded')).toBe(true);
    expect(getDocsState().jobs[42]).toBeUndefined();
    // This device posts the notification itself (lock screen, badge), not the server.
    await new Promise(r => setTimeout(r, 0));
    expect(push.notify).toHaveBeenLastCalledWith(
      'Download complete',
      'Documents for “Road widening” finished downloading.',
      { thread: 'download', tenderId: '42' },
      expect.any(Number),
    );
    const badge = (push.notify as jest.Mock).mock.calls.at(-1)[3];
    expect(badge).toBeGreaterThan(0);
  });

  it('a re-download replaces every copy on the device, not only the broken ones', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/request-download')) return ok({ job_id: 'j3' });
      if (url.includes('/download-status')) return ok({ status: 'completed' });
      if (url.includes('/documents?')) return ok({ items: [item(1, 'NIT.pdf'), item(3, 'Tender.zip')], page: 1, page_size: 100, total: 2, pages: 1 });
      if (url.includes('/download-request')) return ok({ url: '/client/documents/x/download?token=t' });
      return ok({});
    });
    syncTenderDocuments(tender, [item(1, 'NIT.pdf'), item(3, 'Tender.zip')]);
    await downloadDocument({ id: 1, tender_db_id: 42, file_name: 'NIT.pdf', size_bytes: 2048 });
    await downloadDocument({ id: 3, tender_db_id: 42, file_name: 'Tender.zip', size_bytes: 2048 });
    (files.download as jest.Mock).mockClear();
    (files.remove as jest.Mock).mockClear();
    const done = jest.fn();
    await startJob(tender, 'redownload', done);
    for (let i = 0; i < 20 && !done.mock.calls.length; i++) await new Promise(r => setTimeout(r, 0));
    expect(done).toHaveBeenCalledWith({ ok: true, newDocuments: 2 });
    const removed = (files.remove as jest.Mock).mock.calls.map(c => c[0]);
    expect(removed).toEqual(expect.arrayContaining(['/Docs/documents/1/NIT.pdf', '/Docs/documents/3/Tender.zip']));
    expect(files.download).toHaveBeenCalledTimes(2);
    expect(docsForTender(42).every(d => d.status === 'downloaded' && !d.unreadable)).toBe(true);
  });

  it('update checks save only new files and start the hourly cooldown', async () => {
    syncTenderDocuments(tender, [item(1, 'NIT.pdf')]);
    const done = jest.fn();
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/request-download')) return ok({ job_id: 'j2' });
      if (url.includes('/download-status')) return ok({ status: 'completed' });
      if (url.includes('/documents?')) return ok({ items: [item(1, 'NIT.pdf'), item(9, 'Corrigendum 2.pdf')], page: 1, page_size: 100, total: 2, pages: 1 });
      if (url.includes('/download-request')) return ok({ url: '/client/documents/x/download?token=t' });
      return ok({});
    });
    expect(canCheckNow(42)).toBe(true);
    await startJob(tender, 'update', done);
    for (let i = 0; i < 10 && !done.mock.calls.length; i++) await new Promise(r => setTimeout(r, 0));
    expect(done).toHaveBeenCalledWith({ ok: true, newDocuments: 1 });
    await new Promise(r => setTimeout(r, 0));
    expect(push.notify).toHaveBeenLastCalledWith(
      'New documents',
      '1 new file saved for “Road widening”.',
      { thread: 'download', tenderId: '42' },
      expect.any(Number),
    );
    expect(docsForTender(42).find(d => d.id === 9)?.status).toBe('downloaded');
    expect(docsForTender(42).find(d => d.id === 1)?.status).toBe('synced');
    expect(canCheckNow(42)).toBe(false);
  });
});

describe('CSV export', () => {
  it('uses BM Pro’s columns and escapes commas and quotes', () => {
    const csv = toCsv([{ tender_id: 'T/1', title: 'Road, phase "II"', organization: 'PWD' }]);
    const [header, row] = csv.split('\n');
    expect(header.split(',')).toEqual([
      'tender_id',
      'title',
      'organization',
      'website_name',
      'location',
      'category',
      'tender_value',
      'emd',
      'published_date',
      'closing_date',
      'status',
    ]);
    expect(row.startsWith('T/1,"Road, phase ""II""",PWD')).toBe(true);
  });
});
