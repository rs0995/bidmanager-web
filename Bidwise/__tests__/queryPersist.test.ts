import { QueryClient } from '@tanstack/react-query';
import { getRaw, __resetKV } from '../src/lib/kv';
import {
  forgetQueries,
  persistQueries,
  QUERY_CACHE_KEY,
  restoreQueries,
  setFollowedTenders,
} from '../src/lib/queryPersist';

beforeEach(() => {
  __resetKV();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

it('saves synced orgs and tender pages, and restores them on the next launch', () => {
  const qc = new QueryClient();
  const stop = persistQueries(qc);
  const orgs = [{ name: 'PWD', tender_count: 4 }];
  qc.setQueryData(['organizations', 3, false], orgs);
  qc.setQueryData(['tenders', 'MahaTenders', 3], {
    pages: [{ items: [1] }, { items: [2] }, { items: [3] }],
    pageParams: [1, 2, 3],
  });
  // Not a list: never persisted.
  qc.setQueryData(['tender-docs', '9'], [{ id: 1 }]);
  jest.advanceTimersByTime(10_100); // writes are batched every 10 s
  stop();
  expect(getRaw(QUERY_CACHE_KEY)).toBeTruthy();

  const next = new QueryClient();
  restoreQueries(next);
  expect(next.getQueryData(['organizations', 3, false])).toEqual(orgs);
  // Infinite lists keep their first two pages.
  expect(next.getQueryData(['tenders', 'MahaTenders', 3])).toEqual({
    pages: [{ items: [1] }, { items: [2] }],
    pageParams: [1, 2],
  });
  expect(next.getQueryData(['tender-docs', '9'])).toBeUndefined();

  forgetQueries(next);
  expect(getRaw(QUERY_CACHE_KEY)).toBeNull();
  expect(next.getQueryData(['organizations', 3, false])).toBeUndefined();
});

it('keeps details of followed tenders only, and skips the all-portals org list', () => {
  setFollowedTenders(() => [42]);
  const qc = new QueryClient();
  const stop = persistQueries(qc);
  qc.setQueryData(['tender', '42'], { id: 42, title: 'Followed' });
  qc.setQueryData(['tender', '99'], { id: 99, title: 'Just browsed' });
  qc.setQueryData(['organizations', null, false], [{ name: 'Every portal' }]);
  jest.advanceTimersByTime(10_100);
  stop();

  const next = new QueryClient();
  restoreQueries(next);
  expect(next.getQueryData(['tender', '42'])).toEqual({
    id: 42,
    title: 'Followed',
  });
  expect(next.getQueryData(['tender', '99'])).toBeUndefined();
  expect(next.getQueryData(['organizations', null, false])).toBeUndefined();
  setFollowedTenders(() => []);
});
