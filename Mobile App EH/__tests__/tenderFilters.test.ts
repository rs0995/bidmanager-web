import { tenders } from '../src/fixtures/tenders';
import {
  applyTenderQuery,
  closesWithinDays,
  customLabel,
  customPass,
  filterMenuGroups,
  groupByOrg,
  MAX_CUSTOM_FILTERS,
} from '../src/lib/tenderFilters';

const none = () => false;
const base = {
  portal: 'MahaTenders',
  search: '',
  base: 'all' as const,
  custom: [],
  bookmarkedOnly: false,
  isBookmarked: none,
};

describe('tender filters', () => {
  it('scopes to exactly one portal', () => {
    const rows = applyTenderQuery(tenders, base);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(t => t.portal === 'MahaTenders')).toBe(true);
  });

  it('searches title, org and id', () => {
    expect(
      applyTenderQuery(tenders, { ...base, search: 'chiplun' }),
    ).toHaveLength(1);
    expect(
      applyTenderQuery(tenders, { ...base, search: 'jeevan' }).length,
    ).toBe(2);
    expect(
      applyTenderQuery(tenders, { ...base, search: 'MJP/2024/WS/351' }),
    ).toHaveLength(1);
  });

  it('applies the bookmark toggle and the closing-soon filter', () => {
    const bm = applyTenderQuery(tenders, {
      ...base,
      bookmarkedOnly: true,
      isBookmarked: id => id === 'MJP/2024/WS/318',
    });
    expect(bm.map(t => t.id)).toEqual(['MJP/2024/WS/318']);
    const soon = applyTenderQuery(tenders, { ...base, base: 'soon' });
    expect(soon.every(t => t.state !== 'ok')).toBe(true);
  });

  it('ANDs custom filters and labels them', () => {
    const t = tenders.find(x => x.id === 'MJP/2024/WS/318')!;
    expect(customPass(t, 'cat:Water supply')).toBe(true);
    expect(customPass(t, 'val:gt25')).toBe(true);
    expect(customPass(t, 'val:lt10')).toBe(false);
    expect(customLabel('val:gt25')).toBe('Above ₹25 Cr');
    const rows = applyTenderQuery(tenders, {
      ...base,
      custom: ['cat:Water supply', 'val:gt25'],
    });
    expect(rows.map(x => x.id)).toEqual(['MJP/2024/WS/318']);
  });

  it('caps custom filters at two and drops used options from the menu', () => {
    expect(MAX_CUSTOM_FILTERS).toBe(2);
    const scoped = tenders.filter(t => t.portal === 'MahaTenders');
    const menu = filterMenuGroups(scoped, ['cat:Civil works']);
    const category = menu.find(g => g.heading === 'Category')!;
    expect(category.options.map(o => o.key)).not.toContain('cat:Civil works');
    expect(menu.map(g => g.heading)).toEqual([
      'Category',
      'Location',
      'Tender value',
      'Other',
    ]);
  });

  it('groups organisations by portal, biggest first', () => {
    const groups = groupByOrg(tenders, 'MahaTenders');
    expect(groups[0].tenders.length).toBeGreaterThanOrEqual(
      groups[groups.length - 1].tenders.length,
    );
    expect(groups.every(g => g.portals.join() === 'MahaTenders')).toBe(true);
    expect(groupByOrg(tenders, 'MahaTenders', 'konkan')).toHaveLength(1);
  });

  it('filters organisations by bookmark', () => {
    const all = groupByOrg(tenders, 'MahaTenders');
    expect(all.length).toBe(2);
    const only = groupByOrg(tenders, 'MahaTenders', '', {
      bookmarkedOnly: true,
      isOrgBookmarked: n => n === 'Maharashtra Jeevan Pradhikaran',
    });
    expect(only.map(g => g.name)).toEqual(['Maharashtra Jeevan Pradhikaran']);
    expect(
      groupByOrg(tenders, 'MahaTenders', '', {
        bookmarkedOnly: true,
        isOrgBookmarked: () => false,
      }),
    ).toHaveLength(0);
  });

  it('reads the closing countdown', () => {
    const t = (closeIn: string) => ({ ...tenders[0], closeIn });
    expect(closesWithinDays(t('6h'), 7)).toBe(true);
    expect(closesWithinDays(t('2d 4h'), 7)).toBe(true);
    expect(closesWithinDays(t('13d'), 7)).toBe(false);
  });
});
