import React from 'react';
import ReactTestRenderer, {
  ReactTestInstance,
  ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import App from '../App';
import { queryClient } from '../src/lib/queryClient';
import { cancelScheduledPush } from '../src/lib/pushQueue';

// The whole app in live mode against a fake /client/* server: sign in, the dashboard
// fills from the server, Tenders lists server rows, and starring a tender is pushed
// to /client/sync.

jest.mock('../src/platform/files', () => ({
  files: {
    abs: (rel: string) => `/Docs/${rel}`,
    download: jest.fn(async () => 4096),
    exists: jest.fn(async () => true),
    remove: jest.fn(async () => {}),
    open: jest.fn(async () => {}),
    walk: jest.fn(async () => []),
    unzip: jest.fn(async () => {}),
    writeText: jest.fn(async () => {}),
    share: jest.fn(),
  },
}));

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const tender = (id: number, title: string, days: number) => ({
  id,
  website_id: 7,
  website_name: 'Mahatenders',
  website_url: 'https://mahatenders.gov.in',
  organization: 'PWD Konkan',
  tender_id: `2026_PWD_${id}`,
  title,
  work_description: '',
  tender_value: '42800000',
  emd: '428000',
  closing_date: iso(Date.now() + days * DAY),
  opening_date: '',
  published_date: '',
  pre_bid_meeting_date: '',
  location: 'Raigad',
  category: 'Civil works',
  status: 'Open',
  is_archived: false,
  has_documents: false,
  document_count: 0,
  prebid_count: 0,
  corrigendum_count: 0,
  last_update_checked_at: null,
  last_status_checked_at: null,
  tender_url: `https://mahatenders.gov.in/t/${id}`,
});

const T42 = tender(42, 'Panvel–Uran road widening', 3);
const T43 = tender(43, 'Khed water supply network', 9);
const page = (items: unknown[]) => ({
  items,
  page: 1,
  page_size: 25,
  total: items.length,
  pages: 1,
});

const calls: { method: string; route: string; body?: unknown }[] = [];

// React Query keeps cache entries alive on 5-minute timers; drop them so Jest can exit.
afterAll(() => {
  cancelScheduledPush();
  queryClient.clear();
});

function server(
  route: string,
  method: string,
  body?: unknown,
): [number, unknown] {
  const path = route.split('?')[0];
  if (path === '/client/auth/login') {
    const b = body as { email: string; password: string };
    return b.password === 'right'
      ? [
          200,
          {
            user_id: 1,
            email: b.email,
            display_name: 'Rakshit Infra',
            token: 'tok-1',
          },
        ]
      : [401, { detail: 'Incorrect email or password.' }];
  }
  if (path === '/client/sync' && method === 'GET')
    return [
      200,
      {
        data: {
          bookmarks: [42],
          bookmarkedOrgs: [],
          // Made on another device, then archived: known only by its portal tender ID.
          projects: [
            {
              id: 900,
              title: 'Khed water supply network',
              client_name: 'PWD Konkan',
              source_tender_id: ' 2026_pwd_43 ',
              source_tender_db_id: null,
              project_value: 0,
              emd: 0,
              deadline: null,
              prebid: null,
              status: 'Archived',
              description: '',
            },
          ],
          checklist: [],
        },
        updated_at: 10,
      },
    ];
  if (path === '/client/sync' && method === 'PUT')
    return [200, { updated_at: 11 }];
  if (path === '/client/tenders/42/documents')
    return [
      200,
      page([
        {
          id: 501,
          name: 'NIT.pdf',
          type: 'document',
          size_bytes: 4096,
          downloaded_at: '',
          status: 'complete',
          downloadable: true,
        },
      ]),
    ];
  if (path === '/client/tenders/42/download-request')
    return [
      200,
      {
        url: 'http://internal/client/documents/501/download?token=t',
        expires_at: '',
      },
    ];
  if (path === '/client/tenders/42')
    return [200, { ...T42, has_documents: true, document_count: 1 }];
  if (path === '/client/tenders/43') return [200, T43];
  if (path === '/client/tenders') return [200, page([T42, T43])];
  if (path === '/client/organizations')
    return [
      200,
      page([
        {
          id: 3,
          website_id: 7,
          website_name: 'Mahatenders',
          name: 'PWD Konkan',
          tenders_url: '',
          tender_count: 2,
          scrape_enabled: true,
          has_saved_job: true,
          last_scraped_at: 0,
          is_available: true,
        },
      ]),
    ];
  if (path === '/client/websites')
    return [
      200,
      [{ id: 7, name: 'Mahatenders', url: 'https://mahatenders.gov.in' }],
    ];
  if (path === '/client/stats')
    return [
      200,
      {
        total_tenders: 2000,
        active_tenders: 1234,
        archived_tenders: 766,
        websites: 3,
        documents: 0,
        top_categories: [],
      },
    ];
  if (path === '/client/captcha/pending') return [200, null];
  if (path === '/client/auth/logout') return [200, {}];
  return [404, { detail: `No route ${path}` }];
}

beforeAll(() => {
  (globalThis as { fetch: unknown }).fetch = jest.fn(
    async (url: string, init: RequestInit) => {
      const route = url.replace(/^https?:\/\/[^/]+/, '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, route, body });
      const [status, payload] = server(route, method, body);
      return { ok: status < 400, status, json: async () => payload };
    },
  );
});

const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) {
    await ReactTestRenderer.act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
  }
};

