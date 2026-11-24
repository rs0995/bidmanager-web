import type { Tender } from '../fixtures/tenders';
import { hoursUntilClose } from './deadlines';
import { parseCrores } from './format';

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

/**
 * The Dashboard's "Closing this week" (as BM Pro): bookmarked tenders still open and
 * closing within 7 days, soonest first. The tile counts these; its page lists them.
 */
export const closingThisWeek = (
  tenders: Tender[],
  isBookmarked: (id: string) => boolean,
) =>
  tenders
    .filter(
      t =>
        isBookmarked(t.id) && t.closeIn !== 'Closed' && closesWithinDays(t, 7),
    )
    .sort((a, b) => hoursUntilClose(a.closeIn) - hoursUntilClose(b.closeIn));

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

/** The portals' only tender categories. */
export const CATEGORIES = ['Works', 'Services', 'Goods'] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * The Tenders tab's Filter sheet: department, category and location pick-lists, tender
 * value range.
 */
export type SheetFilters = {
  /** '' = any; an organisation (department) of the chosen portal. */
  department: string;
  /** '' = any. Text match, as the server's `category` / `location` filters. */
  category: '' | Category;
  /** '' = any; one of the locations in the data. */
  location: string;
  /** Tender value range in crores, typed by hand; '' = no limit. */
  minCr: string;
  maxCr: string;
};

export const NO_SHEET_FILTERS: SheetFilters = {
  department: '',
  category: '',
  location: '',
  minCr: '',
  maxCr: '',
};

/** A typed amount: digits and one dot; anything else (or nothing) is no limit. */
export function parseLimit(text: string): number | null {
  const n = parseFloat(text.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** How many filters are set, for the Filter button's badge (the value range counts once). */
export function sheetFilterCount(f: SheetFilters): number {
  return [
    f.department,
    f.category,
    f.location.trim(),
    parseLimit(f.minCr) !== null || parseLimit(f.maxCr) !== null,
  ].filter(Boolean).length;
}

const matches = (field: string, needle: string) =>
  !needle.trim() || field.toLowerCase().includes(needle.trim().toLowerCase());

/**
 * Whether a tender passes the sheet's filters. `serverSide` skips the ones the server
 * already applied to a live page of results (department, category, location, value
 * range).
 */
export function passesSheetFilters(
  t: Tender,
  f: SheetFilters,
  serverSide = false,
): boolean {
  if (serverSide) return true;
  if (f.department && t.org !== f.department) return false;
  if (!matches(t.category, f.category) || !matches(t.location, f.location))
    return false;
  const min = parseLimit(f.minCr);
  const max = parseLimit(f.maxCr);
  if (min !== null || max !== null) {
    const cr = parseCrores(t.value);
    if (min !== null && cr < min) return false;
    if (max !== null && cr > max) return false;
  }
  return true;
}
