import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export const WEBSITES_QUERY_KEY = ["websites"];

// Exported standalone (not just inlined in useWebsites) so it can also be
// used with queryClient.prefetchQuery() at app boot (see lib/bootstrap.js)
// -- this paginated fetch is the actual source of the ~1s SiteScope lag on
// first visit to the Tenders tab, since nothing triggered it before landing
// there. Prefetching right after sign-in means the query is already
// resolved (or resolving) by the time the user navigates to it.
export async function fetchWebsites() {
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
}

export function useWebsites() {
  return useQuery({
    queryKey: WEBSITES_QUERY_KEY,
    queryFn: fetchWebsites,
    staleTime: 5 * 60_000,
  });
}
