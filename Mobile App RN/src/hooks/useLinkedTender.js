import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { isSyncPaused } from "../lib/syncPause.js";

// A project keeps a snapshot of its source tender (see createProjectFromTender)
// plus the tender's ids. This reads the live tender through the same
// ["tender", id] cache the tender screen uses, so deadline/pre-bid/corrigendum
// changes show up on project screens without rewriting the synced project.
// Projects created elsewhere (desktop client) only carry the portal tender id
// string, so it is resolved to the numeric id with one search, cached for the
// session. Returns null when unlinked / unresolved / still loading -- callers
// fall back to the snapshot fields.
export function useLinkedTender(project) {
  const storedId = project?.source_tender_db_id ?? null;
  const portalId = String(project?.source_tender_id || "").trim();

  const { data: resolvedId } = useQuery({
    queryKey: ["tenderIdByPortalId", portalId.toUpperCase()],
    queryFn: async () => {
      const page = await api.tenders({ q: portalId, page_size: 10 });
      const hit = (page.items || []).find((t) => String(t.tender_id || "").trim().toUpperCase() === portalId.toUpperCase());
      return hit ? hit.id : null;
    },
    enabled: () => storedId == null && portalId !== "" && !isSyncPaused(),
    staleTime: 24 * 60 * 60 * 1000,
  });

  const dbId = storedId ?? resolvedId ?? null;
  const { data } = useQuery({
    queryKey: ["tender", Number(dbId)],
    queryFn: () => api.tender(dbId),
    enabled: () => dbId != null && !isSyncPaused(),
    staleTime: 5 * 60 * 1000,
  });
  return data || null;
}
