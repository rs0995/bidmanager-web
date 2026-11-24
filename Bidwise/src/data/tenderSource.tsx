import React, { createContext, useContext, useMemo } from 'react';
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import { api, ServerOrg, ServerTender } from '../lib/api';
import { toTender } from '../lib/serverTender';
import { recordOrgIds, useBookmarkIds } from '../lib/store';
import { useProjectsState } from '../lib/sharedProjects';
import { listTenders } from '../lib/tenderList';
import {
  groupByOrg,
  closesWithinDays,
  parseLimit,
  passesSheetFilters,
  type SheetFilters,
} from '../lib/tenderFilters';
import { archivedTenders, getArchivedTender } from '../fixtures/archive';
import {
  getTender,
  PORTALS,
  tenders as sampleTenders,
} from '../fixtures/tenders';
import { useBookmarks } from '../fixtures/bookmarks';
import { dashboardStats } from '../fixtures/dashboard';
import type { Tender, TenderDoc } from '../fixtures/tenders';

// Where screens get tenders, organisations and stats. Demo mode (browser preview,
// tests) reads the sample data; live mode queries /client/* through react-query and
// maps server rows with toTender(). Screens call the same hooks either way.

export type ListQuery = {
  /** Portal (website) name; null = every portal. */
  portal: string | null;
  org: string | null;
  search: string;
  savedOnly: boolean;
  closingSoon: boolean;
  sort: 'closing' | 'value' | 'emd';
  /** The Filter sheet's choices (Tenders tab). */
  filters?: SheetFilters;
  archived?: boolean;
  /** Nothing is loaded while true (no portal chosen yet). */
  paused?: boolean;
};

/** A location in the data, with how many tenders are there. */
export type LocationOption = { value: string; count: number };

export type ListResult = {
  items: Tender[];
  total: number;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
};

export type OrgItem = {
  name: string;
  portals: string[];
  count: number;
  closingSoon: number;
};

export type OrgQuery = {
  portal: string | null;
  search: string;
  bookmarkedOnly: boolean;
  isOrgBookmarked: (name: string) => boolean;
  archived?: boolean;
  /** Nothing is loaded while true (no portal chosen yet). */
  paused?: boolean;
};

export type DocRow = TenderDoc & { id?: number; downloadable?: boolean };

/** An organisation on one portal (the same name can exist on two portals). */
export type PickOrg = {
  key: string;
  name: string;
  portal: string;
  websiteId: number;
  count: number;
};

export type TenderSource = {
  mode: 'demo' | 'live';
  usePortals: () => string[];
  useTenderList: (q: ListQuery) => ListResult;
  /** The locations that exist in a portal's tenders, most tenders first (Filter sheet). */
  useLocationOptions: (portal: string | null) => LocationOption[];
  useOrgList: (q: OrgQuery) => {
    items: OrgItem[];
    loading: boolean;
    error: string | null;
  };
  useTender: (id: string) => {
    tender?: Tender;
    loading: boolean;
    error: string | null;
  };
  useTenderDocs: (tender?: Tender) => { docs: DocRow[]; loading: boolean };
  /** Saved tenders plus tenders behind projects: the Dashboard's working set. */
  usePipeline: () => { tenders: Tender[]; loading: boolean };
  /** These tenders, in this order (a "new tenders under ORG" alert's list). */
  useTendersByIds: (ids: string[]) => { tenders: Tender[]; loading: boolean };
  useStats: () => { activeTenders: number | null };
  /** Every organisation on every portal (export picker). */
  useAllOrgs: () => {
    items: PickOrg[];
    loading: boolean;
    error: string | null;
  };
  /** Server row for a tender already fetched (to start a project from it). */
  peekServerTender: (id: string) => ServerTender | undefined;
  /** An organisation's server id and last fetch (for "Request tenders"); demo has none. */
  useOrgMeta: (
    org: string,
    portal: string | null,
  ) => { id: number; lastScrapedAt: number } | undefined;
};

const NO_LOCATIONS: LocationOption[] = [];

