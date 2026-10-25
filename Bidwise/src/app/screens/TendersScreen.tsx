import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type {
  CompositeNavigationProp,
  RouteProp,
} from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ArrowDownUp,
  Bookmark,
  SlidersHorizontal,
  Star,
} from 'lucide-react-native';
import {
  PageTitle,
  Screen,
  SearchField,
  Segmented,
  SquareToggle,
  useSurface,
  useTabBarClearance,
} from '../../components/ui';
import { TenderFilterSheet } from '../../components/tender/TenderFilterSheet';
import { showActionSheet } from '../../platform/actionSheet';
import {
  NO_SHEET_FILTERS,
  sheetFilterCount,
  type SheetFilters,
} from '../../lib/tenderFilters';
import { OrgRow } from '../../components/tender/OrgRow';
import { TenderRow } from '../../components/tender/TenderRow';
import { KeepAlivePane } from '../../components/ui/motion';
import { useBookmarks } from '../../fixtures/bookmarks';
import type { Tender } from '../../fixtures/tenders';
import {
  PortalPicker,
  usePortalScope,
} from '../../components/tender/PortalPicker';
import { useTenderSource, type OrgItem } from '../../data/tenderSource';
import {
  ListStatus,
  LoadMore,
  useDebounced,
} from '../../components/feedback/ListStatus';
import { fonts, useTheme } from '../../theme';
import { useAccess } from '../../lib/account';
import type { RootStackParamList, TabParamList } from '../navigation/types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Tenders'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type View_ = 'orgs' | 'tenders';

const SORT_LABEL = { closing: 'Closing soonest', value: 'Highest value' };

/** Rows a list draws up front; the rest are drawn as you scroll. */
const FIRST_ROWS = 12;

// Rows only re-render when their own data or bookmark state changes.
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
  onOpen: (name: string) => void;
}) {
  return (
    <OrgRow
      org={org}
      bookmarked={bookmarked}
      onToggleBookmark={() => onToggle(org.name)}
      onOpen={() => onOpen(org.name)}
    />
  );
});

