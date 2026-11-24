import React from 'react';
import {
  BottomTabBarProps,
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';
import { DashboardScreen } from '../screens/DashboardScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { ProjectsScreen } from '../screens/ProjectsScreen';
import { TendersScreen } from '../screens/TendersScreen';
import { TabBar } from './TabBar';
import { TabParamList } from './types';
import { usePushOpens } from './usePushOpens';
import { useAccess } from '../../lib/account';

const Tab = createBottomTabNavigator<TabParamList>();

const renderTabBar = (props: BottomTabBarProps) => <TabBar {...props} />;

export function TabNavigator() {
  // Notification taps open their tender, organisation or CAPTCHA.
  usePushOpens();
  // Sections an organisation turned off for this member leave the tab bar.
  const access = useAccess();
  return (
    <Tab.Navigator
      initialRouteName="Dashboard"
      tabBar={renderTabBar}
      screenOptions={{
        headerShown: false,
        // Tabs you aren't looking at don't re-render on every store or sync change.
        freezeOnBlur: true,
      }}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      {access.active ? (
        <Tab.Screen name="Tenders" component={TendersScreen} />
      ) : null}
      {access.projects ? (
        <Tab.Screen name="Projects" component={ProjectsScreen} />
      ) : null}
      <Tab.Screen name="More" component={MoreScreen} />
    </Tab.Navigator>
  );
}
