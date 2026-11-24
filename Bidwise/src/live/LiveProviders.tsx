import React, { useCallback, useMemo } from 'react';
import { forgetQueries } from '../lib/queryPersist';
import {
  maybeAskForPush,
  syncPushToken,
  unregisterPush,
} from '../lib/pushRegistration';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  LoginResponse,
  ServerTender,
  SharedChecklistItem,
  SharedProject,
} from '../lib/api';
import { refreshAccount, setAccount, useAccount } from '../lib/account';
import { ensureItemFile } from '../lib/projectFiles';
import { useToast } from '../components/ui';
import {
  clearSession,
  getToken,
  setSession,
  useSessionUser,
  useSignedIn,
} from '../lib/auth';
import { useTenderSource } from '../data/tenderSource';
import { picker } from '../platform/picker';
import { files } from '../platform/files';
import { schedulePush } from '../lib/pushQueue';
import {
  findProjectForTender,
  addChecklistItem,
  addPrepDoc,
  attachToItem,
  attachmentPath,
  checklistFor,
  createProjectFromTender,
  deleteChecklistItem,
  deleteProject,
  getProjectsState,
  PrepDocRow,
  prepDocPath,
  removeAttachment,
  removePrepDoc,
  setChecklistStatus,
  STATUS_ARCHIVED,
  STATUS_SUBMITTED,
  STATUS_ACTIVE,
  updateProject,
  useProjectsState,
} from '../lib/sharedProjects';
import {
  prebidReminderOn,
  setPrebidReminder,
  setSettings,
  toggleBookmark,
  toggleOrgBookmark,
  useBookmarkIds,
  useBookmarkedOrgNames,
  usePrebidOff,
  usePrebidOn,
  useSettings,
} from '../lib/store';
import { pushNow, syncUserData } from '../lib/sync';
import {
  countdown,
  fmtINR,
  formatDateTime,
  parseFlexibleDate,
} from '../lib/serverTender';
import { AlertsContext, AlertsCtx, AlertItem } from '../fixtures/alerts';
import {
  alertTime,
  markAllRead,
  markRead,
  useStoredAlerts,
} from '../lib/alerts';
import {
  BookmarksContext,
  BookmarksCtx,
  PROJECT_BOOKMARK_MESSAGE,
} from '../fixtures/bookmarks';
import { CaptchaContext, CaptchaCtx } from '../fixtures/captcha';
import { NotifyContext, NotifyCtx, toggleIn } from '../fixtures/notifySettings';
import {
  Project,
  ProjectsContext,
  ProjectsCtx,
  ProjectStatus,
  READY_FOLDER,
} from '../fixtures/projects';
import { Account, SessionContext, SessionCtx } from '../fixtures/session';

// Live implementations of the app's data contexts. Each provides exactly the interface
// its sample-data twin in src/fixtures/ does, so screens don't know which mode they run in.

// --- Session ---

export function accountFrom(
  user: { email: string; display_name: string } | null,
): Account {
  const name =
    user?.display_name?.trim() || user?.email?.split('@')[0] || 'Signed in';
  const initials =
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w[0]?.toUpperCase())
      .join('') || 'BW';
  return {
    name,
    initials,
    email: user?.email ?? '',
    role: 'Signed in',
    workspace: '',
  };
}

/** Shared by sign-in and sign-up: session, account, then the first sync and push setup. */
async function afterSignIn(res: LoginResponse) {
  setSession(res);
  // Sections and organisation: from the response, else from /client/me.
  if (res.account) setAccount(res.account);
  else refreshAccount().catch(() => {});
  // Bring bookmarks and projects down before the first screen draws.
  await syncUserData().catch(() => {});
  // Push: register this phone (or ask, if alerts are on and it never was).
  syncPushToken().catch(() => {});
  maybeAskForPush().catch(() => {});
}

