import React from 'react';
import {
  BottomTabBarProps,
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';
import { JobsScreen } from '../screens/JobsScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { ScraperScreen } from '../screens/ScraperScreen';
import { ServerScreen } from '../screens/ServerScreen';
import { UsersScreen } from '../screens/UsersScreen';
import { TabBar } from './TabBar';
import { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

const renderTabBar = (props: BottomTabBarProps) => <TabBar {...props} />;

export function TabNavigator() {
  return (
    <Tab.Navigator
      initialRouteName="Server"
      tabBar={renderTabBar}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Server" component={ServerScreen} />
      <Tab.Screen name="Scraper" component={ScraperScreen} />
      <Tab.Screen name="Users" component={UsersScreen} />
      <Tab.Screen name="Jobs" component={JobsScreen} />
      <Tab.Screen name="More" component={MoreScreen} />
    </Tab.Navigator>
  );
}
