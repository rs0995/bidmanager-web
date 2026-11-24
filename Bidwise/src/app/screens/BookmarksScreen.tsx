import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDownUp, ChevronLeft } from 'lucide-react-native';
import {
  IconButton,
  Screen,
  SearchField,
  Segmented,
  SquareToggle,
} from '../../components/ui';
import { KeepAlivePane } from '../../components/ui/motion';
import { ListStatus, useDebounced } from '../../components/feedback/ListStatus';
import { OrgRow } from '../../components/tender/OrgRow';
import { TenderRow } from '../../components/tender/TenderRow';
import { useBookmarks } from '../../fixtures/bookmarks';
import type { Tender } from '../../fixtures/tenders';
import { useTenderSource, type OrgItem } from '../../data/tenderSource';
import { showActionSheet } from '../../platform/actionSheet';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type View_ = 'orgs' | 'tenders';
type TenderSort = 'closing' | 'value';
type OrgSort = 'count' | 'name';

const TENDER_SORTS: { key: TenderSort; label: string }[] = [
  { key: 'closing', label: 'Closing soonest' },
  { key: 'value', label: 'Highest value' },
];
const ORG_SORTS: { key: OrgSort; label: string }[] = [
  { key: 'count', label: 'Most tenders' },
  { key: 'name', label: 'Name A–Z' },
];

const FIRST_ROWS = 12;

const TenderItem = memo(function TenderItem({
  tender,
  saved,
  onToggle,
  onOpen,
}: {
  tender: Tender;
  saved: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <TenderRow
      tender={tender}
      saved={saved}
      onToggleSave={() => onToggle(tender.id)}
      onOpen={() => onOpen(tender.id)}
    />
  );
});

const OrgItemRow = memo(function OrgItemRow({
  org,
  bookmarked,
  onToggle,
  onOpen,
}: {
  org: OrgItem;
  bookmarked: boolean;
  onToggle: (name: string) => void;
  onOpen: (org: OrgItem) => void;
}) {
  return (
    <OrgRow
      org={org}
      bookmarked={bookmarked}
      onToggleBookmark={() => onToggle(org.name)}
      onOpen={() => onOpen(org)}
    />
  );
});