function LiveSessionProvider({ children }: { children: React.ReactNode }) {
  const signedIn = useSignedIn();
  const user = useSessionUser();
  // The organisation's name stands as the workspace (Dashboard subtitle).
  const orgName = useAccount().org?.name ?? '';
  const qc = useQueryClient();
  const value = useMemo<SessionCtx>(
    () => ({
      signedIn,
      account: { ...accountFrom(user), workspace: orgName },
      signIn: async (email, password) => {
        const res = await api.login({ email: email.trim(), password });
        await afterSignIn(res);
      },
      signUp: async ({ name, email, password, accountType, orgName }) => {
        const res = await api.register({
          email: email.trim(),
          password,
          display_name: name.trim(),
          account_type: accountType,
          org_name: accountType === 'organisation' ? orgName?.trim() : '',
        });
        await afterSignIn(res);
      },
      signOut: () => {
        // Sign out here at once; on the server, drop this phone's push token first,
        // then revoke the session key it needs.
        const key = getToken();
        clearSession();
        forgetQueries(qc);
        unregisterPush(key)
          .catch(() => {})
          .finally(() => api.logout(key).catch(() => {}));
      },
    }),
    [signedIn, user, orgName, qc],
  );
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

// --- Saved tenders and bookmarked organisations ---

/** Push straight away so the server's notification pass knows about it. */
const pushSoon = () => {
  schedulePush();
  pushNow().catch(() => {});
};

function LiveBookmarksProvider({ children }: { children: React.ReactNode }) {
  const ids = useBookmarkIds();
  const orgs = useBookmarkedOrgNames();
  const toast = useToast();
  const source = useTenderSource();
  const value = useMemo<BookmarksCtx>(
    () => ({
      isBookmarked: id => ids.has(Number(id)),
      toggle: id => {
        // A project's tender stays bookmarked while the project exists (the server
        // keeps it too); archived projects count.
        if (
          ids.has(Number(id)) &&
          findProjectForTender(id, source.peekServerTender(id)?.tender_id)
        ) {
          toast.show(PROJECT_BOOKMARK_MESSAGE);
          return true;
        }
        const on = toggleBookmark(id);
        pushSoon();
        return on;
      },
      count: ids.size,
      isOrgBookmarked: name => orgs.has(name),
      toggleOrg: name => {
        const on = toggleOrgBookmark(name);
        pushSoon();
        return on;
      },
      orgCount: orgs.size,
    }),
    [ids, orgs, toast, source],
  );
  return (
    <BookmarksContext.Provider value={value}>
      {children}
    </BookmarksContext.Provider>
  );
}

// --- Projects (shared desktop / BM Pro format, shown the Bidwise way) ---

const fromStatus = (s: string): ProjectStatus =>
  s === STATUS_SUBMITTED ? 'Submitted' : 'Bid in preparation';

export function toProject(
  p: SharedProject,
  rows: SharedChecklistItem[],
  prep: PrepDocRow[],
  now = Date.now(),
): Project {
  const { closeIn, state } = countdown(parseFlexibleDate(p.deadline), now);
  return {
    id: String(p.id),
    title: p.title,
    client: p.client_name,
    value: fmtINR(p.project_value),
    emd: fmtINR(p.emd),
    deadline: formatDateTime(p.deadline),
    dueIn: closeIn,
    state,
    prebid: p.prebid ? formatDateTime(p.prebid) : '—',
    sourceTenderId:
      p.source_tender_db_id != null ? String(p.source_tender_db_id) : '',
    tenderRef: p.source_tender_id || undefined,
    status: fromStatus(p.status),
    description: p.description,
    checklist: [
      {
        name: READY_FOLDER,
        items: rows.map(r => ({
          id: String(r.id),
          name: r.req_file_name,
          note: r.description,
          done: r.status === 'Completed',
          // Shown from this phone's attachment, else the server's file.
          file: r.attachment?.name ?? r.server_file?.name,
          elsewhere:
            Boolean(r.attachment) &&
            r.attachment?.device !== 'phone' &&
            !r.server_file,
          remote: Boolean(r.server_file) && r.attachment?.device !== 'phone',
        })),
      },
    ],
    prepDocs: prep.map(d => ({
      id: d.id,
      name: d.name,
      serverFileId: d.serverFileId,
      meta: `${
        d.size ? `${Math.max(1, Math.round(d.size / 1024))} KB · ` : ''
      }${d.id.startsWith('srv') ? 'From Drive' : 'Added by you'}${
        d.serverFileId && !d.id.startsWith('srv') ? ' · on Drive' : ''
      }`,
    })),
  };
}

function LiveProjectsProvider({ children }: { children: React.ReactNode }) {
  const { projects, checklist, prep } = useProjectsState();
  const source = useTenderSource();

  // Active ones show in Projects; archived ones on the Archived projects page.
  const [list, archivedList] = useMemo(() => {
    const now = Date.now();
    const make = (p: SharedProject) =>
      toProject(
        p,
        checklist
          .filter(r => r.project_id === p.id)
          .sort((a, b) => (a.sr_no || 0) - (b.sr_no || 0)),
        prep[String(p.id)] ?? [],
        now,
      );
    return [
      projects.filter(p => p.status !== STATUS_ARCHIVED).map(make),
      projects
        .filter(p => p.status === STATUS_ARCHIVED)
        .map(p => ({ ...make(p), archived: true })),
    ];
  }, [projects, checklist, prep]);

  const toast = useToast();
  const attachPicked = useCallback(
    async (itemId: string) => {
      const file = await picker.pickDocument();
      if (!file) return;
      // Another device's file may win on the server; say so when it does.
      const note = await attachToItem(Number(itemId), file);
      if (note) toast.show(note);
    },
    [toast],
  );

  const value = useMemo<ProjectsCtx>(
    () => ({
      projects: list,
      archivedCount: archivedList.length,
      getProject: id =>
        list.find(p => p.id === String(id)) ??
        archivedList.find(p => p.id === String(id)),
      addItem: (projectId, _folder, name, note) => {
        addChecklistItem(Number(projectId), name, note);
      },
      attachFile: (_projectId, itemId) => {
        attachPicked(itemId).catch(() => {});
      },
      removeFile: (_projectId, itemId) => removeAttachment(Number(itemId)),
      removeItem: (_projectId, itemId) => deleteChecklistItem(Number(itemId)),
      toggleDone: (_projectId, itemId) => {
        const row = getProjectsState().checklist.find(
          r => r.id === Number(itemId),
        );
        if (row)
          setChecklistStatus(
            row.id,
            row.status === 'Completed' ? 'Pending' : 'Completed',
          );
      },
      addPrepDoc: projectId => {
        picker
          .pickDocument()
          .then(file =>
            file ? addPrepDoc(Number(projectId), file) : undefined,
          )
          .catch(() => {});
      },
      openAttachment: async (_projectId, itemId) => {
        const row = getProjectsState().checklist.find(
          r => r.id === Number(itemId),
        );
        if (!row) return 'missing';
        const where = await attachmentPath(row);
        if ('path' in where) {
          await files.open(where.path);
          return 'opened';
        }
        // On the server only (or another device's copy): fetch it, then open.
        if (row.server_file) {
          toast.show(`Downloading ${row.server_file.name}…`);
          const path = await ensureItemFile(row);
          if (path) {
            await files.open(path);
            return 'opened';
          }
        }
        return where.reason;
      },
      openPrepDoc: async (projectId, docId) => {
        const path = await prepDocPath(Number(projectId), docId);
        if (!path) return 'missing';
        await files.open(path);
        return 'opened';
      },
      removePrepDoc: (projectId, docId) =>
        removePrepDoc(Number(projectId), docId),
      setStatus: (projectId, status) =>
        updateProject(Number(projectId), {
          status: status === 'Submitted' ? STATUS_SUBMITTED : STATUS_ACTIVE,
        }),
      archiveProject: projectId =>
        updateProject(Number(projectId), { status: STATUS_ARCHIVED }),
      archivedProjects: archivedList,
      // As BM Pro: a restored project is Active again.
      restoreProject: projectId =>
        updateProject(Number(projectId), { status: STATUS_ACTIVE }),
      deleteProject: projectId => deleteProject(Number(projectId)),
      projectForTender: (tenderId, ref) => {
        const found = findProjectForTender(
          tenderId,
          ref ?? source.peekServerTender(tenderId)?.tender_id,
        );
        return found && found.status !== STATUS_ARCHIVED
          ? list.find(p => p.id === String(found.id))
          : undefined;
      },
      findExistingProject: (tenderId, ref) => {
        const found = findProjectForTender(
          tenderId,
          ref ?? source.peekServerTender(tenderId)?.tender_id,
        );
        if (!found) return undefined;
        return {
          project: list.find(p => p.id === String(found.id)),
          archived: found.status === STATUS_ARCHIVED,
        };
      },
      startProject: (tenderId, ref) => {
        const server: ServerTender | undefined =
          source.peekServerTender(tenderId);
        // Never a second project for the same tender (archived ones included).
        const existing = findProjectForTender(
          tenderId,
          ref ?? server?.tender_id,
        );
        const shared =
          existing ??
          createProjectFromTender(
            server ??
              ({
                id: Number(tenderId),
                tender_id: '',
                title: '',
              } as ServerTender),
          );
        const s = getProjectsState();
        return toProject(
          shared,
          checklistFor(shared.id),
          s.prep[String(shared.id)] ?? [],
        );
      },
    }),
    [list, archivedList, attachPicked, source, toast],
  );
  return (
    <ProjectsContext.Provider value={value}>
      {children}
    </ProjectsContext.Provider>
  );
}

// --- Captcha ---

function LiveCaptchaProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const signedIn = useSignedIn();
  const pending = useQuery({
    queryKey: ['captcha-pending'],
    queryFn: api.captchaPending,
    enabled: signedIn,
    refetchInterval: 60_000,
  });
  const value = useMemo<CaptchaCtx>(
    () => ({
      pending: pending.data
        ? {
            requestId: pending.data.request_id,
            sampleText: '',
            context: pending.data.context ?? 'One of your updates',
            imageBase64: pending.data.image_base64,
          }
        : null,
      answer: async text => {
        if (!pending.data || !text.trim()) return false;
        try {
          await api.answerCaptcha(pending.data.request_id, text.trim());
          return true;
        } catch {
          return false;
        } finally {
          qc.invalidateQueries({ queryKey: ['captcha-pending'] });
        }
      },
    }),
    [pending.data, qc],
  );
  return (
    <CaptchaContext.Provider value={value}>{children}</CaptchaContext.Provider>
  );
}

