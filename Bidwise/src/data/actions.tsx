import React, {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { clearAllRaw } from '../lib/kv';
import { ALL_KEYS } from '../lib/bootstrap';
import { forgetQueries } from '../lib/queryPersist';
import { setSyncPaused } from '../lib/pushQueue';
import { rehydrateProjects } from '../lib/sharedProjects';
import { deleteAllLocalFiles, rehydrateDocuments } from '../lib/documents';
import { rehydrateStore, setSettings, useSettings } from '../lib/store';
import { syncNow } from '../lib/sync';
import { disableAppLock, enableAppLock } from '../lib/appLock';
import { rehydrateAlerts } from '../lib/alerts';

// Account and sync actions shared by More and the Dashboard's Sync bar. Demo mode fakes
// them with short delays; live mode calls the server.

export type Actions = {
  lastSyncAt: number | null;
  syncing: boolean;
  /** Pulls and pushes bookmarks/projects and refreshes every list. Rejects on failure. */
  sync: () => Promise<void>;
  checkConnection: () => Promise<boolean>;
  changePassword: (current: string, next: string) => Promise<void>;
  /** Empties this device's data and pauses syncing until the next Sync tenders. */
  clearCache: () => void;
  appLockEnabled: boolean;
  /** Asks for Face ID either way; rejects with a readable message when it didn't change. */
  setAppLock: (on: boolean) => Promise<void>;
};

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function useDemoActions(): Actions {
  const [lastSyncAt, setLast] = useState<number | null>(
    () => Date.now() - 4 * 60000,
  );
  const [syncing, setSyncing] = useState(false);
  const [appLock, setAppLockState] = useState(false);
  const busy = useRef(false);
  return useMemo(
    () => ({
      lastSyncAt,
      syncing,
      sync: async () => {
        if (busy.current) return;
        busy.current = true;
        setSyncing(true);
        await wait(900);
        busy.current = false;
        setSyncing(false);
        setLast(Date.now());
      },
      checkConnection: async () => {
        await wait(600);
        return true;
      },
      changePassword: async () => {
        await wait(400);
      },
      clearCache: () => setLast(null),
      appLockEnabled: appLock,
      setAppLock: async on => setAppLockState(on),
    }),
    [lastSyncAt, syncing, appLock],
  );
}

function useLiveActions(): Actions {
  const qc = useQueryClient();
  const settings = useSettings();
  const [syncing, setSyncing] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);
  return useMemo(
    () => ({
      lastSyncAt: settings.lastSyncAt ? Date.parse(settings.lastSyncAt) : null,
      syncing,
      sync: () => {
        if (inFlight.current) return inFlight.current;
        setSyncing(true);
        inFlight.current = (async () => {
          setSyncPaused(false);
          await syncNow();
          await qc.invalidateQueries();
        })().finally(() => {
          inFlight.current = null;
          setSyncing(false);
        });
        return inFlight.current;
      },
      checkConnection: async () => {
        try {
          await api.health();
          return true;
        } catch (e) {
          // Reaching the server but being refused still means the connection works.
          return (e as Error)?.name === 'AuthError';
        }
      },
      changePassword: async (current, next) => {
        await api.changePassword({
          current_password: current,
          new_password: next,
        });
      },
      clearCache: () => {
        setSyncPaused(true);
        clearAllRaw(ALL_KEYS.filter(k => k !== 'bw.syncPaused'));
        rehydrateStore();
        rehydrateProjects();
        rehydrateDocuments();
        rehydrateAlerts();
        deleteAllLocalFiles().catch(() => {});
        // App lock is a security setting, not cached data: keep it as it was.
        setSettings({
          lastSyncAt: null,
          appLockEnabled: settings.appLockEnabled,
        });
        forgetQueries(qc);
      },
      appLockEnabled: settings.appLockEnabled,
      setAppLock: on => (on ? enableAppLock() : disableAppLock()),
    }),
    [qc, settings.lastSyncAt, settings.appLockEnabled, syncing],
  );
}

const ActionsContext = createContext<Actions | null>(null);

function DemoActionsProvider({ children }: { children: React.ReactNode }) {
  const value = useDemoActions();
  return (
    <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>
  );
}

function LiveActionsProvider({ children }: { children: React.ReactNode }) {
  const value = useLiveActions();
  return (
    <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>
  );
}

export function ActionsProvider({
  mode,
  children,
}: {
  mode: 'demo' | 'live';
  children: React.ReactNode;
}) {
  return mode === 'live' ? (
    <LiveActionsProvider>{children}</LiveActionsProvider>
  ) : (
    <DemoActionsProvider>{children}</DemoActionsProvider>
  );
}

export function useActions(): Actions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useActions must be used inside ActionsProvider');
  return ctx;
}

/** "4 min ago" from a timestamp; "never" before the first sync. */
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "22 Oct, 10:52 am" (BM Pro's Last synced format); "never" before the first sync. */
export function syncTime(at: number | null): string {
  if (at === null) return 'never';
  const d = new Date(at);
  const h = d.getHours() % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${String(d.getDate()).padStart(2, '0')} ${
    MONTHS[d.getMonth()]
  }, ${h}:${mm} ${d.getHours() < 12 ? 'am' : 'pm'}`;
}

/** BM Pro: the Sync card turns into a prompt once the last sync is this old. */
export const SYNC_STALE_MS = 30 * 60 * 1000;

export function relativeTime(at: number | null, now = Date.now()) {
  if (at === null) return 'never';
  const mins = Math.round((now - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)}h ago`;
}
