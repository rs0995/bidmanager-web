import {
  dehydrate,
  hydrate,
  type DehydratedState,
  type QueryClient,
} from '@tanstack/react-query';
import { AppState } from 'react-native';
import { getRaw, removeRaw, writeJSON } from './kv';

// Keeps the synced portals, organisations, stats, the first tender pages and the
// details of followed tenders (bookmarks and projects) on the device, so Tenders, the
// Dashboard and Projects draw from the last sync straight away on the next launch while
// react-query refreshes in the background.

export const QUERY_CACHE_KEY = 'bw.queryCache';

const PERSISTED = new Set([
  'websites',
  'organizations',
  'tenders',
  'stats',
  'tender',
]);
/** Infinite tender lists keep only their first pages. */
const MAX_PAGES = 2;
/** Tender details kept (followed ones only). */
const MAX_DETAILS = 150;
/** Older than this is dropped at launch rather than shown. */
const MAX_AGE_MS = 7 * 24 * 3_600_000;
/** Saves are batched: at most one write this often, plus one when the app backgrounds. */
const WRITE_EVERY_MS = 10_000;

/** Ids whose details are worth keeping; set by the app (bookmarks + project tenders). */
let followed: () => Iterable<number | string> = () => [];
export function setFollowedTenders(fn: () => Iterable<number | string>) {
  followed = fn;
}

function keep(key: readonly unknown[], followedIds: Set<string>) {
  const kind = String(key[0]);
  if (!PERSISTED.has(kind)) return false;
  // The all-portals organisation list (CSV export only) is the biggest entry: skip it.
  if (kind === 'organizations' && key[1] == null) return false;
  if (kind === 'tender') return followedIds.has(String(key[1]));
  return true;
}

const persisted = (key: readonly unknown[]) => PERSISTED.has(String(key[0]));

function snapshot(qc: QueryClient): DehydratedState {
  const followedIds = new Set(
    [...followed()].slice(0, MAX_DETAILS).map(String),
  );
  const state = dehydrate(qc, {
    shouldDehydrateQuery: q =>
      q.state.status === 'success' && keep(q.queryKey, followedIds),
  });
  state.queries = state.queries.map(q => {
    const data = q.state.data as
      | { pages?: unknown[]; pageParams?: unknown[] }
      | undefined;
    if (!data?.pages) return q;
    return {
      ...q,
      state: {
        ...q.state,
        data: {
          pages: data.pages.slice(0, MAX_PAGES),
          pageParams: (data.pageParams ?? []).slice(0, MAX_PAGES),
        },
      },
    };
  });
  return state;
}

/** Puts the last saved lists back into the cache (call once at launch). */
export function restoreQueries(qc: QueryClient) {
  try {
    const raw = getRaw(QUERY_CACHE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw) as DehydratedState;
    const now = Date.now();
    state.queries = state.queries.filter(
      q => now - q.state.dataUpdatedAt < MAX_AGE_MS,
    );
    hydrate(qc, state);
  } catch {
    removeRaw(QUERY_CACHE_KEY);
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let appState: { remove: () => void } | null = null;

function flush(qc: QueryClient) {
  if (timer) clearTimeout(timer);
  timer = null;
  writeJSON(QUERY_CACHE_KEY, snapshot(qc));
}

/**
 * Saves the lists after any of them changes, at most once every 10 s (one write covers a
 * burst of refetches), and straight away when the app goes to the background. Returns a
 * stop function.
 */
export function persistQueries(qc: QueryClient) {
  unsubscribe?.();
  appState?.remove();
  unsubscribe = qc.getQueryCache().subscribe(event => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    if (!persisted(event.query.queryKey)) return;
    if (timer) return;
    timer = setTimeout(() => flush(qc), WRITE_EVERY_MS);
  });
  appState =
    AppState.addEventListener?.('change', s => {
      if (s === 'background' && timer) flush(qc);
    }) ?? null;
  return () => {
    unsubscribe?.();
    unsubscribe = null;
    appState?.remove();
    appState = null;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

/** Sign out: forget the saved lists along with the in-memory cache. */
export function forgetQueries(qc: QueryClient) {
  if (timer) clearTimeout(timer);
  timer = null;
  qc.clear();
  removeRaw(QUERY_CACHE_KEY);
}
