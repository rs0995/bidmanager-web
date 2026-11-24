import React from 'react';
import { Platform } from 'react-native';
import {
  DefaultTheme,
  LinkingOptions,
  NavigationContainer,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSession } from '../../state/session';
import { useTheme } from '../../theme';
import { ArchiveScreen } from '../screens/ArchiveScreen';
import { CaptchasScreen } from '../screens/CaptchasScreen';
import { ConnectScreen } from '../screens/ConnectScreen';
import { CustomJobEditorScreen } from '../screens/CustomJobEditorScreen';
import { JobDetailScreen } from '../screens/JobDetailScreen';
import { LogsScreen } from '../screens/LogsScreen';
import { OrgDetailScreen } from '../screens/OrgDetailScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { UserDetailScreen } from '../screens/UserDetailScreen';
import { UserSyncListScreen } from '../screens/UserSyncListScreen';
import { TabNavigator } from './TabNavigator';
import { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

// Browser preview only: every screen gets a URL (/jobs, /captchas, /users/1…) so
// it can be opened or reloaded directly. Native builds don't use deep links yet.
const webLinking: LinkingOptions<RootStackParamList> | undefined =
  Platform.OS === 'web'
    ? {
        prefixes: [],
        config: {
          screens: {
            Tabs: {
              screens: {
                Server: '',
                Jobs: 'jobs',
                Users: 'users',
                Scraper: 'scraper',
                More: 'more',
              },
            },
            Connect: 'connect',
            Archive: 'archive',
            Captchas: 'captchas',
            UserDetail: 'users/:userId',
            OrgDetail: 'users/orgs/:orgId',
            UserSyncList: 'users/:userId/:section',
            JobDetail: 'scraper/jobs/:jobId',
            Logs: 'logs',
            Settings: 'settings',
            CustomJobEditor: 'scraper/job',
          },
        },
      }
    : undefined;

export function RootNavigator() {
  const t = useTheme();
  const { ready, adminKey } = useSession();
  const navTheme = {
    ...DefaultTheme,
    dark: false,
    colors: {
      ...DefaultTheme.colors,
      background: t.colors.bg,
      card: t.colors.bg,
      text: t.colors.ink,
      border: t.colors.hair,
      primary: t.colors.accent,
    },
  };

  // Wait for the saved key before choosing the first screen: no key → Connect.
  if (!ready) return null;

  // Without a key the preview URL must not skip the Connect screen.
  return (
    <NavigationContainer
      theme={navTheme}
      linking={adminKey ? webLinking : undefined}
    >
      <Stack.Navigator
        initialRouteName={adminKey ? 'Tabs' : 'Connect'}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Tabs" component={TabNavigator} />
        <Stack.Screen
          name="Connect"
          component={ConnectScreen}
          options={{ presentation: 'modal' }}
        />
        <Stack.Screen name="Archive" component={ArchiveScreen} />
        <Stack.Screen name="Captchas" component={CaptchasScreen} />
        <Stack.Screen name="UserDetail" component={UserDetailScreen} />
        <Stack.Screen name="UserSyncList" component={UserSyncListScreen} />
        <Stack.Screen name="JobDetail" component={JobDetailScreen} />
        <Stack.Screen name="OrgDetail" component={OrgDetailScreen} />
        <Stack.Screen name="Logs" component={LogsScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen
          name="CustomJobEditor"
          component={CustomJobEditorScreen}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