// --- Notification preferences (sync to the server's push pass) ---

function LiveNotifyProvider({ children }: { children: React.ReactNode }) {
  const s = useSettings();
  const prebidOnIds = usePrebidOn();
  const prebidOffIds = usePrebidOff();
  const value = useMemo<NotifyCtx>(
    () => ({
      settings: {
        orgAlerts: s.notifyOrgAlertsOn,
        tenderAlerts: s.notifyTenderAlertsOn,
        reminderDays: s.reminderDays,
        projectAlerts: s.notifyProjectAlertsOn,
        prebidLeads: s.prebidLeads,
        prebidAutoBookmarked: s.prebidAutoBookmarked,
      },
      set: patch => {
        // New projects is an in-app alert on this phone only: nothing to send.
        if (patch.projectAlerts !== undefined)
          setSettings({ notifyProjectAlertsOn: patch.projectAlerts });
        // The rest go to the server's push pass.
        const pushed =
          patch.orgAlerts !== undefined ||
          patch.tenderAlerts !== undefined ||
          patch.reminderDays !== undefined ||
          patch.prebidLeads !== undefined ||
          patch.prebidAutoBookmarked !== undefined;
        if (!pushed) return;
        setSettings({
          ...(patch.prebidLeads && { prebidLeads: patch.prebidLeads }),
          ...(patch.prebidAutoBookmarked !== undefined && {
            prebidAutoBookmarked: patch.prebidAutoBookmarked,
          }),
          ...(patch.orgAlerts !== undefined && {
            notifyOrgAlertsOn: patch.orgAlerts,
          }),
          ...(patch.tenderAlerts !== undefined && {
            notifyTenderAlertsOn: patch.tenderAlerts,
          }),
          ...(patch.reminderDays && { reminderDays: patch.reminderDays }),
          notificationPrefsUpdatedAt: Date.now(),
        });
        schedulePush();
      },
      toggleDay: (day, on) => {
        setSettings({
          reminderDays: toggleIn(s.reminderDays, day, on),
          notificationPrefsUpdatedAt: Date.now(),
        });
        schedulePush();
      },
      togglePrebidLead: (minutes, on) => {
        setSettings({
          prebidLeads: toggleIn(s.prebidLeads, minutes, on, true),
          notificationPrefsUpdatedAt: Date.now(),
        });
        schedulePush();
      },
      prebidOn: (id, bookmarked) =>
        prebidReminderOn(
          id,
          bookmarked,
          s.prebidAutoBookmarked,
          prebidOnIds,
          prebidOffIds,
        ),
      setPrebid: (id, enabled) => {
        setPrebidReminder(id, enabled);
        schedulePush();
      },
    }),
    [s, prebidOnIds, prebidOffIds],
  );
  return (
    <NotifyContext.Provider value={value}>{children}</NotifyContext.Provider>
  );
}

