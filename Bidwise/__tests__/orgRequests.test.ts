// "Request tenders" for an organisation not fetched yet (BM Pro's orgRequests).

jest.mock('../src/lib/api', () => ({
  api: {
    requestOrgTenders: jest.fn(async () => ({ job_id: 'job-1' })),
    orgRequestStatus: jest.fn(async () => ({ status: 'running' })),
  },
}));

import { api } from '../src/lib/api';
import { __resetKV, getRaw } from '../src/lib/kv';
import { queryClient } from '../src/lib/queryClient';
import {
  isOrgRequestPending,
  rehydrateOrgRequests,
  requestOrgTenders,
  scrapeCooldownMessage,
} from '../src/lib/orgRequests';

const mockApi = api as unknown as {
  requestOrgTenders: jest.Mock;
  orgRequestStatus: jest.Mock;
};

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  jest.useFakeTimers();
  __resetKV();
  rehydrateOrgRequests();
});
afterEach(() => jest.useRealTimers());

describe('requesting an organisation’s tenders', () => {
  it('stays pending while the job runs, then refreshes the lists', async () => {
    const spy = jest.spyOn(queryClient, 'invalidateQueries');
    await requestOrgTenders(12);
    expect(mockApi.requestOrgTenders).toHaveBeenCalledWith(12);
    expect(isOrgRequestPending(12)).toBe(true);
    expect(getRaw('bw.pendingOrgRequests')).toContain('job-1');
    await flush();
    expect(isOrgRequestPending(12)).toBe(true);

    mockApi.orgRequestStatus.mockResolvedValueOnce({ status: 'completed' });
    jest.advanceTimersByTime(15_000);
    await flush();
    expect(isOrgRequestPending(12)).toBe(false);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['tenders'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['organizations'] });
  });

  it('stops being pending when the job fails', async () => {
    mockApi.orgRequestStatus.mockResolvedValueOnce({ status: 'failed' });
    await requestOrgTenders(13);
    await flush();
    expect(isOrgRequestPending(13)).toBe(false);
  });

  it('says when the next update is due, in BM Pro’s words', () => {
    jest.setSystemTime(new Date('2026-10-22T06:00:00Z')); // 11:30 IST
    expect(scrapeCooldownMessage(1_792_000_000)).toBe(
      'Next update will be available at 8:00 PM IST.',
    );
    jest.setSystemTime(new Date('2026-10-22T16:00:00Z')); // 21:30 IST
    expect(scrapeCooldownMessage(1_792_000_000)).toMatch(
      /^Last updated on .+\. Next update will be available 23 Oct 2026 8:00 PM IST\.$/,
    );
  });
});
