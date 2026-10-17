import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export const WEBSITES_QUERY_KEY = ["websites"];

// Every portal on the server (/client/websites), so a newly added portal
// shows before anything is scraped and a deleted one disappears. Exported
// standalone so it can be prefetched at boot (see _layout.tsx).
export async function fetchWebsites() {
  const rows = await api.websites();
  return (rows || []).map((w) => ({ id: w.id, name: w.name }));
}

export function useWebsites() {
  return useQuery({
    queryKey: WEBSITES_QUERY_KEY,
    queryFn: fetchWebsites,
    staleTime: 5 * 60_000,
  });
}
