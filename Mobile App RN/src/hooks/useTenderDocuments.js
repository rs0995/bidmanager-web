import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export function useTenderDocuments(id) {
  return useQuery({
    queryKey: ["tenderDocuments", Number(id)],
    queryFn: () => api.tenderDocuments(id),
    enabled: id != null,
  });
}
