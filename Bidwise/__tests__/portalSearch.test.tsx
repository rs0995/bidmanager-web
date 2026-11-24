import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, {
  ReactTestInstance,
  ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import {
  createNavigationContainerRef,
  NavigationContainer,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// NIC portal tender search (the portal_search section; Server UI/server/API_CHANGES.md §2).

jest.mock('../src/lib/api', () => {
  const actual = jest.requireActual('../src/lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      portalSearchPortals: jest.fn(),
      portalSearchHistory: jest.fn(),
      startPortalSearch: jest.fn(async () => ({})),
      deletePortalSearch: jest.fn(async () => ({})),
      clearPortalSearchHistory: jest.fn(async () => ({})),
    },
  };
});

let mockPick = '';
jest.mock('../src/platform/actionSheet', () => ({
  showActionSheet: (
    _title: string,
    options: { label: string; onPress: () => void }[],
  ) => (options.find(o => o.label === mockPick) ?? options[0]).onPress(),
}));

import App from '../App';
import { api } from '../src/lib/api';
import type { PortalSearch } from '../src/lib/api';
import { setSession } from '../src/lib/auth';
import { DEFAULT_ACCOUNT, setAccount } from '../src/lib/account';
import { __resetKV } from '../src/lib/kv';
import { ThemeProvider } from '../src/theme';
import {
  TenderSourceContext,
  type TenderSource,
} from '../src/data/tenderSource';
import { CaptchaContext } from '../src/fixtures/captcha';
import {
  PortalSearchScreen,
  searchOutcome,
} from '../src/app/screens/PortalSearchScreen';

const mockApi = api as unknown as Record<string, jest.Mock>;

const search = (over: Partial<PortalSearch>): PortalSearch => ({
  id: 1,
  website_id: 7,
  website_name: 'Maharashtra eTenders',
  tender_id: '2026_MMRDA_1341650_1',
  job_id: 'j1',
  status: 'found',
  stage: 'AOC',
  tender_db_id: 501,
  created: true,
  is_archived: true,
  error: null,
  created_at: 1792800000,
  finished_at: 1792800060,
  tender: { id: 501 } as never,
  ...over,
});

beforeEach(() => {
  __resetKV();
  setAccount(DEFAULT_ACCOUNT);
  Object.values(mockApi).forEach(f => f.mockClear?.());
  setSession({ token: 'tok', user_id: 1, email: 'a@b.c' });
  mockPick = '';
  mockApi.portalSearchPortals.mockResolvedValue({
    allowed: true,
    items: [
      {
        id: 7,
        name: 'Maharashtra eTenders',
        url: 'https://mahatenders.gov.in',
      },
      { id: 9, name: 'CPPP', url: 'https://eprocure.gov.in' },
    ],
  });
});

it('words each outcome as the server reports it', () => {
  expect(searchOutcome(search({}))).toBe('AOC · Added to archive');
  expect(searchOutcome(search({ is_archived: false, stage: null }))).toBe(
    'Added to current',
  );
  expect(searchOutcome(search({ created: false }))).toBe('AOC · Updated');
  expect(searchOutcome(search({ status: 'not_found' }))).toBe(
    'Not on the portal',
  );
  expect(
    searchOutcome(search({ status: 'failed', error: 'Captcha failed' })),
  ).toBe('Captcha failed');
});

const isPressable = (n: ReactTestInstance) =>
  typeof n.type !== 'string' && typeof n.props.onPress === 'function';
const textIn = (n: ReactTestInstance) =>
  n
    .findAll(c => (c.type as unknown) === 'Text')
    .map(c => [c.props.children].flat().join(''))
    .join(' ');
const byLabel = (r: Renderer, label: string) =>
  r.root.findAll(
    n => isPressable(n) && n.props.accessibilityLabel === label,
  )[0];
const press = async (n: ReactTestInstance) => {
  await ReactTestRenderer.act(async () => {
    n.props.onPress();
  });
};
const flush = () =>
  ReactTestRenderer.act(async () => {
    await new Promise(res => setTimeout(res, 0));
  });

const clients: QueryClient[] = [];
afterEach(() => clients.splice(0).forEach(c => c.clear()));

const Stack = createNativeStackNavigator();
const Stub = ({ route }: { route: { name: string } }) => (
  <Text>{route.name}</Text>
);

async function renderScreen(captchaWaiting = false) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(qc);
  const nav =
    createNavigationContainerRef<Record<string, object | undefined>>();
  let r!: Renderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <ThemeProvider>
          <QueryClientProvider client={qc}>
            <TenderSourceContext.Provider
              value={{ mode: 'live' } as unknown as TenderSource}
            >
              <CaptchaContext.Provider
                value={{
                  pending: captchaWaiting
                    ? ({ requestId: 'c1' } as never)
                    : null,
                  answer: async () => true,
                }}
              >
                <NavigationContainer ref={nav}>
                  <Stack.Navigator>
                    <Stack.Screen
                      name="Search"
                      component={PortalSearchScreen}
                    />
                    <Stack.Screen name="TenderDetail" component={Stub} />
                    <Stack.Screen name="Captcha" component={Stub} />
                  </Stack.Navigator>
                </NavigationContainer>
              </CaptchaContext.Provider>
            </TenderSourceContext.Provider>
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  await flush();
  return { r, nav };
}

