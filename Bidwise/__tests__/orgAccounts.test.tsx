import React from 'react';
import ReactTestRenderer, {
  ReactTestInstance,
  ReactTestRenderer as Renderer,
} from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Organisation accounts (Server UI/server/org_access.py): who is signed out by a 403,
// the account store, hidden sections, the Organisation page and sign-up.

jest.mock('../src/lib/api', () => {
  const actual = jest.requireActual('../src/lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      me: jest.fn(),
      org: jest.fn(),
      createOrg: jest.fn(async () => ({})),
      requestJoin: jest.fn(async () => ({ request: {}, warning: '' })),
      cancelJoinRequest: jest.fn(async () => ({ ok: true })),
      approveRequest: jest.fn(async () => ({})),
      rejectRequest: jest.fn(async () => ({})),
      setMemberPermissions: jest.fn(async () => ({})),
      setMemberRole: jest.fn(async () => ({})),
      delinkMember: jest.fn(async () => ({})),
      renameOrg: jest.fn(async () => ({})),
      regenerateJoinCode: jest.fn(async () => ({ join_code: 'NEWCODE1' })),
    },
  };
});

// Action sheets pick the option named in `mockPick` (else the first).
let mockPick = '';
jest.mock('../src/platform/actionSheet', () => ({
  showActionSheet: (
    _title: string,
    options: { label: string; onPress: () => void }[],
  ) => (options.find(o => o.label === mockPick) ?? options[0]).onPress(),
}));

import App from '../App';
import { api } from '../src/lib/api';
import type { AccountInfo, OrgDetail } from '../src/lib/api';
import { AuthError, request } from '../src/lib/http';
import { clearSession, setSession } from '../src/lib/auth';
import {
  ALL_SECTIONS,
  DEFAULT_ACCOUNT,
  getAccount,
  refreshAccount,
  setAccount,
} from '../src/lib/account';
import { __resetKV } from '../src/lib/kv';
import { ThemeProvider } from '../src/theme';
import {
  TenderSourceContext,
  type TenderSource,
} from '../src/data/tenderSource';
import { OrganisationScreen } from '../src/app/screens/OrganisationScreen';
import { SignUpScreen } from '../src/app/screens/SignUpScreen';
import { SessionContext, sampleAccount } from '../src/fixtures/session';

const mockApi = api as unknown as Record<string, jest.Mock>;

const fetchMock = jest.fn();
const reply = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  __resetKV();
  setAccount(DEFAULT_ACCOUNT);
  Object.values(mockApi).forEach(f => f.mockClear?.());
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  setSession({ token: 'tok', user_id: 1, email: 'admin@acme.in' });
  mockPick = '';
});

const account = (a: Partial<AccountInfo>): AccountInfo => ({
  ...DEFAULT_ACCOUNT,
  ...a,
  permissions: { ...ALL_SECTIONS, ...(a.permissions ?? {}) },
});

describe('which errors sign you out', () => {
  it('401 and a suspended account do; a refused section or admin action does not', async () => {
    fetchMock.mockReturnValueOnce(reply(401, { detail: 'Expired' }));
    await expect(request('/client/me')).rejects.toBeInstanceOf(AuthError);
    fetchMock.mockReturnValueOnce(
      reply(403, { detail: { reason: 'suspended', message: 'Suspended' } }),
    );
    await expect(request('/client/me')).rejects.toBeInstanceOf(AuthError);

    fetchMock.mockReturnValueOnce(
      reply(403, {
        detail: { reason: 'section_forbidden', message: 'No access' },
      }),
    );
    const refused = await request('/client/me').catch((e: Error) => e);
    expect(refused).not.toBeInstanceOf(AuthError);
    expect((refused as Error).message).toBe('No access');
    fetchMock.mockReturnValueOnce(
      reply(403, { detail: 'Only an organisation admin can do this.' }),
    );
    const admin = await request('/client/org').catch(e => e);
    expect(admin).not.toBeInstanceOf(AuthError);
  });
});

describe('account store', () => {
  it('starts as an individual with the default sections, and fills in missing ones', () => {
    expect(getAccount()).toEqual(DEFAULT_ACCOUNT);
    setAccount({
      account_type: 'organisation',
      org: { id: 3, name: 'Acme', role: 'member' },
      permissions: { projects: false } as AccountInfo['permissions'],
    });
    // Portal search is off unless the server says otherwise.
    expect(getAccount().permissions).toEqual({
      ...ALL_SECTIONS,
      projects: false,
      portal_search: false,
    });
    setAccount({ permissions: { portal_search: true } as never });
    expect(getAccount().permissions.portal_search).toBe(true);
  });

  it('reads /client/me, and forgets the account on sign-out', async () => {
    mockApi.me.mockResolvedValueOnce({
      user_id: 1,
      email: 'a@b.c',
      display_name: 'A',
      ...account({
        account_type: 'organisation',
        org: { id: 3, name: 'Acme', role: 'admin' },
      }),
    });
    await refreshAccount();
    expect(getAccount().org?.name).toBe('Acme');
    clearSession();
    expect(getAccount()).toEqual(DEFAULT_ACCOUNT);
  });
});

