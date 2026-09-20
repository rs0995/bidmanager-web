import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ClosingSoonList } from '../../components/dashboard/ClosingSoonList';
import { PipelineCard } from '../../components/dashboard/PipelineCard';
import {
  NextDeadlineCard,
  SyncCard,
} from '../../components/dashboard/TwinCards';
import { WeekStrip } from '../../components/dashboard/WeekStrip';
import { Chip, Screen, ScreenHeader } from '../../components/ui';
import { dashboardHeader, portals, week } from '../../fixtures/dashboard';
import { useAlerts } from '../../fixtures/alerts';
import type { RootStackParamList, TabParamList } from '../navigation/types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Dashboard'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export function DashboardScreen() {
  const navigation = useNavigation<Nav>();
  const { unread } = useAlerts();
  const [portal, setPortal] = useState(portals[0]);

  return (
    <Screen tabBar>
      <ScreenHeader
        initials={dashboardHeader.initials}
        title={dashboardHeader.title}
        subtitle={`${dashboardHeader.company} · synced ${dashboardHeader.syncedAgo}`}
        unread={unread}
        onBellPress={() => navigation.navigate('Alerts')}
      />
      <WeekStrip days={week} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chips}
      >
        {portals.map(p => (
          <Chip
            key={p}
            label={p}
            selected={p === portal}
            onPress={() => setPortal(p)}
          />
        ))}
      </ScrollView>
      <PipelineCard />
      <View style={styles.twin}>
        <NextDeadlineCard />
        <SyncCard />
      </View>
      <ClosingSoonList
        onSeeAll={() => navigation.navigate('ClosingThisWeek')}
        onOpen={id => navigation.navigate('TenderDetail', { id })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipScroll: { marginHorizontal: -18, marginBottom: 18, flexGrow: 0 },
  chips: { paddingHorizontal: 18, gap: 8, paddingVertical: 4 },
  twin: { flexDirection: 'row', gap: 12, marginBottom: 14 },
});
