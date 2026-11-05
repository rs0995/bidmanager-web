// Checklist files on the server (Server UI/server/API_CHANGES.md §3): upload after
// attaching, first upload wins (409), download to open, delete with the attachment or
// the item, and the backfill of files attached before.

const present = new Set<string>();
jest.mock('../src/platform/files', () => ({
  files: {
    abs: (rel: string) => `/Docs/${rel}`,
    copy: jest.fn(async (_src: string, dest: string) => {
      (globalThis as unknown as { __p: Set<string> }).__p.add(dest);
    }),
    remove: jest.fn(async (p: string) => {
      const set = (globalThis as unknown as { __p: Set<string> }).__p;
      [...set].filter(x => x.startsWith(p)).forEach(x => set.delete(x));
    }),
    exists: jest.fn(async (p: string) =>
      (globalThis as unknown as { __p: Set<string> }).__p.has(p),
    ),
    download: jest.fn(async (_url: string, abs: string) => {
      (globalThis as unknown as { __p: Set<string> }).__p.add(abs);
      return 10;
    }),
    upload: jest.fn(),
    open: jest.fn(async () => {}),
  },
}));
(globalThis as unknown as { __p: Set<string> }).__p = present;

const mockOrder: string[] = [];
jest.mock('../src/lib/sync', () => ({
  pushNow: jest.fn(async () => {
    mockOrder.push('push');
    return true;
  }),
  onSynced: jest.fn(),
}));

jest.mock('../src/lib/api', () => {
  const actual = jest.requireActual('../src/lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      projectFileDownload: jest.fn(async (id: number) => ({
        file: { id, name: 'x' },
        url: `/client/project-files/${id}/download?token=t`,
      })),
      deleteProjectFile: jest.fn(async () => ({ ok: true })),
    },
  };
});

import { files } from '../src/platform/files';
import { api } from '../src/lib/api';
import type { ServerTender } from '../src/lib/api';
import { pushNow } from '../src/lib/sync';
import { __resetKV, readJSON } from '../src/lib/kv';
import { setSession } from '../src/lib/auth';
import {
  addChecklistItem,
  attachToItem,
  createProjectFromTender,
  deleteChecklistItem,
  getProjectsState,
  rehydrateProjects,
  removeAttachment,
  setItemServerFile,
} from '../src/lib/sharedProjects';
import {
  backfillUploads,
  ensureItemFile,
  REPLACED_NOTE,
} from '../src/lib/projectFiles';
import { toProject } from '../src/live/LiveProviders';

const upload = files.upload as jest.Mock;
const mockApi = api as unknown as Record<string, jest.Mock>;
const tender = { id: 42, tender_id: 'T42', title: 'Road' } as ServerTender;
const row = (id: number) =>
  getProjectsState().checklist.find(r => r.id === id)!;
const ok = (file: object) => ({ status: 200, json: { file } });

beforeEach(() => {
  __resetKV();
  rehydrateProjects();
  present.clear();
  mockOrder.length = 0;
  jest.clearAllMocks();
  upload.mockImplementation(async () => {
    mockOrder.push('upload');
    return ok({ id: 9, name: 'bg.pdf' });
  });
  setSession({ token: 'tok', user_id: 1, email: 'a@b.c' });
});

async function attached(name = 'bg.pdf') {
  const p = createProjectFromTender(tender);
  const item = addChecklistItem(p.id, 'EMD');
  const note = await attachToItem(item.id, {
    name,
    uri: `file:///tmp/${name}`,
    size: 9,
  });
  return { p, item, note };
}

