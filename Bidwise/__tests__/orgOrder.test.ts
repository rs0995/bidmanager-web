import { byPortalOrder } from '../src/data/tenderSource';
import type { ServerOrg } from '../src/lib/api';

// The Organisations tab lists each portal's organisations in the portal's own order.

const org = (name: string, over: Partial<ServerOrg> = {}): ServerOrg => ({
  id: 0,
  website_id: 1,
  website_name: 'eTenders CPPP',
  name,
  tenders_url: '',
  tender_count: 0,
  scrape_enabled: true,
  has_saved_job: false,
  last_scraped_at: 0,
  is_available: true,
  ...over,
});
const names = (rows: ServerOrg[]) => [...rows].sort(byPortalOrder).map(o => o.name);

describe('organisations in portal order', () => {
  it('follows the portal’s S.No, not tender counts or names', () => {
    expect(
      names([
        org('Zonal Railway', { site_order: 3, tender_count: 90 }),
        org('Airports Authority', { site_order: 1, tender_count: 2 }),
        org('Mumbai Metro', { site_order: 2, tender_count: 40 }),
      ]),
    ).toEqual(['Airports Authority', 'Mumbai Metro', 'Zonal Railway']);
  });

  it('groups by portal and keeps organisations gone from the portal last', () => {
    expect(
      names([
        org('B2', { website_name: 'Maharashtra', site_order: 2 }),
        org('Gone', { website_name: 'Maharashtra', site_order: 1, is_available: false }),
        org('A1', { website_name: 'CPPP', site_order: 1 }),
        org('B1', { website_name: 'Maharashtra', site_order: 1 }),
      ]),
    ).toEqual(['A1', 'B1', 'B2', 'Gone']);
  });

  it('puts unnumbered rows after numbered ones, most tenders first (the old order)', () => {
    expect(
      names([
        org('Few', { tender_count: 1 }),
        org('Numbered', { site_order: 5, tender_count: 0 }),
        org('Many', { tender_count: 30, site_order: null }),
      ]),
    ).toEqual(['Numbered', 'Many', 'Few']);
  });
});