const isPressable = (n: ReactTestInstance) =>
  typeof n.type !== 'string' && typeof n.props.onPress === 'function';
const textIn = (n: ReactTestInstance) =>
  n
    .findAll(c => (c.type as unknown) === 'Text')
    .map(c => [c.props.children].flat().join(''))
    .join(' ');
const byText = (r: Renderer, text: string, role?: string) => {
  const hits = r.root.findAll(
    n =>
      isPressable(n) &&
      (!role || n.props.accessibilityRole === role) &&
      textIn(n).includes(text),
  );
  if (!hits.length) throw new Error(`No pressable with text ${text}`);
  return hits[hits.length - 1];
};
const byLabel = (r: Renderer, label: string) => {
  const hit = r.root.findAll(
    n => isPressable(n) && n.props.accessibilityLabel === label,
  )[0];
  if (!hit) throw new Error(`No pressable labelled ${label}`);
  return hit;
};
const input = (r: Renderer, label: string) =>
  r.root.findAll(
    n => n.props.accessibilityLabel === label && n.props.onChangeText,
  )[0];
const press = async (n: ReactTestInstance) => {
  await ReactTestRenderer.act(async () => {
    n.props.onPress();
  });
  await settle();
};

test('signs in against the server and works on live data', async () => {
  let r!: Renderer;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<App mode="live" />);
  });
  await settle();
  expect(textIn(r.root)).toContain('Sign in to workspace');

  // Wrong password: the server's message is shown.
  await ReactTestRenderer.act(async () => {
    input(r, 'Work email').props.onChangeText('info@rakshitinfra.com');
    input(r, 'Password').props.onChangeText('wrong');
  });
  await press(byText(r, 'Sign in to workspace', 'button'));
  expect(textIn(r.root)).toContain('Incorrect email or password.');

  // Right password: the dashboard fills from the server.
  await ReactTestRenderer.act(async () => {
    input(r, 'Password').props.onChangeText('right');
  });
  await press(byText(r, 'Sign in', 'button'));
  await settle(12);
  let out = textIn(r.root);
  expect(out).toContain('Dashboard');
  expect(out).toContain('1234');
  expect(out).toContain('Panvel–Uran road widening');
  expect(
    calls.some(c => c.route === '/client/sync' && c.method === 'GET'),
  ).toBe(true);

  // Tenders tab lists server rows; starring one is pushed to /client/sync.
  const tab = r.root.findAll(
    n =>
      isPressable(n) &&
      n.props.accessibilityRole === 'tab' &&
      n.props.accessibilityLabel === 'Tenders',
  )[0];
  await press(tab);
  await press(byText(r, 'Tenders', 'tab'));
  await settle(12);
  out = textIn(r.root);
  expect(out).toContain('Khed water supply network');
  expect(out).toContain('2 tenders');

  const before = calls.filter(c => c.method === 'PUT').length;
  await press(byLabel(r, 'Save tender'));
  await settle(6);
  const puts = calls.filter(c => c.method === 'PUT');
  expect(puts.length).toBeGreaterThan(before);
  const last = puts[puts.length - 1].body as { data: { bookmarks: number[] } };
  expect(last.data.bookmarks.sort()).toEqual([42, 43]);

  // Tender details list the server's documents; downloading one saves it here.
  await press(byLabel(r, 'Panvel–Uran road widening, PWD Konkan'));
  await settle(10);
  out = textIn(r.root);
  expect(out).toContain('Tender details');
  expect(out).toContain('NIT.pdf');
  await press(byLabel(r, 'Download NIT.pdf'));
  await settle(10);
  expect(
    r.root.findAll(n => n.props.accessibilityLabel === 'Open NIT.pdf').length,
  ).toBeGreaterThan(0);

  // A tender that already has a project (here archived, matched by portal tender ID)
  // is never added twice: Add to Projects warns instead.
  await press(byLabel(r, 'Back'));
  await press(byLabel(r, 'Khed water supply network, PWD Konkan'));
  await settle(10);
  const putsBefore = calls.filter(c => c.method === 'PUT').length;
  await press(byText(r, 'Add to Projects', 'button'));
  await settle(6);
  expect(textIn(r.root)).toContain('Project already exists (archived)');
  const after = calls.filter(c => c.method === 'PUT');
  const lastBlob = (after[after.length - 1]?.body ?? {}) as {
    data?: { projects?: unknown[] };
  };
  expect(
    after.length === putsBefore || (lastBlob.data?.projects ?? []).length === 1,
  ).toBe(true);

  await ReactTestRenderer.act(async () => r.unmount());
});
