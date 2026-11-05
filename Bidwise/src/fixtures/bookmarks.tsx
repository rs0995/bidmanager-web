import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { initialBookmarks } from './tenders';
import { useToast } from '../components/feedback/Toast';

/** The server's wording (API_CHANGES.md §1): a project's tender stays bookmarked. */
export const PROJECT_BOOKMARK_MESSAGE =
  "Tenders in projects can't be removed from bookmarks. Remove the project first.";

// Sample data: the demo projects' tenders, published by the demo ProjectsProvider
// (which sits inside this provider, so it can't be read from here directly).
let projectTenders = new Set<string>();
export function setProjectTenderIds(ids: string[]) {
  projectTenders = new Set(ids);
}

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
  const { set: tenderSet, toggle: toggleTender } =
    useToggleSet(initialBookmarks);
  const orgs = useToggleSet(initialOrgBookmarks);
  const toast = useToast();

  const value = useMemo<BookmarksCtx>(
    () => ({
      isBookmarked: id => tenderSet.has(id),
      toggle: id => {
        if (tenderSet.has(id) && projectTenders.has(id)) {
          toast.show(PROJECT_BOOKMARK_MESSAGE);
          return true;
        }
        return toggleTender(id);
      },
      count: tenderSet.size,
      isOrgBookmarked: name => orgs.set.has(name),
      toggleOrg: orgs.toggle,
      orgCount: orgs.set.size,
    }),
    [tenderSet, toggleTender, orgs.set, orgs.toggle, toast],
  );

  return (
    <BookmarksContext.Provider value={value}>
      {children}
    </BookmarksContext.Provider>
  );
}

export const useBookmarks = () => useContext(BookmarksContext);
