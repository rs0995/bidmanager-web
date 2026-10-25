import { __resetKV, writeJSON } from '../src/lib/kv';
import { setSession } from '../src/lib/auth';
import { getSettings, rehydrateStore, setSettings } from '../src/lib/store';
import {
  applyServerNotificationPrefs,
  buildPushBody,
  pull,
} from '../src/lib/sync';
import {
  addChecklistItem,
  addPrepDoc,
  attachToItem,
  attachmentPath,
  createProjectFromTender,
  deleteProject,
  getProjectsState,
  mergeFromServer,
  prepDocPath,
  rehydrateProjects,
  removeAttachment,
  removePrepDoc,
  setChecklistStatus,
} from '../src/lib/sharedProjects';
import { deleteAllLocalFiles } from '../src/lib/documents';
import { files } from '../src/platform/files';
import type { ServerTender, SharedProject } from '../src/lib/api';

// The BM Pro fixes R1 (notification preferences), R2 (attachments) and R4 (desktop
// folders), as they apply to Bidwise.

const present = new Set<string>();
jest.mock('../src/platform/files', () => ({
  files: {
    abs: (rel: string) => `/Docs/${rel}`,
    copy: jest.fn(async (_src: string, dest: string) => {
      (globalThis as unknown as { __present: Set<string> }).__present.add(dest);
    }),
    remove: jest.fn(async (p: string) => {
      const set = (globalThis as unknown as { __present: Set<string> })
        .__present;
      [...set].filter(x => x.startsWith(p)).forEach(x => set.delete(x));
    }),
    exists: jest.fn(async (p: string) =>
      (globalThis as unknown as { __present: Set<string> }).__present.has(p),
    ),
    open: jest.fn(async () => {}),
  },
}));
(globalThis as unknown as { __present: Set<string> }).__present = present;

const fetchMock = jest.fn();
const ok = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: async () => body });
const tender = { id: 42, tender_id: 'T42', title: 'Road' } as ServerTender;

beforeEach(() => {
  __resetKV();
  rehydrateStore();
  rehydrateProjects();
  present.clear();
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  setSession({ token: 'tok', user_id: 1, email: 'a@b.c' });
});

describe('R1: notification preferences come from the server', () => {
  it('a fresh install sends no preferences, so its defaults overwrite nothing', () => {
    expect(buildPushBody().data.notificationPrefs).toBeUndefined();
  });

  it('sends the preferences with their stamp once the user has set them', () => {
    setSettings({ notifyOrgAlertsOn: true, notificationPrefsUpdatedAt: 1234 });
    expect(buildPushBody().data.notificationPrefs).toEqual({
      notifyOrgAlertsOn: true,
      notifyTenderAlertsOn: false,
      reminderDays: [],
      updatedAt: 1234,
    });
  });

  it('takes the server copy unless this device changed them more recently', () => {
    setSettings({
      notifyTenderAlertsOn: true,
      notificationPrefsUpdatedAt: 5000,
    });
    applyServerNotificationPrefs({
      notifyOrgAlertsOn: false,
      notifyTenderAlertsOn: false,
      reminderDays: [],
      updatedAt: 4000,
    });
    expect(getSettings().notifyTenderAlertsOn).toBe(true);

    applyServerNotificationPrefs({
      notifyOrgAlertsOn: true,
      notifyTenderAlertsOn: false,
      reminderDays: [1, 3],
      updatedAt: 6000,
    });
    expect(getSettings()).toMatchObject({
      notifyOrgAlertsOn: true,
      notifyTenderAlertsOn: false,
      reminderDays: [1, 3],
      notificationPrefsUpdatedAt: 6000,
    });
  });

  it('a reinstall restores the saved choice on its first pull', async () => {
    fetchMock.mockReturnValueOnce(
      ok({
        data: {
          notificationPrefs: {
            notifyOrgAlertsOn: true,
            notifyTenderAlertsOn: true,
            reminderDays: [2],
            updatedAt: 777,
          },
        },
        updated_at: 1,
      }),
    );
    await pull();
    expect(getSettings()).toMatchObject({
      notifyOrgAlertsOn: true,
      reminderDays: [2],
      notificationPrefsUpdatedAt: 777,
    });
  });
});

