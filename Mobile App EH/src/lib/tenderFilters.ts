import type { Tender } from '../fixtures/tenders';

// Pure filter logic for the Tenders tab. Independent of the data source, so it carries
// over unchanged when real tenders replace the Phase 1 fixtures.

export const MAX_CUSTOM_FILTERS = 2;

export type BaseFilter = 'all' | 'soon';

export const BASE_FILTERS: { key: BaseFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'soon', label: 'Closing < 5 days' },
];

export type CustomFilterKey = string; // 'cat:Civil works' | 'loc:Pune' | 'val:gt25' | 'val:lt10' | 'prebid'

/** Days until close, read from the countdown text ("2d 4h", "6h", "13d"). */
export function daysUntilClose(t: Tender): number {
  const d = /(\d+)\s*d/.exec(t.closeIn);
  return d ? parseInt(d[1], 10) : 0;
}

export const closesWithinDays = (t: Tender, days: number) =>
  daysUntilClose(t) <= days;

export const valueInCrores = (t: Tender) =>
  parseFloat(t.value.replace(/[^0-9.]/g, '')) || 0;

export function customLabel(key: CustomFilterKey): string {
  if (key.startsWith('cat:') || key.startsWith('loc:')) return key.slice(4);
  if (key === 'val:gt25') return 'Above ₹25 Cr';
  if (key === 'val:lt10') return 'Below ₹10 Cr';
  if (key === 'prebid') return 'Has pre-bid';
  return key;
}

export function customPass(t: Tender, key: CustomFilterKey): boolean {
  if (key.startsWith('cat:')) return t.category === key.slice(4);
  if (key.startsWith('loc:')) return t.location === key.slice(4);
  if (key === 'val:gt25') return valueInCrores(t) > 25;
  if (key === 'val:lt10') return valueInCrores(t) < 10;
  if (key === 'prebid') return t.prebid !== '—' && t.prebid !== '';
  return true;
}

export type FilterMenuGroup = {
  heading: string;
  options: { key: CustomFilterKey; label: string }[];
};

/** Options offered by "+ Filter", built from the tenders currently in scope. */
export function filterMenuGroups(
  scoped: Tender[],
  active: CustomFilterKey[],
): FilterMenuGroup[] {
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  const groups: FilterMenuGroup[] = [
    {
      heading: 'Category',
      options: uniq(scoped.map(t => t.category)).map(c => ({
        key: `cat:${c}`,
        label: c,
      })),
    },
    {
      heading: 'Location',
      options: uniq(scoped.map(t => t.location)).map(l => ({
        key: `loc:${l}`,
        label: l,
      })),
    },
    {
      heading: 'Tender value',
      options: [
        { key: 'val:gt25', label: 'Above ₹25 Cr' },
        { key: 'val:lt10', label: 'Below ₹10 Cr' },
      ],
    },
    {
      heading: 'Other',
      options: [{ key: 'prebid', label: 'Has pre-bid meeting' }],
    },
  ];
  return groups
    .map(g => ({
      ...g,
      options: g.options.filter(o => !active.includes(o.key)),
    }))
    .filter(g => g.options.length > 0);
}

export type TenderQuery = {
  portal: string;
  search: string;
  base: BaseFilter;
  custom: CustomFilterKey[];
  /** Star toggle: show only bookmarked tenders. */
  bookmarkedOnly: boolean;
  isBookmarked: (id: string) => boolean;
};

export function applyTenderQuery(all: Tender[], q: TenderQuery): Tender[] {
  const needle = q.search.trim().toLowerCase();
  return all.filter(t => {
    if (t.portal !== q.portal) return false;
    if (needle && !`${t.title} ${t.org} ${t.id}`.toLowerCase().includes(needle))
      return false;
    if (q.bookmarkedOnly && !q.isBookmarked(t.id)) return false;
    if (q.base === 'soon' && t.state === 'ok') return false;
    return q.custom.every(k => customPass(t, k));
  });
}

export type OrgGroup = {
  name: string;
  portals: string[];
  tenders: Tender[];
  closingSoon: number;
};

export type OrgQueryOptions = {
  /** Ribbon toggle: show only bookmarked organisations. */
  bookmarkedOnly?: boolean;
  isOrgBookmarked?: (name: string) => boolean;
};

export function groupByOrg(
  all: Tender[],
  /** `null` groups across every portal. */
  portal: string | null,
  search = '',
  opts: OrgQueryOptions = {},
): OrgGroup[] {
  const needle = search.trim().toLowerCase();
  const map = new Map<string, OrgGroup>();
  all
    .filter(t => portal === null || t.portal === portal)
    .forEach(t => {
      const g = map.get(t.org) ?? {
        name: t.org,
        portals: [],
        tenders: [],
        closingSoon: 0,
      };
      if (!g.portals.includes(t.portal)) g.portals.push(t.portal);
      g.tenders.push(t);
      if (t.state !== 'ok') g.closingSoon += 1;
      map.set(t.org, g);
    });
  return [...map.values()]
    .filter(g => !needle || g.name.toLowerCase().includes(needle))
    .filter(
      g => !opts.bookmarkedOnly || (opts.isOrgBookmarked?.(g.name) ?? false),
    )
    .sort(
      (a, b) =>
        b.tenders.length - a.tenders.length || a.name.localeCompare(b.name),
    );
}