describe('attaching uploads the file', () => {
  it('pushes the row first, uploads as this phone, and records the server file', async () => {
    const { p, item, note } = await attached();
    expect(note).toBeUndefined();
    expect(mockOrder).toEqual(['push', 'upload']);
    const [url, headers, fields, file] = upload.mock.calls[0];
    expect(url).toMatch(/\/client\/project-files$/);
    expect(headers['x-client-key']).toBe('tok');
    expect(fields).toEqual({
      checklist_item_id: String(item.id),
      project_id: String(p.id),
      device: 'phone',
    });
    expect(file).toMatchObject({
      abs: `/Docs/attachments/${item.id}/bg.pdf`,
      name: 'bg.pdf',
    });
    expect(row(item.id).server_file).toMatchObject({ id: 9 });
  });

  it('a row the server hasn’t got yet: pushes again and retries once', async () => {
    upload
      .mockImplementationOnce(async () => ({
        status: 404,
        json: { detail: { reason: 'row_not_found' } },
      }))
      .mockImplementationOnce(async () => ok({ id: 11, name: 'bg.pdf' }));
    const { item } = await attached();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(pushNow).toHaveBeenCalledTimes(2);
    expect(row(item.id).server_file).toMatchObject({ id: 11 });
  });

  it('another device’s file won: it is downloaded and used instead', async () => {
    upload.mockImplementationOnce(async () => ({
      status: 409,
      json: {
        detail: { reason: 'file_exists', file: { id: 5, name: 'theirs.pdf' } },
      },
    }));
    const { item, note } = await attached();
    expect(note).toBe(REPLACED_NOTE);
    expect(mockApi.projectFileDownload).toHaveBeenCalledWith(5);
    const r = row(item.id);
    expect(r.attachment).toMatchObject({
      name: 'theirs.pdf',
      uri: `/Docs/attachments/${item.id}/theirs.pdf`,
      device: 'phone',
    });
    expect(r.server_file).toMatchObject({ id: 5 });
    expect(present.has(`/Docs/attachments/${item.id}/bg.pdf`)).toBe(false);
    expect(present.has(`/Docs/attachments/${item.id}/theirs.pdf`)).toBe(true);
  });

  it('replacing a file deletes the server’s copy first', async () => {
    const { item } = await attached();
    mockOrder.length = 0;
    mockApi.deleteProjectFile.mockImplementationOnce(async () => {
      mockOrder.push('delete');
      return { ok: true };
    });
    await attachToItem(item.id, {
      name: 'new.pdf',
      uri: 'file:///tmp/new.pdf',
    });
    expect(mockApi.deleteProjectFile).toHaveBeenCalledWith(9);
    expect(mockOrder).toEqual(['delete', 'push', 'upload']);
  });
});

describe('removing', () => {
  it('Remove attachment deletes the server file too', async () => {
    const { item } = await attached();
    removeAttachment(item.id);
    await new Promise(r => setTimeout(r, 0));
    expect(mockApi.deleteProjectFile).toHaveBeenCalledWith(9);
    expect(row(item.id).server_file).toBeNull();
    expect(row(item.id).attachment).toBeNull();
  });

  it('Delete item removes the row, its file here and the downloaded copy', async () => {
    const { item } = await attached();
    deleteChecklistItem(item.id);
    await new Promise(r => setTimeout(r, 0));
    expect(getProjectsState().checklist.some(r => r.id === item.id)).toBe(
      false,
    );
    expect([...present].some(p => p.includes(`/attachments/${item.id}/`))).toBe(
      false,
    );
    expect(readJSON('bw.serverFiles', {})).toEqual({});
  });
});

describe('opening a file another device uploaded', () => {
  it('downloads it once, then opens the saved copy', async () => {
    const p = createProjectFromTender(tender);
    const item = addChecklistItem(p.id, 'PoA');
    setItemServerFile(item.id, { id: 7, name: 'poa.pdf' });
    const path = await ensureItemFile(row(item.id));
    expect(path).toBe(`/Docs/attachments/${item.id}/poa.pdf`);
    expect(files.download).toHaveBeenCalledTimes(1);
    expect((files.download as jest.Mock).mock.calls[0][0]).toMatch(
      /\/client\/project-files\/7\/download\?token=t$/,
    );
    await ensureItemFile(row(item.id));
    expect(files.download).toHaveBeenCalledTimes(1);
  });

  it('shows it as on the server, ready to download, not as unreachable', () => {
    const p = createProjectFromTender(tender);
    const item = addChecklistItem(p.id, 'PoA');
    setItemServerFile(item.id, { id: 7, name: 'poa.pdf' });
    const shown = toProject(p, [row(item.id)], []).checklist[0].items[0];
    expect(shown).toMatchObject({
      file: 'poa.pdf',
      remote: true,
      elsewhere: false,
    });
  });
});

describe('backfill', () => {
  it('uploads files attached here before, and skips other devices’ files', async () => {
    upload.mockImplementation(async () => ({ status: 500, json: null }));
    const { item } = await attached(); // upload failed: still waiting
    const other = addChecklistItem(row(item.id).project_id, 'Desktop file');
    getProjectsState().checklist.find(r => r.id === other.id)!.attachment = {
      name: 'C:/file.pdf',
      device: 'desktop',
    };
    upload.mockClear();
    upload.mockImplementation(async () => ok({ id: 12, name: 'bg.pdf' }));
    await backfillUploads();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][2].checklist_item_id).toBe(String(item.id));
    expect(row(item.id).server_file).toMatchObject({ id: 12 });
  });
});
