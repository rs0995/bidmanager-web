import React from 'react';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../../theme';
import { ClosingThisWeekScreen } from '../screens/ClosingThisWeekScreen';
import { FilePreviewScreen } from '../screens/FilePreviewScreen';
import { OrgTendersScreen } from '../screens/OrgTendersScreen';
import { ProjectDetailScreen } from '../screens/ProjectDetailScreen';
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
