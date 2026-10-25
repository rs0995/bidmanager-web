import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { NextDeadlineCard } from '../../components/dashboard/NextDeadlineCard';
import { PipelineCard } from '../../components/dashboard/PipelineCard';
import { BookmarksTile, StatTile } from '../../components/dashboard/StatTiles';
import { SyncBar } from '../../components/dashboard/SyncBar';
import { UpcomingDeadlines } from '../../components/dashboard/UpcomingDeadlines';
import { WeekStrip } from '../../components/dashboard/WeekStrip';
import { Screen, ScreenHeader } from '../../components/ui';
import { useAlerts } from '../../fixtures/alerts';
import { useBookmarks } from '../../fixtures/bookmarks';
import { dashboardHeader, today } from '../../fixtures/dashboard';
import { useProjects } from '../../fixtures/projects';
import { useSession } from '../../fixtures/session';
import { useTenderSource } from '../../data/tenderSource';
import { syncTime, useActions } from '../../data/actions';
import {
  ATTENTION_HOURS,
  hasDeadline,
  needsAttention,
} from '../../lib/attention';
import { buildCalendar } from '../../lib/calendar';
import { groupUpcoming, hoursUntilClose } from '../../lib/deadlines';
import { parseCrores } from '../../lib/format';
import { closingThisWeek as closingWeek } from '../../lib/tenderFilters';
import { useAccess } from '../../lib/account';
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
  const source = useTenderSource();
  const { tenders } = source.usePipeline();
  const { activeTenders } = source.useStats();
  const { account } = useSession();
  const { lastSyncAt } = useActions();
  const demo = source.mode === 'demo';
  // Sample data is pinned to its own "today"; live mode uses the real date.
  const now = demo ? today : new Date();

  const access = useAccess();
  const attention = useMemo(
    () => needsAttention(tenders, projects, isBookmarked),
    [tenders, projects, isBookmarked],
  );
  // Same list the tile opens (ClosingThisWeekScreen).
  const closingThisWeek = useMemo(
    () => closingWeek(tenders, isBookmarked).length,
    [tenders, isBookmarked],
  );
  // The active bid pipeline: every project not yet submitted, and its combined value.
  const inPreparation = useMemo(
    () => projects.filter(p => p.status !== 'Submitted'),
    [projects],
  );
  const prepCrores = useMemo(
    () => inPreparation.reduce((sum, p) => sum + parseCrores(p.value), 0),
    [inPreparation],
  );
  const calendar = useMemo(
    () => buildCalendar(tenders, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tenders, now.toDateString()],
  );
  const upcoming = useMemo(() => groupUpcoming(tenders, 8), [tenders]);
  // The card's fallback: the next deadline, only if it is within 5 days too.
  const next = useMemo(
    () =>
      [...tenders]
        .filter(
          x => hasDeadline(x) && hoursUntilClose(x.closeIn) <= ATTENTION_HOURS,
        )
        .sort(
          (a, b) => hoursUntilClose(a.closeIn) - hoursUntilClose(b.closeIn),
        )[0] as (typeof tenders)[number] | undefined,
    [tenders],
  );

  const tiles = [
    access.active ? (
      <StatTile
        key="synced"
        icon="globe"
        tone="accent"
        value={activeTenders ?? 0}
        label="Tenders synced"
        onPress={() =>
          navigation.navigate('Tenders', {
            view: 'tenders',
            bookmarked: false,
          })
        }
      />
    ) : null,
    access.bookmarks ? (
      <BookmarksTile
        key="bookmarks"
        orgs={orgCount}
        tenders={count}
        // As BM Pro: bookmarks open their own page.
        onOrgs={() => navigation.navigate('Bookmarks', { view: 'orgs' })}
        onTenders={() => navigation.navigate('Bookmarks', { view: 'tenders' })}
      />
    ) : null,
    access.projects ? (
      <StatTile
        key="projects"
        icon="folder"
        tone="good"
        value={projects.length}
        label="Active projects"
        onPress={() => navigation.navigate('Projects')}
      />
    ) : null,
    access.bookmarks ? (
      <StatTile
        key="closing"
        icon="clock"
        tone="crit"
        value={closingThisWeek}
        label="Closing this week"
        onPress={() => navigation.navigate('ClosingThisWeek')}
      />
    ) : null,
  ].filter(Boolean);

  return (
    <Screen tabBar>
      <ScreenHeader
        initials={demo ? dashboardHeader.initials : account.initials}
        title={dashboardHeader.title}
        subtitle={
          demo
            ? `${dashboardHeader.company} · synced ${dashboardHeader.syncedAgo}`
            : `${account.workspace || account.email} · synced ${syncTime(
                lastSyncAt,
              )}`
        }
        unread={unread}
        onBellPress={() => navigation.navigate('Alerts')}
      />
      <WeekStrip days={calendar} />
      <NextDeadlineCard
        items={attention}
        next={next}
        onOpenItem={it =>
          it.project
            ? navigation.navigate('ProjectDetail', { id: it.project.id })
            : navigation.navigate('TenderDetail', { id: it.tender.id })
        }
        onOpenTender={tender =>
          navigation.navigate('TenderDetail', { id: tender.id })
        }
        onSeeMore={() => navigation.navigate('NeedsAttention')}
      />

      {access.projects ? (
        <PipelineCard
          crores={prepCrores}
          activeCount={inPreparation.length}
          onViewPipeline={() => navigation.navigate('Projects')}
        />
      ) : null}

      {/* Two per row; tiles for sections the organisation turned off are left out. */}
      {pairs(tiles).map((row, i) => (
        <View key={i} style={styles.tileRow}>
          {row}
        </View>
      ))}

      <SyncBar />
      <UpcomingDeadlines
        groups={upcoming}
        onOpen={id => navigation.navigate('TenderDetail', { id })}
      />
    </Screen>
  );
}

/** Groups the tiles two to a row. */
const pairs = <T,>(items: T[]): T[][] => {
  const rows: T[][] = [];
  items.forEach((x, i) =>
    i % 2 ? rows[rows.length - 1].push(x) : rows.push([x]),
  );
  return rows;
};

const styles = StyleSheet.create({
  tileRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
});
