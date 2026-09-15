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
      const addRows = (items) => {
        (items || []).forEach((row) => {
          if (row.website_id != null && !map.has(row.website_id)) {
            map.set(row.website_id, { id: row.website_id, name: row.website_name });
          }
        });
      };

      const first = await api.organizations({ page: 1, page_size: 100 });
      addRows(first.items);
      const pages = Math.min(Math.max(1, Number(first.pages) || 1), 20);
      if (pages > 1) {
        // Page 1 is already in hand — fetch the rest concurrently instead of
        // one-at-a-time, since each round trip otherwise adds to the visible
        // delay before the portal picker has data to show.
        const rest = await Promise.all(
          Array.from({ length: pages - 1 }, (_, i) => api.organizations({ page: i + 2, page_size: 100 })),
        );
        rest.forEach((payload) => addRows(payload.items));
      }
      return [...map.values()];
    },
    staleTime: 5 * 60_000,
  });
}
