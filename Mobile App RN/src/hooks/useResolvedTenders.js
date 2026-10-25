import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../lib/queryClient.js";
import { canonTenderId, resolveTenderIds } from "../lib/tenderKey.js";
import { isSyncPaused } from "../lib/syncPause.js";

// Loads the current tender rows for a list of portal tender ids in one
// /client/tenders/resolve call (ids no longer in the server DB are dropped).
// Keyed under ["tenders", ...] so the existing ["tenders"] invalidations
// refresh it, and each row also primes the ["tender", id] cache the detail
// screen reads, so opening a card afterwards is instant.
export function useResolvedTenders(tenderIds, staleTime = 30_000) {
  const keys = [...new Set((tenderIds || []).map(canonTenderId).filter(Boolean))].sort();
  const query = useQuery({
    queryKey: ["tenders", "byTenderId", keys.join("|")],
    queryFn: async () => {
      const map = await resolveTenderIds(keys);
      Object.values(map).forEach((t) => {
        if (t && t.id != null) queryClient.setQueryData(["tender", Number(t.id)], t);
      });
      return map;
    },
    enabled: () => keys.length > 0 && !isSyncPaused(),
    staleTime,
  });
  const map = query.data || {};
  return {
    tenders: keys.map((k) => map[k]).filter(Boolean),
    isLoading: keys.length > 0 && query.isLoading,
    dataUpdatedAt: query.dataUpdatedAt,
  };
}
