import { locationOptions } from '../src/data/tenderSource';
import { tenders } from '../src/fixtures/tenders';
import { parseCrores } from '../src/lib/format';
import { listTenders } from '../src/lib/tenderList';
import {
  closingThisWeek,
  NO_SHEET_FILTERS,
  passesSheetFilters,
  sheetFilterCount,
} from '../src/lib/tenderFilters';

const t = {
  ...tenders[0],
  category: 'Civil Works',
  location: 'Pune',
  value: '₹30.00 Cr',
  docs: [],
  docCount: 0,
  closeIn: '2d 4h',
};

it('counts the filters that are set; a value range counts once', () => {
  expect(sheetFilterCount(NO_SHEET_FILTERS)).toBe(0);
  expect(
    sheetFilterCount({
      category: 'Works',
      location: 'Pune',
      minCr: '5',
      maxCr: '20',
    }),
  ).toBe(3);
  expect(sheetFilterCount({ ...NO_SHEET_FILTERS, maxCr: 'abc' })).toBe(0);
});

it('matches category and location as text', () => {
  expect(
    passesSheetFilters(t, { ...NO_SHEET_FILTERS, category: 'Works' }),
  ).toBe(true);
  expect(
    passesSheetFilters(t, { ...NO_SHEET_FILTERS, category: 'Goods' }),
  ).toBe(false);
  expect(
    passesSheetFilters(t, { ...NO_SHEET_FILTERS, location: 'Nagpur' }),
  ).toBe(false);
  // Live pages are already filtered by the server on these.
  expect(
    passesSheetFilters(t, { ...NO_SHEET_FILTERS, location: 'Nagpur' }, true),
  ).toBe(true);
});

it('filters by a typed value range in crores', () => {
  // The tender is worth ₹30 Cr.
  const range = (minCr: string, maxCr: string) =>
    passesSheetFilters(t, { ...NO_SHEET_FILTERS, minCr, maxCr });
  expect(range('25', '')).toBe(true);
  expect(range('', '10')).toBe(false);
  expect(range('10', '40')).toBe(true);
  expect(range('31', '')).toBe(false);
  expect(range('', '')).toBe(true);
  // Live pages: the server applied the range to every tender, so it isn't re-checked.
  expect(
    passesSheetFilters(t, { ...NO_SHEET_FILTERS, maxCr: '10' }, true),
  ).toBe(true);
});

it('lists only the locations in the data, most tenders first', () => {
  const at = (location: string) => ({ ...t, location });
  expect(
    locationOptions([
      at('Pune'),
      at('Nagpur'),
      at('Pune'),
      at(' '),
      at('—'),
      at('Mumbai'),
    ]),
  ).toEqual([
    { value: 'Pune', count: 2 },
    { value: 'Mumbai', count: 1 },
    { value: 'Nagpur', count: 1 },
  ]);
});

it('sorts the demo list by EMD, highest first', () => {
  const rows = listTenders(tenders, {
    portal: null,
    org: null,
    search: '',
    savedOnly: false,
    closingSoon: false,
    sort: 'emd',
    isSaved: () => false,
  });
  const emd = rows.map(r => parseCrores(r.emd));
  expect(emd).toEqual([...emd].sort((x, y) => y - x));
  expect(emd[0]).toBeGreaterThan(emd[emd.length - 1]);
});

it('closing this week: bookmarked, still open, within 7 days, soonest first (as BM Pro)', () => {
  const at = (id: string, closeIn: string) => ({ ...t, id, closeIn });
  const rows = [
    at('a', '6d'),
    at('b', '6h'),
    at('c', 'Closed'), // already closed: not this week
    at('d', '9d'), // too far
    at('e', '2d 4h'),
    at('f', '1d'), // not bookmarked
  ];
  const saved = new Set(['a', 'b', 'c', 'd', 'e']);
  expect(closingThisWeek(rows, id => saved.has(id)).map(x => x.id)).toEqual([
    'b',
    'e',
    'a',
  ]);
});
