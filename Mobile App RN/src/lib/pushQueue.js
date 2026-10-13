import { getRaw, setRaw } from "./kv.js";

// Dirty-flag storage + debounced "run a sync soon" trigger, split out of
// sync.js on purpose: lib/projects.js needs to call schedulePush() after
// every local mutation, but sync.js already imports FROM projects.js
// (getProjects/forSync/mergeFromServer) to build/apply the sync blob -- the
// reverse import used to live directly in sync.js, which made the two files
// a require cycle (Metro warns about this on every bundle: uninitialized
// values are possible when two modules load each other before either
// finishes evaluating). This module has no dependency on projects.js or
// sync.js, so both can depend on it one-directionally instead of on each
// other.
const SYNC_DIRTY_KEY = "bm.syncDirty";

export function isDirty() { return getRaw(SYNC_DIRTY_KEY) === "1"; }
export function markDirty() { setRaw(SYNC_DIRTY_KEY, "1"); }
export function clearDirty() { setRaw(SYNC_DIRTY_KEY, ""); }

let pushTimer = null;
let runSync = () => {};

// sync.js registers its real syncUserData() here once, at module load, so
// the debounced timer below actually does something.
export function registerSyncRunner(fn) {
  runSync = fn;
}

export function cancelScheduledPush() {
  clearTimeout(pushTimer);
  pushTimer = null;
}

export function schedulePush() {
  markDirty();
  cancelScheduledPush();
  pushTimer = setTimeout(() => { runSync(); }, 1000);
}
