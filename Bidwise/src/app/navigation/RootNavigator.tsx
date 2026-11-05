import React from 'react';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSession } from '../../fixtures/session';
import { useTheme } from '../../theme';
import { ArchiveScreen } from '../screens/ArchiveScreen';
import { BidAgentChatScreen } from '../screens/BidAgentChatScreen';
import { CaptchaScreen } from '../screens/CaptchaScreen';
import { DetailScreen } from '../screens/DetailScreen';
import { DownloadsScreen } from '../screens/DownloadsScreen';
import { ExportScreen } from '../screens/ExportScreen';
import { NeedsAttentionScreen } from '../screens/NeedsAttentionScreen';
import { NotificationSettingsScreen } from '../screens/NotificationSettingsScreen';
import { NewTendersScreen } from '../screens/NewTendersScreen';
import { OrgTendersScreen } from '../screens/OrgTendersScreen';
import { ArchivedProjectsScreen } from '../screens/ArchivedProjectsScreen';
import { BookmarksScreen } from '../screens/BookmarksScreen';
import { ClosingThisWeekScreen } from '../screens/ClosingThisWeekScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { SignUpScreen } from '../screens/SignUpScreen';
import { OrganisationScreen } from '../screens/OrganisationScreen';
import { PortalSearchScreen } from '../screens/PortalSearchScreen';
import { ZipContentsScreen } from '../screens/ZipContentsScreen';
import { TabNavigator } from './TabNavigator';
import { RootStackParamList } from './types';
import { gated } from '../../components/feedback/SectionOff';

const Stack = createNativeStackNavigator<RootStackParamList>();

// Pages of a section the organisation can turn off show SectionOff instead.
const Archive = gated('archived', ArchiveScreen);
const Bookmarks = gated('bookmarks', BookmarksScreen);
const ClosingThisWeek = gated('bookmarks', ClosingThisWeekScreen);
const ArchivedProjects = gated('projects', ArchivedProjectsScreen);
const PortalSearch = gated('portal_search', PortalSearchScreen);

export function RootNavigator() {
  const t = useTheme();
  const { signedIn } = useSession();
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
        {signedIn ? (
          <>
            <Stack.Screen name="Tabs" component={TabNavigator} />
            <Stack.Screen name="TenderDetail" component={DetailScreen} />
            <Stack.Screen name="ProjectDetail" component={DetailScreen} />
            <Stack.Screen name="ClosingThisWeek" component={ClosingThisWeek} />
            <Stack.Screen name="Downloads" component={DownloadsScreen} />
            <Stack.Screen name="Archive" component={Archive} />
            <Stack.Screen name="Captcha" component={CaptchaScreen} />
            <Stack.Screen name="ZipContents" component={ZipContentsScreen} />
            <Stack.Screen
              name="BidAgentChat"
              component={BidAgentChatScreen}
              options={{ presentation: 'modal' }}
            />
            <Stack.Screen name="OrgTenders" component={OrgTendersScreen} />
            <Stack.Screen name="Bookmarks" component={Bookmarks} />
            <Stack.Screen
              name="ArchivedProjects"
              component={ArchivedProjects}
            />
            <Stack.Screen name="NewTenders" component={NewTendersScreen} />
            <Stack.Screen name="Export" component={ExportScreen} />
            <Stack.Screen name="Organisation" component={OrganisationScreen} />
            <Stack.Screen name="PortalSearch" component={PortalSearch} />
            <Stack.Screen
              name="NeedsAttention"
              component={NeedsAttentionScreen}
            />
            <Stack.Screen
              name="NotificationSettings"
              component={NotificationSettingsScreen}
            />
          </>
        ) : (
          <>
            <Stack.Screen name="SignIn" component={SignInScreen} />
            <Stack.Screen name="SignUp" component={SignUpScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
