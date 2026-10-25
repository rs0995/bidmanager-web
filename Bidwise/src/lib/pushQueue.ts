import { useSyncExternalStore } from 'react';
import { getRaw, removeRaw, setRaw } from './kv';

// Dirty flag + debounced "sync soon", kept apart from sync.ts so the projects store can
// schedule a push without importing sync.ts (which imports it), as in BM Pro.
// Also holds the pause that Clear local cache sets: nothing syncs until Sync tenders.

const DIRTY_KEY = 'bw.syncDirty';
const PAUSED_KEY = 'bw.syncPaused';
export const QUEUE_KEYS = [DIRTY_KEY, PAUSED_KEY];

export const isDirty = () => getRaw(DIRTY_KEY) === '1';
export const markDirty = () => setRaw(DIRTY_KEY, '1');
export const clearDirty = () => setRaw(DIRTY_KEY, '');

let timer: ReturnType<typeof setTimeout> | null = null;
let runSync: () => Promise<unknown> | void = () => {};

/** sync.ts registers its real sync here once, at module load. */
export function registerSyncRunner(fn: () => Promise<unknown> | void) {
  runSync = fn;
}

export function cancelScheduledPush() {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Marks local data changed and syncs about a second later (bursts coalesce). */
export function schedulePush() {
  markDirty();
  cancelScheduledPush();
  timer = setTimeout(() => {
    Promise.resolve(runSync()).catch(() => {});
  }, 1000);
}

// --- Pause after Clear local cache ---

const pauseListeners = new Set<() => void>();

export const isSyncPaused = () => getRaw(PAUSED_KEY) === '1';

export function setSyncPaused(paused: boolean) {
  if (paused) setRaw(PAUSED_KEY, '1');
  else removeRaw(PAUSED_KEY);
  pauseListeners.forEach(fn => fn());
}

export function useSyncPaused() {
  return useSyncExternalStore(
    fn => {
      pauseListeners.add(fn);
      return () => {
        pauseListeners.delete(fn);
      };
    },
    isSyncPaused,
    isSyncPaused,
  );
}
