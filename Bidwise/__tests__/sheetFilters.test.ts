import { tenders } from '../src/fixtures/tenders';
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

it('counts the filters that are set', () => {
  expect(sheetFilterCount(NO_SHEET_FILTERS)).toBe(0);
  expect(
    sheetFilterCount({
      ...NO_SHEET_FILTERS,
      category: 'works',
      value: 'gt25',
      closingSoon: true,
    }),
  ).toBe(3);
});

it('matches category and location as text, and documents', () => {
  expect(
    passesSheetFilters(t, { ...NO_SHEET_FILTERS, category: 'works' }),
  ).toBe(true);
  expect(
    passesSheetFilters(t, { ...NO_SHEET_FILTERS, location: 'nagpur' }),
  ).toBe(false);
  expect(passesSheetFilters(t, { ...NO_SHEET_FILTERS, docs: 'with' })).toBe(
    false,
  );
  expect(passesSheetFilters(t, { ...NO_SHEET_FILTERS, docs: 'without' })).toBe(
    true,
  );
  // Live pages are already filtered by the server on these.
  expect(
    passesSheetFilters(t, { ...NO_SHEET_FILTERS, location: 'nagpur' }, true),
  ).toBe(true);
});

it('filters by value and closing within 5 days', () => {
  expect(passesSheetFilters(t, { ...NO_SHEET_FILTERS, value: 'gt25' })).toBe(
    true,
  );
  expect(passesSheetFilters(t, { ...NO_SHEET_FILTERS, value: 'lt10' })).toBe(
    false,
  );
  expect(
    passesSheetFilters(t, { ...NO_SHEET_FILTERS, closingSoon: true }),
  ).toBe(true);
  expect(
    passesSheetFilters(
      { ...t, closeIn: '12d' },
      { ...NO_SHEET_FILTERS, closingSoon: true },
    ),
  ).toBe(false);
  expect(
    passesSheetFilters(
      { ...t, closeIn: 'Closed' },
      { ...NO_SHEET_FILTERS, closingSoon: true },
    ),
  ).toBe(false);
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
