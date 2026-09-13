import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { recordOrgIds } from "../lib/store.js";

export function useOrganizations(filters) {
  return useQuery({
    queryKey: ["organizations", filters],
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
      recordOrgIds(items);
      return items;
    },
  });
}