/** Keeps a callback's identity stable while always calling its latest version. */
function useStable<A extends unknown[]>(fn: (...args: A) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

export function TendersScreen() {
  const t = useTheme();
  const surface = useSurface();
  const clearance = useTabBarClearance();
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<TabParamList, 'Tenders'>>();
  const preset = (route.params ?? {}) as NonNullable<TabParamList['Tenders']>;

  const { isBookmarked, toggle, isOrgBookmarked, toggleOrg } = useBookmarks();
  // Bookmarks off for this member: no bookmarked-only square, and never filtered by it.
  const canBookmark = useAccess().bookmarks;

  const [view, setView] = useState<View_>('orgs');
  const [search, setSearch] = useState('');
  const [savedOnly, setSavedOnly] = useState(false);
  const [filters, setFilters] = useState<SheetFilters>(NO_SHEET_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sort, setSort] = useState<'closing' | 'value'>('closing');
  const filterCount = sheetFilterCount(filters);
  const toolInk = filterCount ? t.colors.accentInk : t.colors.inkSoft;

  // Dashboard tiles open the tab with a preset (view and bookmarked).
  useEffect(() => {
    if (!route.params) return;
    if (preset.view) setView(preset.view);
    if (preset.bookmarked !== undefined) setSavedOnly(preset.bookmarked);
    if (preset.closing !== undefined) {
      const closingSoon = preset.closing;
      setFilters(f => ({ ...f, closingSoon }));
    }
  }, [route.params, preset.view, preset.bookmarked, preset.closing]);

  const source = useTenderSource();
  const portals = source.usePortals();
  // One portal at a time (as BM Pro), so lists stay small and fast.
  const { portal, setPortal, ready } = usePortalScope(portals);
  const query = useDebounced(search, 300);
  const list = source.useTenderList({
    portal,
    org: null,
    search: query,
    savedOnly: savedOnly && canBookmark,
    closingSoon: false,
    filters,
    sort,
    paused: !ready,
  });
  const orgs = source.useOrgList({
    portal,
    search: query,
    bookmarkedOnly: savedOnly && canBookmark,
    isOrgBookmarked,
    paused: !ready,
  });

  const onToggleTender = useStable((id: string) => toggle(id));
  const onOpenTender = useStable((id: string) =>
    navigation.navigate('TenderDetail', { id }),
  );
  const onToggleOrg = useStable((name: string) => toggleOrg(name));
  // As BM Pro: an organisation opens its own page of tenders.
  const onOpenOrg = useStable((name: string) =>
    navigation.navigate('OrgTenders', {
      org: name,
      portal: portal ?? undefined,
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

  // Controls above both lists; they scroll away with the list, as before.
  const controls = (
    <>
      <PageTitle>Tenders</PageTitle>

      {/* Portal first, as BM Pro: it scopes both sub tabs. */}
      <PortalPicker portals={portals} value={portal} onChange={setPortal} />

      <Segmented
        style={styles.seg}
        value={view}
        onChange={setView}
        options={[
          { value: 'orgs', label: 'Organisations' },
          { value: 'tenders', label: 'Tenders' },
        ]}
      />

      <SearchField
        value={search}
        onChangeText={setSearch}
        placeholder="Search tenders or organisations"
        leading={
          canBookmark ? (
            <SquareToggle
              label={
                view === 'orgs'
                  ? 'Bookmarked organisations only'
                  : 'Bookmarked tenders only'
              }
              active={savedOnly}
              onPress={() => setSavedOnly(v => !v)}
              icon={
                // Same icons as the rows: a bookmark for organisations, a star for tenders.
                view === 'orgs' ? (
                  <Bookmark
                    size={17}
                    color={savedOnly ? t.colors.accent : t.colors.muted}
                    fill={savedOnly ? t.colors.accent : 'transparent'}
                  />
                ) : (
                  <Star
                    size={17}
                    color={savedOnly ? t.colors.accent : t.colors.muted}
                    fill={savedOnly ? t.colors.accent : 'none'}
                  />
                )
              }
            />
          ) : undefined
        }
      />
    </>
  );

  const tenderHeader = (
    <>
      {view === 'tenders' ? controls : null}
      <View style={styles.countRow}>
        <Text style={[styles.count, { color: t.colors.muted }]}>
          {list.total} {list.total === 1 ? 'tender' : 'tenders'}
        </Text>
        <View style={styles.tools}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Sort: ${SORT_LABEL[sort]}`}
            onPress={() =>
              showActionSheet('Sort tenders', [
                {
                  label: SORT_LABEL.closing,
                  onPress: () => setSort('closing'),
                },
                {
                  label: SORT_LABEL.value,
                  onPress: () => setSort('value'),
                },
              ])
            }
            style={[styles.tool, surface]}
            hitSlop={6}
          >
            <ArrowDownUp size={13} color={t.colors.inkSoft} />
            <Text style={[styles.toolText, { color: t.colors.inkSoft }]}>
              {SORT_LABEL[sort]}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              filterCount ? `Filters, ${filterCount} on` : 'Filters'
            }
            onPress={() => setFilterOpen(true)}
            style={[
              styles.tool,
              surface,
              filterCount > 0 && {
                backgroundColor: t.colors.accentWash,
                borderColor: t.colors.accent,
              },
            ]}
            hitSlop={6}
          >
            <SlidersHorizontal size={13} color={toolInk} />
            <Text style={[styles.toolText, { color: toolInk }]}>
              {filterCount ? `Filter · ${filterCount}` : 'Filter'}
            </Text>
          </Pressable>
        </View>
      </View>
    </>
  );

  const orgHeader = (
    <>
      {view === 'orgs' ? controls : null}
      <View style={styles.countRow}>
        <Text style={[styles.count, { color: t.colors.muted }]}>
          {orgs.items.length}{' '}
          {orgs.items.length === 1 ? 'organisation' : 'organisations'}
        </Text>
        <Text style={[styles.count, { color: t.colors.inkSoft }]}>
          {portal ?? ''}
        </Text>
      </View>
    </>
  );

  const contentStyle = { paddingHorizontal: 18, paddingBottom: clearance };

  return (
    <Screen tabBar scroll={false} flush>
      {/* Both lists stay mounted (each keeps its scroll position); switching only
          shows the other one. Each draws just the rows on screen. */}
      <KeepAlivePane active={view === 'tenders'} style={styles.fill}>
        <FlatList
          data={list.items}
          keyExtractor={item => item.id}
          renderItem={renderTender}
          ListHeaderComponent={tenderHeader}
          ListFooterComponent={
            <>
              {list.hasMore ? <LoadMore onPress={list.loadMore} /> : null}
              <ListStatus
                loading={list.loading}
                error={list.error}
                empty={list.items.length === 0}
                emptyText="No tenders match these filters."
              />
            </>
          }
          onEndReached={list.hasMore ? list.loadMore : undefined}
          onEndReachedThreshold={0.5}
          initialNumToRender={FIRST_ROWS}
          windowSize={7}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={contentStyle}
        />
      </KeepAlivePane>
      <KeepAlivePane active={view === 'orgs'} style={styles.fill}>
        <FlatList
          data={orgs.items}
          keyExtractor={item => item.name}
          renderItem={renderOrg}
          ListHeaderComponent={orgHeader}
          ListFooterComponent={
            <ListStatus
              loading={orgs.loading}
              error={orgs.error}
              empty={orgs.items.length === 0}
              emptyText="No organisations match these filters."
            />
          }
          initialNumToRender={FIRST_ROWS}
          windowSize={7}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={contentStyle}
        />
      </KeepAlivePane>

      <TenderFilterSheet
        visible={filterOpen}
        value={filters}
        onApply={setFilters}
        onClose={() => setFilterOpen(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  seg: { marginBottom: 12 },
  countRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 12,
  },
  count: { fontFamily: fonts.medium, fontSize: 12 },
  tools: { flexDirection: 'row', gap: 8 },
  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  toolText: { fontFamily: fonts.semibold, fontSize: 12 },
});