/** The distinct locations of these tenders, most tenders first, then A to Z. */
export function locationOptions(rows: Tender[]): LocationOption[] {
  const counts = new Map<string, number>();
  rows.forEach(t => {
    const v = t.location.trim();
    if (v && v !== '—') counts.set(v, (counts.get(v) ?? 0) + 1);
  });
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

const message = (e: unknown) =>
  e ? (e as Error).message || 'Something went wrong.' : null;

// --- Demo ---

const demoSource: TenderSource = {
  mode: 'demo',
  usePortals: () => PORTALS,
  useTenderList: q => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { isBookmarked } = useBookmarks();
    const pool = q.archived ? archivedTenders : sampleTenders;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const items = useMemo(
      () =>
        listTenders(pool, { ...q, isSaved: isBookmarked }).sort((a, b) =>
          q.archived
            ? ((b as { closedOrder?: number }).closedOrder ?? 0) -
              ((a as { closedOrder?: number }).closedOrder ?? 0)
            : 0,
        ),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [
        pool,
        q.portal,
        q.org,
        q.search,
        q.savedOnly,
        q.closingSoon,
        q.sort,
        q.filters,
        isBookmarked,
      ],
    );
    if (q.paused)
      return {
        items: [],
        total: 0,
        loading: true,
        error: null,
        hasMore: false,
        loadMore: () => {},
      };
    return {
      items,
      total: items.length,
      loading: false,
      error: null,
      hasMore: false,
      loadMore: () => {},
    };
  },
  useLocationOptions: portal => {
    return useMemo(
      () =>
        locationOptions(
          sampleTenders.filter(t => portal === null || t.portal === portal),
        ),
      [portal],
    );
  },
  useOrgList: q => {
    const pool = q.archived ? archivedTenders : sampleTenders;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const items = useMemo(
      () =>
        groupByOrg(pool, q.portal, q.search, {
          bookmarkedOnly: q.bookmarkedOnly,
          isOrgBookmarked: q.isOrgBookmarked,
        }).map(g => ({
          name: g.name,
          portals: g.portals,
          count: g.tenders.length,
          closingSoon: q.archived ? 0 : g.closingSoon,
        })),
      [
        pool,
        q.portal,
        q.search,
        q.bookmarkedOnly,
        q.isOrgBookmarked,
        q.archived,
      ],
    );
    return q.paused
      ? { items: [], loading: true, error: null }
      : { items, loading: false, error: null };
  },
  useTender: id => ({
    tender: getTender(id) ?? getArchivedTender(id),
    loading: false,
    error: null,
  }),
  useTenderDocs: tender => ({ docs: tender?.docs ?? [], loading: false }),
  usePipeline: () => ({ tenders: sampleTenders, loading: false }),
  useTendersByIds: ids => ({
    tenders: ids
      .map(id => getTender(id) ?? getArchivedTender(id))
      .filter((t): t is Tender => Boolean(t)),
    loading: false,
  }),
  useStats: () => ({ activeTenders: dashboardStats.tendersSynced }),
  useAllOrgs: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const items = useMemo(() => {
      const map = new Map<string, PickOrg>();
      sampleTenders.forEach(t => {
        const key = `${t.portal}|${t.org}`;
        const row = map.get(key) ?? {
          key,
          name: t.org,
          portal: t.portal,
          websiteId: PORTALS.indexOf(t.portal) + 1,
          count: 0,
        };
        row.count += 1;
        map.set(key, row);
      });
      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    }, []);
    return { items, loading: false, error: null };
  },
  peekServerTender: () => undefined,
  useOrgMeta: () => undefined,
};

// --- Live ---

const PAGE_SIZE = 25;

/**
 * How long each kind of data counts as fresh. Saved lists come back from the device at
 * launch (lib/queryPersist.ts), so these also decide how much refetches straight away.
 */
export const STALE = {
  websites: 60 * 60_000,
  organizations: 10 * 60_000,
  tenderList: 2 * 60_000,
  tender: 5 * 60_000,
  stats: 10 * 60_000,
};

/** Portals, as BM Pro: one call to /client/websites (was: paging every organisation). */
export const websitesQuery = {
  queryKey: ['websites'],
  staleTime: STALE.websites,
  queryFn: async () =>
    (await api.websites()).map(w => ({ id: w.id, name: w.name })),
};

function useWebsites() {
  return useQuery(websitesQuery);
}

function useWebsiteId(portal: string | null) {
  const { data } = useWebsites();
  return portal ? data?.find(w => w.name === portal)?.id : undefined;
}

/**
 * Organisations as each portal lists them: still on the portal first, grouped by portal,
 * then the portal's own position (`site_order`, its S.No). Rows the server hasn't
 * numbered yet follow, most tenders first, then A–Z (the order before site_order).
 */