/** Keeps a callback's identity stable while always calling its latest version. */
function useStable<A extends unknown[]>(fn: (...args: A) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

/** A search field with a sort button beside it (as the organisation page). */
function SearchSort<K extends string>({
  value,
  onChange,
  placeholder,
  sort,
  sorts,
  onSort,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  sort: K;
  sorts: { key: K; label: string }[];
  onSort: (k: K) => void;
  title: string;
}) {
  const t = useTheme();
  const current = sorts.find(s => s.key === sort)?.label ?? '';
  return (
    <SearchField
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      trailing={
        <SquareToggle
          label={`Sort: ${current}`}
          active={false}
          onPress={() =>
            showActionSheet(
              title,
              sorts.map(s => ({
                label: s.label,
                onPress: () => onSort(s.key),
              })),
            )
          }
          icon={<ArrowDownUp size={17} color={t.colors.inkSoft} />}
        />
      }
    />
  );
}

/**
 * Bookmarked organisations and tenders on their own page, opened from the Dashboard's
 * Bookmarks tile (as BM Pro's Bookmarks screen), each with search and sort.
 */
export function BookmarksScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'Bookmarks'>>();
  const { isBookmarked, toggle, isOrgBookmarked, toggleOrg } = useBookmarks();
  const [view, setView] = useState<View_>(params?.view ?? 'orgs');

  const [tenderSearch, setTenderSearch] = useState('');
  const [orgSearch, setOrgSearch] = useState('');
  const [tenderSort, setTenderSort] = useState<TenderSort>('closing');
  const [orgSort, setOrgSort] = useState<OrgSort>('count');
  const tenderQuery = useDebounced(tenderSearch, 300);
  const orgQuery = useDebounced(orgSearch, 300);

  // Every portal: bookmarks aren't scoped to one.
  const source = useTenderSource();
  const list = source.useTenderList({
    portal: null,
    org: null,
    search: tenderQuery,
    savedOnly: true,
    closingSoon: false,
    sort: tenderSort,
  });
  const orgs = source.useOrgList({
    portal: null,
    search: orgQuery,
    bookmarkedOnly: true,
    isOrgBookmarked,
  });
  const orgItems = useMemo(
    () =>
      [...orgs.items].sort((a, b) =>
        orgSort === 'name'
          ? a.name.localeCompare(b.name)
          : b.count - a.count || a.name.localeCompare(b.name),
      ),
    [orgs.items, orgSort],
  );

  const onToggleTender = useStable((id: string) => toggle(id));
  const onOpenTender = useStable((id: string) =>
    navigation.navigate('TenderDetail', { id }),
  );
  const onToggleOrg = useStable((name: string) => toggleOrg(name));
  const onOpenOrg = useStable((org: OrgItem) =>
    navigation.navigate('OrgTenders', {
      org: org.name,
      portal: org.portals[0],
    }),
  );

  const renderTender = useCallback(
    ({ item }: { item: Tender }) => (
      <TenderItem
        tender={item}
        saved={isBookmarked(item.id)}
        onToggle={onToggleTender}
        onOpen={onOpenTender}
      />
    ),
    [isBookmarked, onToggleTender, onOpenTender],
  );
  const renderOrg = useCallback(
    ({ item }: { item: OrgItem }) => (
      <OrgItemRow
        org={item}
        bookmarked={isOrgBookmarked(item.name)}
        onToggle={onToggleOrg}
        onOpen={onOpenOrg}
      />
    ),
    [isOrgBookmarked, onToggleOrg, onOpenOrg],
  );

  const count =
    view === 'orgs'
      ? `${orgItems.length} ${
          orgItems.length === 1 ? 'organisation' : 'organisations'
        }`
      : `${list.total} ${list.total === 1 ? 'tender' : 'tenders'}`;

  const contentStyle = {
    paddingHorizontal: 18,
    paddingBottom: Math.max(insets.bottom, 16) + 16,
  };

  return (
    <Screen scroll={false} flush>
      <View style={styles.top}>
        <View style={styles.head}>
          <IconButton label="Back" onPress={() => navigation.goBack()}>
            <ChevronLeft size={22} color={t.colors.ink} />
          </IconButton>
        </View>
        <Text style={[styles.title, { color: t.colors.ink }]}>Bookmarks</Text>
        <Text style={[styles.sub, { color: t.colors.muted }]}>{count}</Text>
        <Segmented
          style={styles.seg}
          value={view}
          onChange={setView}
          options={[
            { value: 'orgs', label: 'Organisations' },
            { value: 'tenders', label: 'Tenders' },
          ]}
        />
      </View>

      {/* Both lists stay mounted, so switching is instant and keeps each one's place. */}
      <KeepAlivePane active={view === 'orgs'} style={styles.fill}>
        <FlatList
          data={orgItems}
          keyExtractor={item => `${item.portals[0] ?? ''}|${item.name}`}
          renderItem={renderOrg}
          ListHeaderComponent={
            <View style={styles.searchRow}>
              <SearchSort
                value={orgSearch}
                onChange={setOrgSearch}
                placeholder="Search bookmarked organisations"
                sort={orgSort}
                sorts={ORG_SORTS}
                onSort={setOrgSort}
                title="Sort organisations"
              />
            </View>
          }
          ListFooterComponent={
            <ListStatus
              loading={orgs.loading}
              error={orgs.error}
              empty={orgItems.length === 0}
              emptyText={
                orgQuery
                  ? 'No organisations match your search.'
                  : 'No bookmarked organisations.'
              }
            />
          }
          initialNumToRender={FIRST_ROWS}
          windowSize={7}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={contentStyle}
        />
      </KeepAlivePane>
      <KeepAlivePane active={view === 'tenders'} style={styles.fill}>
        <FlatList
          data={list.items}
          keyExtractor={item => item.id}
          renderItem={renderTender}
          ListHeaderComponent={
            <View style={styles.searchRow}>
              <SearchSort
                value={tenderSearch}
                onChange={setTenderSearch}
                placeholder="Search bookmarked tenders"
                sort={tenderSort}
                sorts={TENDER_SORTS}
                onSort={setTenderSort}
                title="Sort tenders"
              />
            </View>
          }
          ListFooterComponent={
            <ListStatus
              loading={list.loading}
              error={list.error}
              empty={list.items.length === 0}
              emptyText={
                tenderQuery
                  ? 'No tenders match your search.'
                  : 'No bookmarked tenders.'
              }
            />
          }
          initialNumToRender={FIRST_ROWS}
          windowSize={7}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={contentStyle}
        />
      </KeepAlivePane>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { paddingHorizontal: 18 },
  head: { marginTop: 4, marginBottom: 14, flexDirection: 'row' },
  title: {
    fontFamily: fonts.displaySemibold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.6,
  },
  sub: { fontFamily: fonts.medium, fontSize: 12.5, marginTop: 4 },
  seg: { marginTop: 14 },
  searchRow: { marginTop: 14, marginBottom: 12 },
});
