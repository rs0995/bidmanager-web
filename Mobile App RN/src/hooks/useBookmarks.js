import { useCallback } from "react";
import { useQueries } from "@tanstack/react-query";
import { useBookmarks as useBookmarkIds, toggleBookmark as toggleBookmarkStore, useBookmarkedOrgs as useBookmarkedOrgNames, toggleOrgBookmark as toggleOrgBookmarkStore } from "../lib/store.js";
import { schedulePush } from "../lib/sync.js";
import { api } from "../lib/api.js";

export function useBookmarkToggle() {
  const ids = useBookmarkIds();
  const toggle = useCallback((id) => {
    const nowOn = toggleBookmarkStore(id);
    schedulePush();
    return nowOn;
  }, []);
  return { bookmarkedIds: ids, isBookmarked: (id) => ids.has(Number(id)), toggle };
}

export function useOrgBookmarkToggle() {
  const names = useBookmarkedOrgNames();
  const toggle = useCallback((name) => {
    const nowOn = toggleOrgBookmarkStore(name);
    schedulePush();
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
