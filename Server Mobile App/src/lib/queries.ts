import { useCallback, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useToast } from '../components/ui';
import { useSession } from '../state/session';
import type { Api } from './api';

// Data hooks for every screen. Query keys are [server base, name, ...args] so a
// different server never shows another server's cache. Polling only runs while
// the screen is focused (and react-query pauses it while the app is backgrounded).

type Opts = { poll?: number; enabled?: boolean };

export function useServerQuery<T>(
  key: unknown[],
  fn: (api: Api) => Promise<T>,
  { poll, enabled = true }: Opts = {},
): UseQueryResult<T, Error> {
  const { api, base, adminKey, ready } = useSession();
  const focused = useIsFocused();
  return useQuery<T, Error>({
    queryKey: [base, ...key],
    queryFn: () => fn(api),
    enabled: ready && !!adminKey && enabled,
    refetchInterval: poll && focused ? poll : false,
  });
}

/* ── Read hooks ────────────────────────────────────────────────────── */

export const useHealth = () =>
  useServerQuery(['health'], a => a.health(), { poll: 15_000 });
export const useMetrics = () =>
  useServerQuery(['metrics'], a => a.metrics(), { poll: 15_000 });
export const useConfig = () => useServerQuery(['config'], a => a.config());
export const useJobs = (poll = 5_000) =>
  useServerQuery(['jobs'], a => a.jobs(), { poll });
export const useCaptchas = () =>
  useServerQuery(['captchas'], a => a.captchas(), { poll: 8_000 });
export const useCaptchaStats = () =>
  useServerQuery(['captchaStats'], a => a.captchaStats(), { poll: 8_000 });
export const useWebsites = () => useServerQuery(['websites'], a => a.websites());
export const useOrganizations = (websiteId?: number) =>
  useServerQuery(['organizations', websiteId], a => a.organizations(websiteId!), {
    enabled: !!websiteId,
  });
export const useTenders = (websiteId: number | undefined, archived: boolean) =>
  useServerQuery(
    ['tenders', websiteId, archived],
    a => a.tenders(websiteId!, archived),
    { enabled: !!websiteId },
  );
export const useSavedJobs = () =>
  useServerQuery(['savedJobs'], a => a.savedJobs());
export const useSavedJobScope = (id: number) =>
  useServerQuery(['savedJobScope', id], a => a.savedJobScope(id));
export const useSuppressedSites = () =>
  useServerQuery(['suppressed'], a => a.suppressedSites());
export const useUsers = () =>
  useServerQuery(['users'], a => a.users(), { poll: 15_000 });
export const useUser = (id: number) =>
  useServerQuery(['user', id], a => a.user(id), { poll: 15_000 });
export const useOrgs = () =>
  useServerQuery(['orgs'], a => a.orgs(), { poll: 15_000 });
export const useOrg = (id: number) =>
  useServerQuery(['org', id], a => a.org(id), { poll: 15_000 });

/* ── Actions ───────────────────────────────────────────────────────── */

type RunOpts<R> = {
  /** Toast on success (static text, or built from the response). */
  success?: string | ((result: R) => string);
  /** Query names to refetch afterwards, e.g. ['jobs', 'metrics']. */
  invalidate?: string[];
};

/**
 * Runs a server action with a busy flag, a toast for the result or the error
 * (the server's own message, like the desktop), and a refetch of related data.
 */
export function useAction() {
  const { api, base } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async <R>(
      id: string,
      fn: (api: Api) => Promise<R>,
      { success, invalidate = [] }: RunOpts<R> = {},
    ): Promise<R | undefined> => {
      setBusy(id);
      try {
        const result = await fn(api);
        if (success)
          toast(typeof success === 'function' ? success(result) : success);
        await Promise.all(
          invalidate.map(name =>
            queryClient.invalidateQueries({ queryKey: [base, name] }),
          ),
        );
        return result;
      } catch (err) {
        toast((err as Error).message || 'Action failed');
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [api, base, toast, queryClient],
  );

  return { run, busy };
}