export function byPortalOrder(a: ServerOrg, b: ServerOrg) {
  const pos = (o: ServerOrg) =>
    typeof o.site_order === 'number' ? o.site_order : Infinity;
  return (
    Number(b.is_available) - Number(a.is_available) ||
    a.website_name.localeCompare(b.website_name) ||
    pos(a) - pos(b) ||
    b.tender_count - a.tender_count ||
    a.name.localeCompare(b.name)
  );
}

/** Every organisation of a portal: page 1 says how many pages, the rest load 4 at a time. */
export async function fetchAllOrgs(websiteId?: number, archived?: boolean) {
  const get = (page: number) =>
    api.organizations({
      website_id: websiteId,
      archived: archived ? 'true' : undefined,
      page,
      page_size: 100,
    });
  const first = await get(1);
  const items: ServerOrg[] = [...first.items];
  const pages = Math.min(Math.max(1, first.pages || 1), 50);
  for (let start = 2; start <= pages; start += 4) {
    const batch = [];
    for (let p = start; p < start + 4 && p <= pages; p += 1) batch.push(get(p));
    (await Promise.all(batch)).forEach(r => items.push(...r.items));
  }
  recordOrgIds(items);
  return items;
}

const serverTenderCache = new Map<string, ServerTender>();
const remember = (rows: ServerTender[]) =>
  rows.forEach(r => serverTenderCache.set(String(r.id), r));

/** Tenders that are still open, soonest first (closed-but-not-yet-archived go last). */
const openFirst = (a: Tender, b: Tender) => {
  const ac = a.closeIn === 'Closed';
  const bc = b.closeIn === 'Closed';
  if (ac !== bc) return ac ? 1 : -1;
  return (a.closesAt ?? Infinity) - (b.closesAt ?? Infinity);
};

