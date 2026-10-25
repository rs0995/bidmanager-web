/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../src/components/ui';
import { SessionProvider } from '../src/state/session';
import { ThemeProvider } from '../src/theme';
import { ArchiveScreen } from '../src/app/screens/ArchiveScreen';
import { CaptchasScreen } from '../src/app/screens/CaptchasScreen';
import { ConnectScreen } from '../src/app/screens/ConnectScreen';
import { CustomJobEditorScreen } from '../src/app/screens/CustomJobEditorScreen';
import { JobDetailScreen } from '../src/app/screens/JobDetailScreen';
import { JobsScreen } from '../src/app/screens/JobsScreen';
import { LogsScreen } from '../src/app/screens/LogsScreen';
import { OrgDetailScreen } from '../src/app/screens/OrgDetailScreen';
import { MoreScreen } from '../src/app/screens/MoreScreen';
import { ScraperScreen } from '../src/app/screens/ScraperScreen';
import { ServerScreen } from '../src/app/screens/ServerScreen';
import { SettingsScreen } from '../src/app/screens/SettingsScreen';
import { UserDetailScreen } from '../src/app/screens/UserDetailScreen';
import { UserSyncListScreen } from '../src/app/screens/UserSyncListScreen';
import { UsersScreen } from '../src/app/screens/UsersScreen';

const Stack = createNativeStackNavigator<any>();

// [route name, screen, params, text that only appears once server data rendered]
const SCREENS: [string, React.ComponentType<any>, object | undefined, string][] = [
  ['Server', ServerScreen, undefined, 'rev-42'],
  ['Jobs', JobsScreen, undefined, 'fetch tenders selected'],
  ['Captchas', CaptchasScreen, undefined, 'Status 2026_PWD_1'],
  ['Scraper', ScraperScreen, undefined, 'Every 6h · M Tu W Th F Sa'],
  ['More', MoreScreen, undefined, '1 waiting on you'],
  ['Archive', ArchiveScreen, undefined, 'AOC'],
  ['Users', UsersScreen, undefined, 'Rakshit Infra · Member'],
  ['UserDetail', UserDetailScreen, { userId: 1 }, 'Member of Rakshit Infra'],
  ['UserDetail', UserDetailScreen, { userId: 1 }, 'Lets the user look up a tender ID on a NIC portal'],
  ['Users', UsersScreen, undefined, 'Portal search'],
  ['OrgDetail', OrgDetailScreen, { orgId: 1 }, 'Please add me'],
  ['UserSyncList', UserSyncListScreen, { userId: 1, section: 'bookmarks' }, 'Road works'],
  ['UserSyncList', UserSyncListScreen, { userId: 1, section: 'activity' }, 'GET /client/tenders'],
  ['JobDetail', JobDetailScreen, { jobId: 2 }, 'Public Works Department'],
  ['Logs', LogsScreen, undefined, 'Job queued for worker'],
  ['Settings', SettingsScreen, undefined, 'Skip tenders already in the queue'],
  ['Connect', ConnectScreen, undefined, 'Save and connect'],
  ['CustomJobEditor', CustomJobEditorScreen, { jobId: 2, websiteId: 1 }, 'Public Works Department'],
];

// All rendered text, joined (props can hold circular objects, so no JSON.stringify).
function renderedText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(renderedText).join(' ');
  const children = (node as { children?: unknown }).children;
  return children ? renderedText(children) : '';
}

async function waitForText(tree: ReactTestRenderer.ReactTestRenderer, text: string) {
  for (let i = 0; i < 60; i++) {
    if (renderedText(tree.toJSON()).includes(text)) return;
    await ReactTestRenderer.act(() => new Promise<void>(r => setTimeout(r, 25)));
  }
  throw new Error(`"${text}" never rendered`);
}

describe.each(SCREENS)('%s screen', (name, Component, params, expected) => {
  it('renders server data', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <QueryClientProvider client={client}>
          <ThemeProvider>
            <SessionProvider>
              <ToastProvider>
                <NavigationContainer>
                  <Stack.Navigator screenOptions={{ headerShown: false }}>
                    <Stack.Screen name={name} component={Component} initialParams={params} />
                  </Stack.Navigator>
                </NavigationContainer>
              </ToastProvider>
            </SessionProvider>
          </ThemeProvider>
        </QueryClientProvider>,
      );
    });
    await waitForText(tree!, expected);
    await ReactTestRenderer.act(() => tree!.unmount());
    client.clear();
  });
});