// --- Alerts (built on this device by lib/alertChecks.ts) ---

function LiveAlertsProvider({ children }: { children: React.ReactNode }) {
  const stored = useStoredAlerts();
  const s = useSettings();
  const value = useMemo<AlertsCtx>(() => {
    const now = new Date();
    const alerts = stored.map<AlertItem>(a => ({
      id: String(a.id),
      kind: a.kind,
      message: a.message,
      time: alertTime(a.at, now),
      unread: !a.read,
      tenderId: a.tenderId,
      projectId: a.projectId,
      orgName: a.orgName,
      newTenderIds: a.newTenderIds,
    }));
    return {
      alerts,
      unread: alerts.filter(a => a.unread).length,
      markRead: id => markRead(Number(id)),
      markAllRead,
      remindersOn: s.reminderDays.length > 0,
      setRemindersOn: on => {
        setSettings({
          reminderDays: on ? [1, 3] : [],
          notificationPrefsUpdatedAt: Date.now(),
        });
        schedulePush();
      },
    };
  }, [stored, s.reminderDays]);
  return (
    <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>
  );
}

/** Session first: everything else only matters once signed in. */
export function LiveProviders({ children }: { children: React.ReactNode }) {
  return (
    <LiveSessionProvider>
      <LiveBookmarksProvider>
        <LiveProjectsProvider>
          <LiveCaptchaProvider>
            <LiveNotifyProvider>
              <LiveAlertsProvider>{children}</LiveAlertsProvider>
            </LiveNotifyProvider>
          </LiveCaptchaProvider>
        </LiveProjectsProvider>
      </LiveBookmarksProvider>
    </LiveSessionProvider>
  );
}