// --- Rendering helpers ---

const isPressable = (n: ReactTestInstance) =>
  typeof n.type !== 'string' && typeof n.props.onPress === 'function';
const textIn = (n: ReactTestInstance) =>
  n
    .findAll(c => (c.type as unknown) === 'Text')
    .map(c => [c.props.children].flat().join(''))
    .join(' ');
const screenText = (r: Renderer) => textIn(r.root);
/** Innermost pressable showing `text` (the last match: the sheet on top). */
const byText = (r: Renderer, text: string) => {
  const hits = r.root.findAll(n => isPressable(n) && textIn(n) === text);
  if (!hits.length) throw new Error(`No pressable "${text}"`);
  return hits[hits.length - 1];
};
const press = async (n: ReactTestInstance) => {
  await ReactTestRenderer.act(async () => {
    n.props.onPress();
  });
};
const type = async (r: Renderer, label: string, value: string) => {
  const field = r.root.findAll(
    n => n.props.label === label && n.props.onChangeText,
  )[0];
  await ReactTestRenderer.act(async () => {
    field.props.onChangeText(value);
  });
};
const flush = () =>
  ReactTestRenderer.act(async () => {
    await new Promise(res => setTimeout(res, 0));
  });

describe('sections the organisation turned off are hidden', () => {
  it('no Projects tab, stars, pipeline or bookmark tiles; Archive still listed', async () => {
    setAccount(
      account({
        account_type: 'organisation',
        org: { id: 3, name: 'Acme', role: 'member' },
        permissions: { projects: false, bookmarks: false } as never,
      }),
    );
    let r!: Renderer;
    await ReactTestRenderer.act(async () => {
      r = ReactTestRenderer.create(<App mode="demo" signedIn />);
    });
    const labels = () =>
      r.root
        .findAll(n => isPressable(n))
        .map(n => String(n.props.accessibilityLabel ?? ''));
    expect(labels()).not.toContain('Projects');
    expect(labels()).toContain('Tenders');
    expect(labels().some(l => l.startsWith('Bookmarked organisations'))).toBe(
      false,
    );
    expect(labels().some(l => l.startsWith('Active projects'))).toBe(false);
    expect(screenText(r)).not.toContain('ACTIVE BID PIPELINE');
    await press(
      r.root.findAll(
        n =>
          isPressable(n) &&
          n.props.accessibilityRole === 'tab' &&
          n.props.accessibilityLabel === 'Tenders',
      )[0],
    );
    expect(labels()).not.toContain('Save tender');
    expect(labels()).not.toContain('Bookmark organisation');
    await press(
      r.root.findAll(
        n =>
          isPressable(n) &&
          n.props.accessibilityRole === 'tab' &&
          n.props.accessibilityLabel === 'More',
      )[0],
    );
    const out = screenText(r);
    expect(out).toContain('Archive');
    expect(out).toContain('Acme · Member');
    r.unmount();
  });
});

// --- Organisation page, live (api mocked) ---

const live = { mode: 'live' } as unknown as TenderSource;
const Stack = createNativeStackNavigator();

const clients: QueryClient[] = [];
afterEach(() => {
  // No react-query timers left running once a test is done.
  clients.splice(0).forEach(c => c.clear());
});

async function renderPage(page: React.ComponentType) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(qc);
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
            <TenderSourceContext.Provider value={live}>
              <NavigationContainer>
                <Stack.Navigator>
                  <Stack.Screen name="Page" component={page} />
                </Stack.Navigator>
              </NavigationContainer>
            </TenderSourceContext.Provider>
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
  await flush();
  return r;
}

