import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

// Derives the distinct portal/website list from /client/organizations (which
// carries website_id + website_name on every row) — no dedicated endpoint
// for "list websites" exists on /client/*, so this pages through once and
// dedupes client-side. Cached like any other query; a page_size of 100 keeps
// this to a handful of requests even for a few hundred organizations.
export function useWebsites() {
  return useQuery({
    queryKey: ['websites'],
    queryFn: async () => {
      const map = new Map();
      let page = 1;
      let pages = 1;
      do {
        const payload = await api.organizations({ page, page_size: 100 });
        (payload.items || []).forEach((row) => {
          if (row.website_id != null && !map.has(row.website_id)) {
            map.set(row.website_id, { id: row.website_id, name: row.website_name });
          }
        });
        pages = Math.max(1, Number(payload.pages) || 1);
        page += 1;
      } while (page <= pages && page <= 20);
      return [...map.values()];
    },
    staleTime: 5 * 60_000,
  });
}
