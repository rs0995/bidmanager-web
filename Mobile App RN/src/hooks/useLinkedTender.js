import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { canonTenderId, resolveTenderIds } from "../lib/tenderKey.js";
import { isSyncPaused } from "../lib/syncPause.js";

// A project keeps a snapshot of its source tender (see createProjectFromTender)
// plus the tender's portal id (source_tender_id) -- its identity. That id is
// resolved to the tender's current row with /client/tenders/resolve (never a
// title search), then read through the same ["tender", id] cache the tender
// screen uses, so deadline/pre-bid/corrigendum changes show up on project
// screens without rewriting the synced project. source_tender_db_id is only a
// cached row handle (the server refills it on sync) and is not trusted here,
// since a server DB restore re-numbers rows. Returns null when unlinked /
// unresolved / still loading -- callers fall back to the snapshot fields.
export function useLinkedTender(project) {
  const key = canonTenderId(project?.source_tender_id);

  const { data: resolvedId } = useQuery({
    queryKey: ["tenderIdByTenderId", key],
    queryFn: async () => {
      const hit = (await resolveTenderIds([key]))[key];
      return hit ? hit.id : null;
    },
    enabled: () => key !== "" && !isSyncPaused(),
    staleTime: 5 * 60 * 1000,
  });

  const dbId = resolvedId ?? null;
  const { data } = useQuery({
    queryKey: ["tender", Number(dbId)],
    queryFn: () => api.tender(dbId),
    enabled: () => dbId != null && !isSyncPaused(),
    staleTime: 5 * 60 * 1000,
  });
  return data || null;
}
