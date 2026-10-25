import { useCallback } from "react";
import { useBookmarks as useBookmarkIds, toggleBookmark as toggleBookmarkStore, useBookmarkedOrgs as useBookmarkedOrgNames, toggleOrgBookmark as toggleOrgBookmarkStore } from "../lib/store.js";
import { schedulePush, flushPush } from "../lib/sync.js";
import { tenderKeyOf } from "../lib/tenderKey.js";
import { useResolvedTenders } from "./useResolvedTenders.js";

// flushPush() (not the 1s-debounced schedulePush()) fires right away, in the
// foreground, from the tap itself -- the server's push-notification pass
// (apns_push.py via api_server.py) only knows about a bookmark once it's in
// client_user_sync, so a bookmark that's still sitting in the debounce
// window (or worse, waiting on the AppState "background" handler, which
// iOS does not reliably give a plain JS listener enough execution time to
// finish a network call before suspending the app) can miss every
// server-side alert for whatever was just bookmarked if the user closes the
// app within that window. flushPush() still marks dirty and cancels any
// pending timer first, so if this call itself loses the network race, the
// existing debounce/background/foreground fallbacks still pick it up.
//
// Bookmarks are canonical portal tender ids (lib/tenderKey.js): toggle and
// isBookmarked take the tender object (or its tender_id), never the row id.
export function useBookmarkToggle() {
  const ids = useBookmarkIds();
  const toggle = useCallback((t) => {
    const nowOn = toggleBookmarkStore(t);
    schedulePush();
    flushPush().catch(() => {});
    return nowOn;
  }, []);
  return { bookmarkedIds: ids, isBookmarked: (t) => ids.has(tenderKeyOf(t)), toggle };
}

export function useOrgBookmarkToggle() {
  const names = useBookmarkedOrgNames();
  const toggle = useCallback((name) => {
    const nowOn = toggleOrgBookmarkStore(name);
    schedulePush();
    flushPush().catch(() => {});
    return nowOn;
  }, []);
  return { bookmarkedOrgNames: names, isOrgBookmarked: (name) => names.has(name), toggle };
}

export function useBookmarkedTenders() {
  const { bookmarkedIds } = useBookmarkToggle();
  const { tenders, isLoading } = useResolvedTenders([...bookmarkedIds]);
  return { tenders, isLoading };
}
