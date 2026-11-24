import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronRight } from 'lucide-react-native';
import { TenderListPage } from '../../components/tender/TenderListPage';
import { useAlerts } from '../../fixtures/alerts';
import type { Tender } from '../../fixtures/tenders';
import { useTenderSource } from '../../data/tenderSource';
import { checkForAlerts } from '../../lib/alertChecks';
import { hoursUntilClose } from '../../lib/deadlines';
import { parseCrores } from '../../lib/format';
import { parseFlexibleDate } from '../../lib/serverTender';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

type Sort = 'newest' | 'closing' | 'value' | 'emd';
const SORTS: { key: Sort; label: string }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'closing', label: 'Closing soonest' },
  { key: 'value', label: 'Highest value' },
  { key: 'emd', label: 'Highest EMD' },
];

const published = (t: Tender) => parseFlexibleDate(t.published)?.getTime() ?? 0;

/**
 * The tenders a "new tenders under ORG" alert reported (as BM Pro's new-tenders page),
 * with search and sort, and a way on to all of that organisation's tenders.
 */
export function NewTendersScreen() {
  const t = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'NewTenders'>>();
  const source = useTenderSource();
  const { alerts } = useAlerts();
  // From a notification (`org`), sync first: its alert may not be built on this
  // phone yet. Then the organisation's newest "new tenders" alert (alerts are newest
  // first).
  const fromPush = !params.alertId && Boolean(params.org);
  const [syncing, setSyncing] = useState(fromPush && source.mode === 'live');
  useEffect(() => {
    if (!syncing) return;
    let alive = true;
    checkForAlerts()
      .catch(() => 0)
      .finally(() => alive && setSyncing(false));
    return () => {
      alive = false;
    };
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const alert = params.alertId
    ? alerts.find(a => a.id === params.alertId)
    : alerts.find(a => a.kind === 'new' && a.orgName === params.org);
  // The alert's tenders (older single-tender alerts only carry `tenderId`).
  const ids = useMemo(
    () =>
      syncing
        ? []
        : alert?.newTenderIds?.length
        ? alert.newTenderIds
        : alert?.tenderId
        ? [alert.tenderId]
        : [],
    [syncing, alert],
  );
  const org = params.org ?? alert?.orgName ?? '';
  // Just one new tender: open it rather than a list of one.
  const only = !syncing && ids.length === 1 ? String(ids[0]) : null;
  useEffect(() => {
    if (only) navigation.replace('TenderDetail', { id: only });
  }, [only, navigation]);
  const { tenders, loading } = source.useTendersByIds(ids);
  const waiting = syncing || (loading && tenders.length === 0);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('newest');

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = tenders.filter(
      x =>
        !needle ||
        `${x.title} ${x.short} ${x.org} ${x.refId ?? x.id}`
          .toLowerCase()
          .includes(needle),
    );
    return [...rows].sort((a, b) =>
      sort === 'newest'
        ? published(b) - published(a)
        : sort === 'value'
        ? parseCrores(b.value) - parseCrores(a.value)
        : sort === 'emd'
        ? parseCrores(b.emd) - parseCrores(a.emd)
        : hoursUntilClose(a.closeIn) - hoursUntilClose(b.closeIn),
    );
  }, [tenders, search, sort]);

  return (
    <TenderListPage
      title={org || 'New tenders'}
      sub={
        waiting
          ? 'Fetching…'
          : ids.length
          ? `${ids.length} new tender${ids.length === 1 ? '' : 's'}`
          : 'No new tenders'
      }
      tenders={shown}
      loading={waiting}
      loadingText={fromPush ? 'Fetching the new tenders…' : undefined}
      emptyText={
        ids.length
          ? 'No tenders match your search.'
          : fromPush
          ? 'No new tenders to show.'
          : 'This alert no longer has any tenders.'
      }
      search={search}
      onSearch={setSearch}
      sort={sort}
      sorts={SORTS}
      onSort={setSort}
      footer={
        org ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View all tenders from ${org}`}
            onPress={() => navigation.navigate('OrgTenders', { org })}
            style={styles.all}
          >
            <Text style={[styles.allText, { color: t.colors.accent }]}>
              View all tenders from {org}
            </Text>
            <ChevronRight size={16} color={t.colors.accent} />
          </Pressable>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  all: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 16,
  },
  allText: { fontFamily: fonts.semibold, fontSize: 13, flexShrink: 1 },
});
