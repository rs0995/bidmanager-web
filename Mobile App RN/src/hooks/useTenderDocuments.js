import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { isSyncPaused } from "../lib/syncPause.js";

export function useTenderDocuments(id) {
  return useQuery({
    queryKey: ["tenderDocuments", Number(id)],
    queryFn: () => api.tenderDocuments(id),
    enabled: () => id != null && !isSyncPaused(),
  });
}
