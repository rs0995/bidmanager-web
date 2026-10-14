import { useSyncExternalStore } from "react";
import { getRaw, setRaw, removeRaw } from "./kv.js";

// Set by "Clear local cache": nothing is fetched or synced with the server
// (lists, favourites, projects, background sync) until the user presses Sync
// on More or the Overview, which clears it (see resumeSync.js). Kept in its
// own module with no app imports so queryClient.js and sync.js can both read
// it without an import cycle.
const KEY = "bm.syncPaused";
const listeners = new Set();

export function isSyncPaused() {
  return getRaw(KEY) === "1";
}

export function setSyncPaused(paused) {
  if (paused) setRaw(KEY, "1");
  else removeRaw(KEY);
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSyncPaused() {
  return useSyncExternalStore(subscribe, isSyncPaused, isSyncPaused);
}
