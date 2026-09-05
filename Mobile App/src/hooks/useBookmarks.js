import { useCallback } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useBookmarks as useBookmarkIds, toggleBookmark as toggleBookmarkStore, useBookmarkedOrgs as useBookmarkedOrgNames, toggleOrgBookmark as toggleOrgBookmarkStore } from '../lib/store.js';
import { schedulePush } from '../lib/sync.js';
import { api } from '../lib/api.js';

// Exposes the bookmarked id set plus a toggle that updates local storage
// immediately (optimistic) and debounced-pushes to /client/sync.
export function useBookmarkToggle() {
  const ids = useBookmarkIds();
  const toggle = useCallback((id) => {
    const nowOn = toggleBookmarkStore(id);
    schedulePush();
    return nowOn;
  }, []);
  return { bookmarkedIds: ids, isBookmarked: (id) => ids.has(Number(id)), toggle };
}

// Same shape as useBookmarkToggle(), for organizations (keyed by name, not
// id — matches the desktop Client UI's bookmarkedOrgs field, see sync.js).
export function useOrgBookmarkToggle() {
  const names = useBookmarkedOrgNames();
  const toggle = useCallback((name) => {
    const nowOn = toggleOrgBookmarkStore(name);
    schedulePush();
    return nowOn;
  }, []);
  return { bookmarkedOrgNames: names, isOrgBookmarked: (name) => names.has(name), toggle };
}

// Fetches full tender rows for every bookmarked id (small curated set, so a
// query-per-id is fine at this scale) for the Bookmarks screen and the
// dashboard's "Needs attention" / deadline groups.
export function useBookmarkedTenders() {
  const { bookmarkedIds } = useBookmarkToggle();
  const ids = [...bookmarkedIds];
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['tender', id],
      queryFn: () => api.tender(id),
      staleTime: 30_000,
    })),
  });
  return {
    tenders: results.map((r) => r.data).filter(Boolean),
    isLoading: ids.length > 0 && results.some((r) => r.isLoading),
  };
}