describe('R2: attachments survive a restart', () => {
  it('copies the pick to attachments/<id>/<name> and marks it as on this phone', async () => {
    const p = createProjectFromTender(tender);
    const item = addChecklistItem(p.id, 'EMD');
    await attachToItem(item.id, {
      name: 'bg.pdf',
      uri: 'file:///tmp/bg.pdf',
      size: 9,
    });
    const row = getProjectsState().checklist.find(r => r.id === item.id)!;
    expect(files.copy).toHaveBeenCalledWith(
      'file:///tmp/bg.pdf',
      `/Docs/attachments/${item.id}/bg.pdf`,
    );
    expect(row.attachment).toMatchObject({
      name: 'bg.pdf',
      device: 'phone',
      uri: `/Docs/attachments/${item.id}/bg.pdf`,
    });
    expect(row.status).toBe('Completed');
    expect(await attachmentPath(row)).toEqual({
      path: `/Docs/attachments/${item.id}/bg.pdf`,
    });

    removeAttachment(item.id);
    await new Promise(r => setTimeout(r, 0));
    expect(present.has(`/Docs/attachments/${item.id}/bg.pdf`)).toBe(false);
    expect(
      getProjectsState().checklist.find(r => r.id === item.id)?.attachment,
    ).toBeNull();
  });

  it('finds the copy after iOS moves the app folder, and explains when it can’t', async () => {
    const p = createProjectFromTender(tender);
    const item = addChecklistItem(p.id, 'PoA');
    await attachToItem(item.id, {
      name: 'poa.pdf',
      uri: 'file:///tmp/poa.pdf',
    });
    const row = getProjectsState().checklist.find(r => r.id === item.id)!;
    const moved = {
      ...row,
      attachment: {
        ...row.attachment!,
        uri: '/OldContainer/attachments/x/poa.pdf',
      },
    };
    expect(await attachmentPath(moved)).toEqual({
      path: `/Docs/attachments/${item.id}/poa.pdf`,
    });

    const other = {
      ...row,
      attachment: { name: 'poa.pdf', uri: 'C:/desktop/poa.pdf' },
    };
    expect(await attachmentPath(other)).toEqual({ reason: 'elsewhere' });

    present.clear();
    expect(await attachmentPath(row)).toEqual({ reason: 'missing' });
  });

  it('keeps Docs for Preparation copies and deletes them on remove', async () => {
    const p = createProjectFromTender(tender);
    await addPrepDoc(p.id, {
      name: 'Cost.xlsx',
      uri: 'file:///tmp/Cost.xlsx',
      size: 2048,
    });
    const doc = getProjectsState().prep[String(p.id)][0];
    expect(doc.rel).toMatch(
      new RegExp(`^attachments/prep/${p.id}/prep\\w+/Cost\\.xlsx$`),
    );
    expect(await prepDocPath(p.id, doc.id)).toBe(`/Docs/${doc.rel}`);
    removePrepDoc(p.id, doc.id);
    await new Promise(r => setTimeout(r, 0));
    expect(present.size).toBe(0);
    expect(getProjectsState().prep[String(p.id)]).toHaveLength(0);
  });

  it('Clear local cache deletes the attachments folder', async () => {
    await deleteAllLocalFiles();
    expect(files.remove).toHaveBeenCalledWith('/Docs/attachments');
  });
});

describe('deleting an archived project', () => {
  it('removes it, its checklist, prep docs and files, and syncs the removal', async () => {
    const gone = createProjectFromTender(tender);
    const kept = createProjectFromTender({
      ...tender,
      id: 43,
      tender_id: 'T43',
    });
    const item = addChecklistItem(gone.id, 'EMD');
    const other = addChecklistItem(kept.id, 'PoA');
    await attachToItem(item.id, { name: 'bg.pdf', uri: 'file:///tmp/bg.pdf' });
    await addPrepDoc(gone.id, {
      name: 'Cost.xlsx',
      uri: 'file:///tmp/Cost.xlsx',
    });
    // As last synced: the server has both projects.
    writeJSON('bw.syncBlob', {
      projects: getProjectsState().projects,
      checklist: getProjectsState().checklist,
    });

    deleteProject(gone.id);
    await new Promise(r => setTimeout(r, 0));
    const s = getProjectsState();
    expect(s.projects.map(p => p.id)).toEqual([kept.id]);
    expect(s.checklist.map(r => r.id)).toEqual([other.id]);
    expect(s.prep[String(gone.id)]).toBeUndefined();
    expect(present.size).toBe(0);
    // The next push tells the server (and so BM Pro and the desktop) it's gone.
    const { removed } = buildPushBody();
    expect(removed.projects).toEqual([gone.id]);
    expect(removed.checklist).toEqual([item.id]);
  });
});

describe('R4: desktop folders are kept', () => {
  it('keeps checklist_folders through pull, edit and push', () => {
    const fromDesktop: SharedProject = {
      ...createProjectFromTender(tender),
      checklist_folders: ['Ready Docs', 'Financials'],
    };
    mergeFromServer([fromDesktop], []);
    const item = addChecklistItem(fromDesktop.id, 'Balance sheet');
    setChecklistStatus(item.id, 'Completed');
    const pushed = buildPushBody().data.projects ?? [];
    expect(pushed[0].checklist_folders).toEqual(['Ready Docs', 'Financials']);
  });
});
