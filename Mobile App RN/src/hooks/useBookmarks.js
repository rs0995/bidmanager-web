import { useCallback } from "react";
import { useQueries } from "@tanstack/react-query";
import { useBookmarks as useBookmarkIds, toggleBookmark as toggleBookmarkStore, useBookmarkedOrgs as useBookmarkedOrgNames, toggleOrgBookmark as toggleOrgBookmarkStore } from "../lib/store.js";
import { schedulePush, flushPush } from "../lib/sync.js";
import { api } from "../lib/api.js";

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
export function useBookmarkToggle() {
  const ids = useBookmarkIds();
  const toggle = useCallback((id) => {
    const nowOn = toggleBookmarkStore(id);
    schedulePush();
    flushPush().catch(() => {});
    return nowOn;
  }, []);
  return { bookmarkedIds: ids, isBookmarked: (id) => ids.has(Number(id)), toggle };
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
  const ids = [...bookmarkedIds];
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["tender", id],
      queryFn: () => api.tender(id),
      staleTime: 30_000,
    })),
  });
  return {
    tenders: results.map((r) => r.data).filter(Boolean),
    isLoading: ids.length > 0 && results.some((r) => r.isLoading),
  };
}
