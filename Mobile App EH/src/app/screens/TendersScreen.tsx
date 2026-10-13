import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SearchX } from 'lucide-react-native';
import { BookmarkFilterButton } from '../../components/tender/BookmarkFilterButton';
import { FilterBar } from '../../components/tender/FilterBar';
import { OrganizationCard } from '../../components/tender/OrganizationCard';
import { PortalSelect } from '../../components/tender/PortalSelect';
import { TenderCard } from '../../components/tender/TenderCard';
import {
  EmptyState,
  Screen,
  ScreenHeader,
  SearchField,
  SegmentedControl,
  useTabBarClearance,
  useToast,
} from '../../components/ui';
import { useBookmarks } from '../../fixtures/bookmarks';
import { PORTALS, Portal, tenders } from '../../fixtures/tenders';
import {
  applyTenderQuery,
  BaseFilter,
  CustomFilterKey,
  filterMenuGroups,
  groupByOrg,
} from '../../lib/tenderFilters';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList, TabParamList } from '../navigation/types';

type SubTab = 'tenders' | 'orgs';

export function TendersScreen() {
  const t = useTheme();
  const clearance = useTabBarClearance();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const toast = useToast();
  const { isBookmarked, toggle, isOrgBookmarked, toggleOrg } = useBookmarks();

  const [portal, setPortal] = useState<Portal>(PORTALS[0]);
  const [view, setView] = useState<SubTab>('tenders');
  const [search, setSearch] = useState('');
  const [base, setBase] = useState<BaseFilter>('all');
  const [custom, setCustom] = useState<CustomFilterKey[]>([]);
  const [starOnly, setStarOnly] = useState(false);
  const [ribbonOnly, setRibbonOnly] = useState(false);

  // Presets from the Dashboard tiles ("20 Tenders" bookmarked, "3 Orgs" bookmarked, ...).
  const route = useRoute<RouteProp<TabParamList, 'Tenders'>>();
  const tabNav =
    useNavigation<BottomTabNavigationProp<TabParamList, 'Tenders'>>();
  useEffect(() => {
    const preset = route.params;
    // Cleared presets (both undefined) must not re-run this, or setParams loops forever.
    if (
      !preset ||
      (preset.view === undefined && preset.bookmarked === undefined)
    )
      return;
    const nextView = preset.view ?? 'tenders';
    setView(nextView);
    setSearch('');
    if (preset.bookmarked !== undefined) {
      if (nextView === 'orgs') setRibbonOnly(preset.bookmarked);
      else setStarOnly(preset.bookmarked);
    }
    tabNav.setParams({ view: undefined, bookmarked: undefined });
  }, [route.params, tabNav]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        PORTALS.map(p => [p, tenders.filter(x => x.portal === p).length]),
      ),
    [],
  );
  const scoped = useMemo(
    () => tenders.filter(x => x.portal === portal),
    [portal],
  );
  const rows = useMemo(
    () =>
      applyTenderQuery(tenders, {
        portal,
        search,
        base,
        custom,
        bookmarkedOnly: starOnly,
        isBookmarked,
      }),
    [portal, search, base, custom, starOnly, isBookmarked],
  );
  const groups = useMemo(
    () =>
      groupByOrg(tenders, portal, search, {
        bookmarkedOnly: ribbonOnly,
        isOrgBookmarked,
      }),
    [portal, search, ribbonOnly, isOrgBookmarked],
  );
  const menuGroups = useMemo(
    () => filterMenuGroups(scoped, custom),
    [scoped, custom],
  );

  const changePortal = (p: Portal) => {
    setPortal(p);
    setCustom([]);
  };

  const changeView = (v: SubTab) => {
    setView(v);
    setSearch('');
  };

  const subtitle =
    view === 'tenders'
      ? `${rows.length} tenders · ${portal}${
          custom.length ? ` · ${custom.length} custom` : ''
        }`
      : `${groups.length} organisations · ${portal}`;

  const header = (
    <View style={styles.header}>
      <ScreenHeader title="Tenders" subtitle={subtitle} />
      <Text style={[styles.label, { color: t.colors.muted }]}>PORTAL</Text>
      <PortalSelect
        options={PORTALS}
        value={portal}
        counts={counts}
        onChange={p => changePortal(p as Portal)}
      />
      <View style={styles.seg}>
        <SegmentedControl
          options={[
            { key: 'orgs', label: 'Organisations' },
            { key: 'tenders', label: 'Tenders' },
          ]}
          value={view}
          onChange={changeView}
        />
      </View>
      <View style={styles.searchRow}>
        {view === 'tenders' ? (
          <BookmarkFilterButton
            kind="star"
            active={starOnly}
            onPress={() => setStarOnly(v => !v)}
          />
        ) : (
          <BookmarkFilterButton
            kind="ribbon"
            active={ribbonOnly}
            onPress={() => setRibbonOnly(v => !v)}
          />
        )}
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={
            view === 'orgs'
              ? 'Search organisations'
              : 'Search title, org, tender ID'
          }
        />
      </View>
      {view === 'tenders' ? (
        <View style={styles.filters}>
          <FilterBar
            base={base}
            onBase={setBase}
            custom={custom}
            onAddCustom={k => setCustom(c => [...c, k])}
            onRemoveCustom={k => setCustom(c => c.filter(x => x !== k))}
            menuGroups={menuGroups}
          />
        </View>
      ) : null}
    </View>
  );

  const onlyBookmarks = view === 'tenders' ? starOnly : ribbonOnly;
  const empty = (
    <EmptyState
      icon={<SearchX size={24} color={t.colors.accentInk} />}
      title={
        onlyBookmarks
          ? view === 'orgs'
            ? 'No bookmarked organisations'
            : 'No bookmarked tenders'
          : view === 'orgs'
          ? 'No organisations found'
          : 'No tenders match'
      }
      description={
        onlyBookmarks
          ? 'Bookmark items to see them here, or turn the bookmark filter off.'
          : 'Try a different portal, search, or filter.'
      }
    />
  );

  return (
    <Screen scroll={false} flush>
      {view === 'tenders' ? (
        <FlatList
          key="tenders"
          data={rows}
          keyExtractor={x => x.id}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TenderCard
              tender={item}
              bookmarked={isBookmarked(item.id)}
              onPress={() =>
                navigation.navigate('TenderDetail', { id: item.id })
              }
              onToggleBookmark={() =>
                toast.show(toggle(item.id) ? 'Bookmarked' : 'Bookmark removed')
              }
            />
          )}
        />
      ) : (
        <FlatList
          key="orgs"
          data={groups}
          keyExtractor={g => g.name}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <OrganizationCard
              group={item}
              bookmarked={isOrgBookmarked(item.name)}
              onPress={() =>
                navigation.navigate('OrgTenders', { name: item.name, portal })
              }
              onToggleBookmark={() =>
                toast.show(
                  toggleOrg(item.name)
                    ? 'Organisation bookmarked'
                    : 'Bookmark removed',
                )
              }
            />
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18 },
  header: { paddingBottom: 6 },
  label: {
    fontFamily: fonts.bold,
    fontSize: 10.5,
    letterSpacing: 0.8,
    marginBottom: 8,
    marginLeft: 2,
  },
  seg: { marginTop: 18 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    marginBottom: 6,
  },
  filters: { marginTop: 12, marginBottom: 10 },
});
