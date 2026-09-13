import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export function useWebsites() {
  return useQuery({
    queryKey: ["websites"],
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
