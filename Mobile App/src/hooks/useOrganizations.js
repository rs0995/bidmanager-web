import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { recordOrgIds } from '../lib/store.js';

// An organisation list for one portal is a bounded, moderate-sized set (not
// the potentially-huge Tenders list), so fetch every page up front rather
// than driving lazy infinite-scroll — same pattern as hooks/useWebsites.js.
// (A prior useInfiniteQuery version never had its fetchNextPage() called by
// the UI, so only the first 50 organisations ever loaded — see OrganizationList.jsx.)
export function useOrganizations(filters) {
  return useQuery({
    queryKey: ['organizations', filters],
    queryFn: async () => {
      const items = [];
      let page = 1;
      let pages = 1;
      do {
        const payload = await api.organizations({ ...filters, page, page_size: 100 });
        items.push(...(payload.items || []));
        pages = Math.max(1, Number(payload.pages) || 1);
        page += 1;
      } while (page <= pages && page <= 50);
      recordOrgIds(items); // feed the org name->id map for bookmarkedOrgIds sync
      return items;
    },
  });
}