describe('Organisation page', () => {
  beforeEach(() => {
    mockApi.me.mockImplementation(async () => ({
      user_id: 1,
      email: 'admin@acme.in',
      display_name: 'Admin',
      ...getAccount(),
    }));
  });

  it('an individual creates one, or asks to join one after the warning', async () => {
    const r = await renderPage(OrganisationScreen);
    expect(screenText(r)).toContain('Individual account');
    await type(r, 'Organisation name', 'Acme Infra');
    await press(byText(r, 'Create organisation'));
    expect(mockApi.createOrg).toHaveBeenCalledWith('Acme Infra');

    await type(r, 'Join code', 'abcd2345');
    await type(r, 'Note to the admin (optional)', 'Site engineer');
    await press(byText(r, 'Request to join'));
    expect(mockApi.requestJoin).toHaveBeenCalledWith(
      'ABCD2345',
      'Site engineer',
    );
    r.unmount();
  });

  it('a pending request can be cancelled', async () => {
    setAccount(
      account({
        pending_request: {
          id: 9,
          user_id: 1,
          org_id: 3,
          status: 'pending',
          note: '',
          created_at: 1792700000,
          decided_at: null,
          org_name: 'Acme',
          email: 'admin@acme.in',
          display_name: 'Admin',
        },
      }),
    );
    const r = await renderPage(OrganisationScreen);
    expect(screenText(r)).toContain('Request to join Acme');
    await press(byText(r, 'Cancel request'));
    expect(mockApi.cancelJoinRequest).toHaveBeenCalled();
    r.unmount();
  });

  it('an admin approves with chosen sections, sets a member’s sections and removes them', async () => {
    setAccount(
      account({
        account_type: 'organisation',
        org: { id: 3, name: 'Acme', role: 'admin' },
      }),
    );
    const detail: OrgDetail = {
      id: 3,
      name: 'Acme',
      join_code: 'K7PQ2MXA',
      status: 'active',
      created_at: 1792600000,
      members: [
        {
          user_id: 1,
          role: 'admin',
          joined_at: 1792600000,
          email: 'admin@acme.in',
          display_name: 'Admin',
          status: 'active',
          last_seen_at: null,
          permissions: ALL_SECTIONS,
        },
        {
          user_id: 2,
          role: 'member',
          joined_at: 1792650000,
          email: 'eng@acme.in',
          display_name: 'Engineer',
          status: 'active',
          last_seen_at: null,
          permissions: ALL_SECTIONS,
        },
      ],
      pending_requests: [
        {
          id: 21,
          user_id: 5,
          org_id: 3,
          status: 'pending',
          note: 'New hire',
          created_at: 1792700000,
          decided_at: null,
          org_name: 'Acme',
          email: 'new@acme.in',
          display_name: 'Newcomer',
        },
      ],
    };
    mockApi.org.mockResolvedValue(detail);
    const r = await renderPage(OrganisationScreen);
    const out = screenText(r);
    expect(out).toContain('K7PQ2MXA');
    expect(out).toContain('Newcomer');
    expect(out).toContain('Members · 2');

    // Approve: all sections on by default; turn Projects off first.
    await press(byText(r, 'Approve'));
    const projects = r.root
      .findAll(
        n => n.props.accessibilityLabel === 'Projects' && n.props.onValueChange,
      )
      .slice(-1)[0];
    await ReactTestRenderer.act(async () => {
      projects.props.onValueChange(false);
    });
    await press(byText(r, 'Approve'));
    // The server's defaults (portal search off), with Projects turned off here.
    expect(mockApi.approveRequest).toHaveBeenCalledWith(21, {
      ...ALL_SECTIONS,
      projects: false,
      portal_search: false,
    });

    // A member: sections are saved as they change; removal keeps or wipes.
    await press(
      r.root.findAll(
        n =>
          isPressable(n) && n.props.accessibilityLabel === 'Engineer, member',
      )[0],
    );
    const bookmarks = r.root
      .findAll(
        n =>
          n.props.accessibilityLabel === 'Bookmarks' && n.props.onValueChange,
      )
      .slice(-1)[0];
    await ReactTestRenderer.act(async () => {
      bookmarks.props.onValueChange(false);
    });
    expect(mockApi.setMemberPermissions).toHaveBeenCalledWith(2, {
      bookmarks: false,
    });
    mockPick = 'Remove and wipe their account';
    await press(byText(r, 'Remove from organisation'));
    await flush();
    expect(mockApi.delinkMember).toHaveBeenCalledWith(2, false);
    r.unmount();
  });
});

describe('Sign-up', () => {
  it('needs an organisation name for an organisation, then sends the type', async () => {
    const signUp = jest.fn(async () => {});
    const Page = () => (
      <SessionContext.Provider
        value={{
          signedIn: false,
          account: sampleAccount,
          signIn: async () => {},
          signUp,
          signOut: () => {},
        }}
      >
        <SignUpScreen />
      </SessionContext.Provider>
    );
    const r = await renderPage(Page);
    await press(byText(r, 'Organisation'));
    await type(r, 'Your name', 'Asha');
    await type(r, 'Work email', 'asha@acme.in');
    await type(r, 'Password', 'longenough');
    await press(byText(r, 'Create account'));
    expect(signUp).not.toHaveBeenCalled();
    expect(screenText(r)).toContain('Enter the organisation’s name.');

    await type(r, 'Organisation name', 'Acme Infra');
    await press(byText(r, 'Create account'));
    expect(signUp).toHaveBeenCalledWith({
      name: 'Asha',
      email: 'asha@acme.in',
      password: 'longenough',
      accountType: 'organisation',
      orgName: 'Acme Infra',
    });
    r.unmount();
  });
});
