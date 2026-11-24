import type { Tender } from '../fixtures/tenders';
import { hoursUntilClose } from './deadlines';
import { parseCrores } from './format';
import {
  closesWithinDays,
  passesSheetFilters,
  type SheetFilters,
} from './tenderFilters';

// Pure list logic for the bidwise Tenders tab (portal across all, saved, closing ≤ 5 days).

export type TenderListQuery = {
  /** `null`: every portal. */
  portal: string | null;
  /** Limit to one organisation (tapped on the Organisations side). */
  org: string | null;
  search: string;
  savedOnly: boolean;
  closingSoon: boolean;
  sort: 'closing' | 'value' | 'emd';
  /** The Filter sheet's choices. */
  filters?: SheetFilters;
  isSaved: (id: string) => boolean;
};

const crores = (t: Tender) => parseFloat(t.value.replace(/[^0-9.]/g, '')) || 0;

export function listTenders(all: Tender[], q: TenderListQuery): Tender[] {
  const needle = q.search.trim().toLowerCase();
  return all
    .filter(t => q.portal === null || t.portal === q.portal)
    .filter(t => q.org === null || t.org === q.org)
    .filter(
      t =>
        !needle ||
        `${t.title} ${t.short} ${t.org} ${t.id}`.toLowerCase().includes(needle),
    )
    .filter(t => !q.savedOnly || q.isSaved(t.id))
    .filter(t => !q.closingSoon || closesWithinDays(t, 5))
    .filter(t => !q.filters || passesSheetFilters(t, q.filters))
    .sort((a, b) =>
      q.sort === 'value'
        ? crores(b) - crores(a)
        : q.sort === 'emd'
        ? parseCrores(b.emd) - parseCrores(a.emd)
        : hoursUntilClose(a.closeIn) - hoursUntilClose(b.closeIn),
    );
}

/** Cycles All portals → each portal → All portals. */
export function nextPortal(current: string | null, portals: string[]) {
  if (current === null) return portals[0] ?? null;
  const i = portals.indexOf(current);
  return i < 0 || i === portals.length - 1 ? null : portals[i + 1];
}
