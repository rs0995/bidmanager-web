import React from 'react';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../../theme';
import { AccountScreen } from '../screens/AccountScreen';
import { AppearanceScreen } from '../screens/AppearanceScreen';
import { AppLockScreen } from '../screens/AppLockScreen';
import { BookmarksScreen } from '../screens/BookmarksScreen';
import { ClosingThisWeekScreen } from '../screens/ClosingThisWeekScreen';
import { DocumentArchiveScreen } from '../screens/DocumentArchiveScreen';
import { DocumentViewScreen } from '../screens/DocumentViewScreen';
import { DownloadsScreen } from '../screens/DownloadsScreen';
import { FilePreviewScreen } from '../screens/FilePreviewScreen';
import { NewTendersScreen } from '../screens/NewTendersScreen';
import { OrgTendersScreen } from '../screens/OrgTendersScreen';
import { ProjectDetailScreen } from '../screens/ProjectDetailScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { TenderDetailScreen } from '../screens/TenderDetailScreen';
import { TabNavigator } from './TabNavigator';
import { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const t = useTheme();
  const navTheme = {
    ...DefaultTheme,
    dark: t.scheme === 'dark',
    colors: {
      ...DefaultTheme.colors,
      background: t.colors.bg,
      card: t.colors.bg,
      text: t.colors.ink,
      border: t.colors.hair,
      primary: t.colors.accent,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Tabs" component={TabNavigator} />
        <Stack.Screen name="TenderDetail" component={TenderDetailScreen} />
        <Stack.Screen name="OrgTenders" component={OrgTendersScreen} />
        <Stack.Screen name="NewTenders" component={NewTendersScreen} />
        <Stack.Screen name="Bookmarks" component={BookmarksScreen} />
        <Stack.Screen name="Downloads" component={DownloadsScreen} />
        <Stack.Screen name="Account" component={AccountScreen} />
        <Stack.Screen name="Appearance" component={AppearanceScreen} />
        <Stack.Screen name="AppLock" component={AppLockScreen} />
        <Stack.Screen name="SignIn" component={SignInScreen} />
        <Stack.Screen name="DocumentView" component={DocumentViewScreen} />
        <Stack.Screen
          name="DocumentArchive"
          component={DocumentArchiveScreen}
        />
        <Stack.Screen name="ProjectDetail" component={ProjectDetailScreen} />
        <Stack.Screen name="FilePreview" component={FilePreviewScreen} />
        <Stack.Screen
          name="ClosingThisWeek"
          component={ClosingThisWeekScreen}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
