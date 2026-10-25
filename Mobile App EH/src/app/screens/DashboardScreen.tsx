import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { NeedsAttentionCard } from '../../components/dashboard/NeedsAttentionCard';
import { NextDeadlineCard } from '../../components/dashboard/NextDeadlineCard';
import { PipelineCard } from '../../components/dashboard/PipelineCard';
import { BookmarksTile, StatTile } from '../../components/dashboard/StatTiles';
import { SyncBar } from '../../components/dashboard/SyncBar';
import { UpcomingDeadlines } from '../../components/dashboard/UpcomingDeadlines';
import { WeekStrip } from '../../components/dashboard/WeekStrip';
import { Screen, ScreenHeader } from '../../components/ui';
import { useAlerts } from '../../fixtures/alerts';
import { useBookmarks } from '../../fixtures/bookmarks';
import {
  dashboardHeader,
  dashboardStats,
  today,
} from '../../fixtures/dashboard';
import { ARCHIVED_COUNT, useProjects } from '../../fixtures/projects';
import { tenders } from '../../fixtures/tenders';
import { needsAttention } from '../../lib/attention';
import { buildCalendar } from '../../lib/calendar';
import { groupUpcoming, hoursUntilClose } from '../../lib/deadlines';
import { parseCrores } from '../../lib/format';
import { closesWithinDays } from '../../lib/tenderFilters';
import type { RootStackParamList, TabParamList } from '../navigation/types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Dashboard'>,
  NativeStackNavigationProp<RootStackParamList>
>;

export function DashboardScreen() {
  const navigation = useNavigation<Nav>();
  const { unread } = useAlerts();
  const { isBookmarked, count, orgCount } = useBookmarks();
  const { projects } = useProjects();

  const attention = useMemo(
    () => needsAttention(tenders, projects, isBookmarked),
    [projects, isBookmarked],
  );
  const bookmarkedTenders = useMemo(
    () => tenders.filter(t => isBookmarked(t.id)),
    [isBookmarked],
  );
  const closingThisWeek = useMemo(
    () => bookmarkedTenders.filter(t => closesWithinDays(t, 7)).length,
    [bookmarkedTenders],
  );
  const closingSoon = useMemo(
    () => bookmarkedTenders.filter(t => closesWithinDays(t, 3)).length,
    [bookmarkedTenders],
  );
  const pipelineCrores = useMemo(
    () => bookmarkedTenders.reduce((sum, t) => sum + parseCrores(t.value), 0),
    [bookmarkedTenders],
  );
  // Bids currently in preparation, as a share of the bookmarked tenders' combined value.
  const prepCrores = useMemo(
    () =>
      projects
        .filter(p => p.status === 'Bid in preparation')
        .reduce((sum, p) => sum + parseCrores(p.value), 0),
    [projects],
  );
  const prepPct = pipelineCrores ? Math.min(1, prepCrores / pipelineCrores) : 0;
  const calendar = useMemo(() => buildCalendar(tenders, today), []);
  const upcoming = useMemo(() => groupUpcoming(tenders, 8), []);
  const next = useMemo(
    () =>
      [...tenders].sort(
        (a, b) => hoursUntilClose(a.closeIn) - hoursUntilClose(b.closeIn),
      )[0],
    [],
  );

  return (
    <Screen tabBar>
      <ScreenHeader
        initials={dashboardHeader.initials}
        title={dashboardHeader.title}
        subtitle={`${dashboardHeader.company} · synced ${dashboardHeader.syncedAgo}`}
        unread={unread}
        onBellPress={() => navigation.navigate('Alerts')}
      />
      <WeekStrip days={calendar} />
      <NeedsAttentionCard
        items={attention}
        onOpen={it =>
          it.project
            ? navigation.navigate('ProjectDetail', { id: it.project.id })
            : navigation.navigate('TenderDetail', { id: it.tender.id })
        }
      />

      <PipelineCard
        crores={pipelineCrores}
        prepPct={prepPct}
        stats={[
          {
            label: 'Bookmarked',
            count: bookmarkedTenders.length,
            ratio: tenders.length
              ? bookmarkedTenders.length / tenders.length
              : 0,
          },
          {
            label: 'Active',
            count: projects.length,
            ratio: projects.length / (projects.length + ARCHIVED_COUNT),
          },
        ]}
      />

      <View style={styles.tileRow}>
        <StatTile
          icon="globe"
          tone="accent"
          value={dashboardStats.tendersSynced}
          label="Tenders synced"
          onPress={() =>
            navigation.navigate('Tenders', {
              view: 'tenders',
              bookmarked: false,
            })
          }
        />
        <BookmarksTile
          orgs={orgCount}
          tenders={count}
          onOrgs={() =>
            navigation.navigate('Tenders', { view: 'orgs', bookmarked: true })
          }
          onTenders={() =>
            navigation.navigate('Tenders', {
              view: 'tenders',
              bookmarked: true,
            })
          }
        />
      </View>
      <View style={styles.tileRow}>
        <StatTile
          icon="folder"
          tone="good"
          value={projects.length}
          label="Active projects"
          onPress={() => navigation.navigate('Projects')}
        />
        <StatTile
          icon="clock"
          tone="crit"
          value={closingThisWeek}
          label="Closing this week"
          onPress={() => navigation.navigate('ClosingThisWeek')}
        />
      </View>

      <NextDeadlineCard
        tender={next}
        onPress={() => navigation.navigate('TenderDetail', { id: next.id })}
        closingSoon={closingSoon}
        bookmarked={bookmarkedTenders.length}
      />

      <SyncBar />
      <UpcomingDeadlines
        groups={upcoming}
        onOpen={id => navigation.navigate('TenderDetail', { id })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  tileRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
});
