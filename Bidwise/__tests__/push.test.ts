// Push notifications, app side: where taps go, token registration, sign-out order and
// the badge. The native module is replaced by a fake.

const mockNative = {
  permission: 'granted' as 'granted' | 'denied' | 'undetermined',
  listeners: new Map<string, (body: unknown) => void>(),
  badges: [] as number[],
  registered: 0,
};

jest.mock('../src/platform/push', () => ({
  push: {
    available: true,
    requestPermission: jest.fn(async () => mockNative.permission === 'granted'),
    getPermission: jest.fn(async () => mockNative.permission),
    register: jest.fn(() => {
      mockNative.registered += 1;
    }),
    getToken: jest.fn(async () => null),
    getInitialOpen: jest.fn(async () => null),
    setBadge: jest.fn((n: number) => mockNative.badges.push(n)),
    onToken: (fn: (t: string) => void) => {
      mockNative.listeners.set('token', fn as never);
      return () => {};
    },
    onRegistrationError: () => () => {},
    onReceived: (fn: (p: unknown) => void) => {
      mockNative.listeners.set('received', fn);
      return () => {};
    },
    onOpened: () => () => {},
  },
}));

const mockCalls: {
  method: string;
  route: string;
  body?: unknown;
  key?: string;
}[] = [];
jest.mock('../src/lib/http', () => {
  const actual = jest.requireActual('../src/lib/http');
  return {
    ...actual,
    request: jest.fn(
      async (
        route: string,
        opts: { method?: string; body?: unknown; key?: string } = {},
      ) => {
        mockCalls.push({
          method: opts.method ?? 'GET',
          route,
          body: opts.body,
          key: opts.key,
        });
        return { ok: true };
      },
    ),
  };
});

import { routeForPush } from '../src/lib/pushRoute';
import {
  __resetPush,
  initPush,
  syncPushToken,
  unregisterPush,
} from '../src/lib/pushRegistration';
import { setSession } from '../src/lib/auth';
import { __resetKV } from '../src/lib/kv';
import { addAlert, markAllRead } from '../src/lib/alerts';

const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  mockCalls.length = 0;
  mockNative.permission = 'granted';
  mockNative.badges.length = 0;
  mockNative.registered = 0;
  __resetKV();
  __resetPush();
  setSession({
    user_id: 1,
    email: 'a@b.c',
    display_name: 'A',
    token: 'session-1',
  });
});

describe('where a tapped notification goes', () => {
  it('opens the tender for tender, closing and download notifications', () => {
    for (const thread of ['tender', 'closing', 'download'])
      expect(routeForPush({ thread, tenderId: 42 })).toEqual({
        name: 'TenderDetail',
        params: { id: '42' },
      });
  });

  it('opens the new-tenders page of the organisation (it syncs there)', () => {
    expect(routeForPush({ thread: 'org', orgName: 'PWD' })).toEqual({
      name: 'NewTenders',
      params: { org: 'PWD' },
    });
    expect(routeForPush({ thread: 'org' })).toEqual({
      name: 'Tabs',
      params: { screen: 'Alerts' },
    });
  });

  it('opens the CAPTCHA screen, and Alerts for anything else', () => {
    expect(routeForPush({ thread: 'captcha', captchaId: 'c1' })).toEqual({
      name: 'Captcha',
    });
    expect(routeForPush({ thread: 'other' })).toEqual({
      name: 'Tabs',
      params: { screen: 'Alerts' },
    });
    expect(routeForPush(null)).toBeNull();
  });
});

describe('token registration', () => {
  it('registers with APNs when allowed, and sends the token once as a Bidwise token', async () => {
    initPush();
    await flush();
    expect(mockNative.registered).toBe(1);

    mockNative.listeners.get('token')!('abc123');
    await flush();
    const sent = mockCalls.filter(c => c.route === '/client/push-token');
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({
      token: 'abc123',
      platform: 'ios',
      app: 'bidwise',
      environment: 'sandbox', // tests run with __DEV__
    });

    // The same token again (every launch) is not re-sent within a week.
    mockNative.listeners.get('token')!('abc123');
    await flush();
    expect(
      mockCalls.filter(c => c.route === '/client/push-token'),
    ).toHaveLength(1);
  });

  it('does not register while notifications are not allowed', async () => {
    mockNative.permission = 'denied';
    await syncPushToken();
    expect(mockNative.registered).toBe(0);
  });

  it('on sign-out deletes the token with the session key being signed out', async () => {
    initPush();
    mockNative.listeners.get('token')!('abc123');
    await flush();
    await unregisterPush('session-1');
    const del = mockCalls.find(c => c.method === 'DELETE');
    expect(del).toEqual({
      method: 'DELETE',
      route: '/client/push-token',
      body: { token: 'abc123' },
      key: 'session-1',
    });
    expect(mockNative.badges.at(-1)).toBe(0);
  });
});

describe('badge', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('follows unread alerts on the icon, and tells the server at most every 5 s', async () => {
    initPush();
    mockNative.listeners.get('token')!('abc123');
    await Promise.resolve();
    jest.advanceTimersByTime(0);
    await Promise.resolve();
    markAllRead();
    addAlert({ kind: 'status', message: 'One', tenderId: '1' } as never);
    addAlert({ kind: 'status', message: 'Two', tenderId: '2' } as never);
    expect(mockNative.badges.at(-1)).toBe(2);
    expect(mockCalls.filter(c => c.route === '/client/badge')).toHaveLength(0);
    jest.advanceTimersByTime(5_100);
    const badges = mockCalls.filter(c => c.route === '/client/badge');
    expect(badges).toHaveLength(1);
    expect(badges[0].body).toEqual({ count: 2, unread_orgs: [] });
  });

  it('resets the badge (and the server’s count) on coming back and on a push, token or not', () => {
    const { AppState } = require('react-native');
    let onChange: (s: string) => void = () => {};
    const spy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((...args: unknown[]) => {
        onChange = args[1] as (s: string) => void;
        return { remove: () => {} };
      });
    markAllRead();
    initPush(); // no push token on this phone
    jest.advanceTimersByTime(5_100);
    const sent = () => mockCalls.filter(c => c.route === '/client/badge');
    // Per user: sent without this phone's token.
    expect(sent()).toHaveLength(1);
    expect(sent()[0].body).toEqual({ count: 0, unread_orgs: [] });

    // Pushes meanwhile raised the server's number: coming back puts it right.
    mockNative.badges.length = 0;
    onChange('active');
    expect(mockNative.badges.at(-1)).toBe(0);
    jest.advanceTimersByTime(5_100);
    expect(sent()).toHaveLength(2);
    expect(sent()[1].body).toEqual({ count: 0, unread_orgs: [] });

    // A push while open does the same.
    mockNative.listeners.get('received')!({ thread: 'tender', tenderId: 1 });
    jest.advanceTimersByTime(5_100);
    expect(sent()).toHaveLength(3);
    spy.mockRestore();
  });
});
