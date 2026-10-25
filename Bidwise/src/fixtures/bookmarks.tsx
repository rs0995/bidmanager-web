import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { initialBookmarks } from './tenders';

// Phase 1 only: in-memory bookmarks shared by Tenders, org and detail screens.
// Replaced by lib/store.ts (persisted, synced) in Phase 2D.

export type BookmarksCtx = {
  isBookmarked: (id: string) => boolean;
  /** Toggles a tender bookmark; returns true when it is now bookmarked. */
  toggle: (id: string) => boolean;
  count: number;
  isOrgBookmarked: (name: string) => boolean;
  /** Toggles an organisation bookmark; returns true when it is now bookmarked. */
  toggleOrg: (name: string) => boolean;
  orgCount: number;
};

export const BookmarksContext = createContext<BookmarksCtx>({
  isBookmarked: () => false,
  toggle: () => false,
  count: 0,
  isOrgBookmarked: () => false,
  toggleOrg: () => false,
  orgCount: 0,
});

// Organisations bookmarked at the start of the session.
const initialOrgBookmarks = ['Maharashtra Jeevan Pradhikaran'];

function useToggleSet(initial: string[]) {
  const [set, setSet] = useState<Set<string>>(new Set(initial));
  const ref = useRef(set);
  const toggle = useCallback((key: string) => {
    const next = new Set(ref.current);
    const added = !next.has(key);
    if (added) {
      next.add(key);
    } else {
      next.delete(key);
    }
    ref.current = next;
    setSet(next);
    return added;
  }, []);
  return { set, toggle };
}

export function BookmarksProvider({ children }: { children: React.ReactNode }) {
  const tenders = useToggleSet(initialBookmarks);
  const orgs = useToggleSet(initialOrgBookmarks);

  const value = useMemo<BookmarksCtx>(
    () => ({
      isBookmarked: id => tenders.set.has(id),
      toggle: tenders.toggle,
      count: tenders.set.size,
      isOrgBookmarked: name => orgs.set.has(name),
      toggleOrg: orgs.toggle,
      orgCount: orgs.set.size,
    }),
    [tenders.set, tenders.toggle, orgs.set, orgs.toggle],
  );

  return (
    <BookmarksContext.Provider value={value}>
      {children}
    </BookmarksContext.Provider>
  );
}

export const useBookmarks = () => useContext(BookmarksContext);