describe('search screen', () => {
  it('searches the chosen portal for a trimmed tender ID', async () => {
    mockApi.portalSearchHistory.mockResolvedValue({ items: [] });
    const { r } = await renderScreen();
    expect(textIn(r.root)).toContain('Searches you run show here.');
    mockPick = 'CPPP';
    await press(byLabel(r, 'Portal: Maharashtra eTenders'));
    const field = r.root.findAll(
      n => n.props.label === 'Tender ID' && n.props.onChangeText,
    )[0];
    await ReactTestRenderer.act(async () => {
      field.props.onChangeText('  2026_CPPP_99_1 ');
    });
    const button = r.root.findAll(
      n => isPressable(n) && textIn(n) === 'Search',
    );
    await press(button[button.length - 1]);
    expect(mockApi.startPortalSearch).toHaveBeenCalledWith(9, '2026_CPPP_99_1');
    r.unmount();
  });

  it('lists the history, opens a found tender, and deletes entries', async () => {
    mockApi.portalSearchHistory.mockResolvedValue({
      items: [
        search({ id: 3, tender_id: 'A_1', created: false }),
        search({ id: 2, tender_id: 'B_2', status: 'not_found' }),
      ],
    });
    const { r, nav } = await renderScreen();
    const out = textIn(r.root);
    expect(out).toContain('AOC · Updated');
    expect(out).toContain('Not on the portal');
    await press(byLabel(r, 'A_1, AOC · Updated'));
    expect(nav.getCurrentRoute()).toMatchObject({
      name: 'TenderDetail',
      params: { id: '501' },
    });
    nav.goBack();
    await flush();
    await press(byLabel(r, 'Remove B_2 from history'));
    expect(mockApi.deletePortalSearch).toHaveBeenCalledWith(2);
    await press(
      r.root.findAll(n => isPressable(n) && textIn(n) === 'Clear history')[0],
    );
    expect(mockApi.clearPortalSearchHistory).toHaveBeenCalled();
    r.unmount();
  });

  it('while a search runs, points to a waiting captcha', async () => {
    mockApi.portalSearchHistory.mockResolvedValue({
      items: [search({ status: 'pending', stage: null })],
    });
    const { r, nav } = await renderScreen(true);
    expect(textIn(r.root)).toContain(
      'Searching 2026_MMRDA_1341650_1 on Maharashtra eTenders',
    );
    await press(byLabel(r, 'A captcha needs you'));
    expect(nav.getCurrentRoute()?.name).toBe('Captcha');
    r.unmount();
  });
});

describe('More tab', () => {
  it('keeps More, and shows Search on portal only when switched on', async () => {
    const mount = async () => {
      let r!: Renderer;
      await ReactTestRenderer.act(async () => {
        r = ReactTestRenderer.create(<App mode="demo" signedIn />);
      });
      await press(
        r.root.findAll(
          n =>
            isPressable(n) &&
            n.props.accessibilityRole === 'tab' &&
            n.props.accessibilityLabel === 'More',
        )[0],
      );
      return r;
    };
    let r = await mount();
    expect(textIn(r.root)).not.toContain('Search on portal');
    r.unmount();
    setAccount({ permissions: { portal_search: true } as never });
    r = await mount();
    expect(textIn(r.root)).toContain('Search on portal');
    r.unmount();
  });
});