const liveSource: TenderSource = {
  mode: 'live',
  usePortals: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { data } = useWebsites();
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useMemo(() => (data ?? []).map(w => w.name), [data]);
  },

  useTenderList: q => {
    /* eslint-disable react-hooks/rules-of-hooks */
    const websiteId = useWebsiteId(q.portal);
    const saved = useBookmarkIds();
    const savedIds = q.savedOnly && !q.paused ? [...saved] : [];
    // The value range (crores) is applied by the server across every tender.
    const minCr = q.filters ? parseLimit(q.filters.minCr) : null;
    const maxCr = q.filters ? parseLimit(q.filters.maxCr) : null;
    const paged = useInfiniteQuery({
      queryKey: [
        'tenders',
        q.portal,
        websiteId,
        q.org ?? q.filters?.department ?? '',
        q.search,
        q.sort,
        q.archived,
        q.filters?.category.trim() ?? '',
        q.filters?.location.trim() ?? '',
        minCr,
        maxCr,
      ],
      enabled:
        !q.paused && !q.savedOnly && (!q.portal || websiteId !== undefined),
      staleTime: STALE.tenderList,
      initialPageParam: 1,
      queryFn: async ({ pageParam }) => {
        const res = await api.tenders({
          q: q.search.trim(),
          website_id: websiteId,
          // An organisation page's own org, else the Filters sheet's department.
          organization: q.org ?? (q.filters?.department || undefined),
          archived: q.archived ? 'true' : 'false',
          category: q.filters?.category.trim(),
          location: q.filters?.location.trim(),
          min_value_cr: minCr,
          max_value_cr: maxCr,
          sort_by:
            q.sort === 'value'
              ? 'tender_value'
              : q.sort === 'emd'
              ? 'emd'
              : 'closing_date',
          sort_order: q.sort !== 'closing' || q.archived ? 'desc' : 'asc',
          page: pageParam,
          page_size: PAGE_SIZE,
        });
        remember(res.items);
        return res;
      },
      getNextPageParam: last =>
        last.page < last.pages ? last.page + 1 : undefined,
    });
    const savedQueries = useQueries({
      queries: savedIds.map(id => ({
        queryKey: ['tender', String(id)],
        staleTime: STALE.tender,
        queryFn: async () => {
          const t = await api.tender(id);
          remember([t]);
          return t;
        },
      })),
    });
    /* eslint-enable react-hooks/rules-of-hooks */

    const now = Date.now();
    let rows: Tender[];
    let total: number;
    if (q.savedOnly) {
      const needle = q.search.trim().toLowerCase();
      rows = savedQueries
        .map(r => r.data)
        .filter((t): t is ServerTender => Boolean(t))
        .filter(t => Boolean(t.is_archived) === Boolean(q.archived))
        .filter(t => !q.portal || t.website_name === q.portal)
        .filter(t => !q.org || t.organization === q.org)
        .filter(
          t =>
            !needle ||
            `${t.title} ${t.tender_id} ${t.organization}`
              .toLowerCase()
              .includes(needle),
        )
        .map(t => toTender(t, now));
      total = rows.length;
    } else {
      rows = (paged.data?.pages ?? []).flatMap(p =>
        p.items.map(t => toTender(t, now)),
      );
      total = paged.data?.pages[0]?.total ?? 0;
    }
    if (q.closingSoon)
      rows = rows.filter(t => t.closeIn !== 'Closed' && closesWithinDays(t, 5));
    // The server applies department, category, location and the value range across every tender
    // (so its total stands); the saved list is filtered here.
    const f = q.filters;
    const clientFiltered = Boolean(f) && q.savedOnly;
    if (f) rows = rows.filter(t => passesSheetFilters(t, f, !q.savedOnly));
    if (!q.archived && q.sort === 'closing') rows = [...rows].sort(openFirst);

    return {
      items: rows,
      total: q.closingSoon || clientFiltered ? rows.length : total,
      loading: q.savedOnly
        ? savedQueries.some(r => r.isLoading)
        : paged.isLoading,
      error: message(
        q.savedOnly ? savedQueries.find(r => r.error)?.error : paged.error,
      ),
      hasMore: !q.savedOnly && Boolean(paged.hasNextPage),
      loadMore: () => {
        if (paged.hasNextPage && !paged.isFetchingNextPage)
          paged.fetchNextPage();
      },
    };
  },

  useLocationOptions: portal => {
    const websiteId = useWebsiteId(portal);
    const res = useQuery({
      queryKey: ['tenderLocations', websiteId ?? null],
      enabled: !portal || websiteId !== undefined,
      staleTime: STALE.tenderList,
      // A server without the list yet (404) just leaves the sheet on its fallback.
      retry: false,
      queryFn: async () =>
        (await api.tenderFilters({ website_id: websiteId })).locations ?? [],
    });
    return res.data ?? NO_LOCATIONS;
  },

  useOrgMeta: (org, portal) => {
    /* eslint-disable react-hooks/rules-of-hooks */
    // The same cached list the Organisations tab shows.
    const websiteId = useWebsiteId(portal);
    const res = useQuery({
      queryKey: ['organizations', websiteId ?? null, false],
      enabled: !portal || websiteId !== undefined,
      staleTime: STALE.organizations,
      queryFn: () => fetchAllOrgs(websiteId, false),
    });
    /* eslint-enable react-hooks/rules-of-hooks */
    const o = res.data?.find(x => x.name === org);
    return o ? { id: o.id, lastScrapedAt: o.last_scraped_at || 0 } : undefined;
  },

  useOrgList: q => {
    /* eslint-disable react-hooks/rules-of-hooks */
    const websiteId = useWebsiteId(q.portal);
    const res = useQuery({
      queryKey: ['organizations', websiteId ?? null, Boolean(q.archived)],
      enabled: !q.paused && (!q.portal || websiteId !== undefined),
      staleTime: STALE.organizations,
      queryFn: () => fetchAllOrgs(websiteId, q.archived),
    });
    const needle = q.search.trim().toLowerCase();
    const { bookmarkedOnly, isOrgBookmarked } = q;
    const items = useMemo(
      () =>
        (res.data ?? [])
          .filter(o => !needle || o.name.toLowerCase().includes(needle))
          .filter(o => !bookmarkedOnly || isOrgBookmarked(o.name))
          .sort(byPortalOrder)
          .map(o => ({
            name: o.name,
            portals: [o.website_name],
            count: o.tender_count,
            closingSoon: 0,
          })),
      [res.data, needle, bookmarkedOnly, isOrgBookmarked],
    );
    /* eslint-enable react-hooks/rules-of-hooks */
    return {
      items: q.paused ? [] : items,
      loading: q.paused || res.isLoading,
      error: message(res.error),
    };
  },

  useTender: id => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const res = useQuery({
      queryKey: ['tender', String(id)],
      // A project with no linked tender passes '' (Number('') is 0): don't fetch.
      enabled: id !== '' && Number(id) > 0,
      staleTime: STALE.tender,
      queryFn: async () => {
        const t = await api.tender(id);
        remember([t]);
        return t;
      },
    });
    return {
      tender: res.data ? toTender(res.data) : undefined,
      loading: res.isLoading,
      error: message(res.error),
    };
  },

  useTenderDocs: tender => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const res = useQuery({
      queryKey: ['tender-docs', tender?.id],
      enabled: Boolean(tender?.id) && Boolean(tender?.docCount),
      queryFn: () => api.tenderDocuments(tender!.id, { page_size: 100 }),
    });
    const docs: DocRow[] = (res.data?.items ?? []).map(d => ({
      id: d.id,
      name: d.name,
      meta: [
        d.type,
        d.size_bytes ? formatBytes(d.size_bytes) : '',
        d.downloadable ? '' : 'not available yet',
      ]
        .filter(Boolean)
        .join(' · '),
      downloadable: d.downloadable,
    }));
    return { docs, loading: res.isLoading };
  },

  useTendersByIds: ids => {
    // Same ['tender', id] entries as the detail page and the Dashboard.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const results = useQueries({
      queries: ids.map(id => ({
        queryKey: ['tender', String(id)],
        staleTime: STALE.tender,
        queryFn: async () => {
          const t = await api.tender(id);
          remember([t]);
          return t;
        },
      })),
    });
    const now = Date.now();
    return {
      tenders: results
        .map(r => r.data)
        .filter((t): t is ServerTender => Boolean(t))
        .map(t => toTender(t, now)),
      loading: results.some(r => r.isLoading),
    };
  },

  usePipeline: () => {
    /* eslint-disable react-hooks/rules-of-hooks */
    const saved = useBookmarkIds();
    const { projects } = useProjectsState();
    const ids = useMemo(() => {
      const set = new Set<number>(saved);
      projects
        .filter(p => p.status !== 'Archived' && p.source_tender_db_id)
        .forEach(p => set.add(Number(p.source_tender_db_id)));
      return [...set];
    }, [saved, projects]);
    const results = useQueries({
      queries: ids.map(id => ({
        queryKey: ['tender', String(id)],
        staleTime: 60_000,
        queryFn: async () => {
          const t = await api.tender(id);
          remember([t]);
          return t;
        },
      })),
    });
    /* eslint-enable react-hooks/rules-of-hooks */
    const now = Date.now();
    return {
      tenders: results
        .map(r => r.data)
        .filter((t): t is ServerTender => Boolean(t) && !t!.is_archived)
        .map(t => toTender(t, now))
        .filter(t => t.closeIn !== 'Closed')
        .sort(openFirst),
      loading: results.some(r => r.isLoading),
    };
  },

  useStats: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const res = useQuery({
      queryKey: ['stats'],
      queryFn: api.stats,
      staleTime: STALE.stats,
    });
    return { activeTenders: res.data?.active_tenders ?? null };
  },

  useAllOrgs: () => {
    /* eslint-disable react-hooks/rules-of-hooks */
    const res = useQuery({
      queryKey: ['organizations', null, false],
      staleTime: STALE.organizations,
      queryFn: () => fetchAllOrgs(),
    });
    const items = useMemo(
      () =>
        (res.data ?? [])
          .map(o => ({
            key: `${o.website_id}|${o.name}`,
            name: o.name,
            portal: o.website_name,
            websiteId: o.website_id,
            count: o.tender_count,
          }))
          .sort(
            (a, b) =>
              a.name.localeCompare(b.name) || a.portal.localeCompare(b.portal),
          ),
      [res.data],
    );
    /* eslint-enable react-hooks/rules-of-hooks */
    return { items, loading: res.isLoading, error: message(res.error) };
  },

  peekServerTender: id => serverTenderCache.get(String(id)),
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const TenderSourceContext = createContext<TenderSource>(demoSource);

export function TenderSourceProvider({
  mode,
  children,
}: {
  mode: 'demo' | 'live';
  children: React.ReactNode;
}) {
  return (
    <TenderSourceContext.Provider
      value={mode === 'live' ? liveSource : demoSource}
    >
      {children}
    </TenderSourceContext.Provider>
  );
}

/** The active source. Its mode never changes while the app runs, so hook order is stable. */
export const useTenderSource = () => useContext(TenderSourceContext);
