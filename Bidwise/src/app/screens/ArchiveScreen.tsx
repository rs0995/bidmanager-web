import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronLeft, Star } from 'lucide-react-native';
import {
  IconButton,
  PageTitle,
  Screen,
  SearchField,
  Segmented,
  useSurface,
} from '../../components/ui';
import { OrgRow } from '../../components/tender/OrgRow';
import { TenderRow } from '../../components/tender/TenderRow';
import { useBookmarks } from '../../fixtures/bookmarks';
import type { Tender } from '../../fixtures/tenders';
import { useTenderSource } from '../../data/tenderSource';
import {
  PortalPicker,
  usePortalScope,
} from '../../components/tender/PortalPicker';
import {
  ListStatus,
  LoadMore,
  useDebounced,
} from '../../components/feedback/ListStatus';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** "Closed 19 Aug" (sample data) or "Closed 08 Sep 2026" from the closing date. */
export function closedLabel(x: Tender): string {
  const sample = (x as Tender & { closedOn?: string }).closedOn;
  if (sample) return sample;
  const day = x.closing.split(',')[0];
  return day && day !== '—' ? `Closed ${day}` : 'Closed';
}

/**
 * Closed tenders (the server's archived flag, set by its nightly sweep once a tender is
 * well past closing). Mirrors the Tenders tab: Organisations / Tenders, search, and a
 * bookmarked-only star. Most recently closed first.
 */
export function ArchiveScreen() {
  const t = useTheme();
  const surface = useSurface();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { isBookmarked, toggle, isOrgBookmarked, toggleOrg } = useBookmarks();
  const [view, setView] = useState<'orgs' | 'tenders'>('tenders');
  const [search, setSearch] = useState('');
  const [savedOnly, setSavedOnly] = useState(false);

  const source = useTenderSource();
  const portals = source.usePortals();
  const { portal, setPortal, ready } = usePortalScope(portals);
  const query = useDebounced(search, 300);
  const list = source.useTenderList({
    portal,
    paused: !ready,
    org: null,
    search: query,
    savedOnly,
    closingSoon: false,
    sort: 'closing',
    archived: true,
  });
  const orgs = source.useOrgList({
    portal,
    paused: !ready,
    search: query,
    bookmarkedOnly: savedOnly,
    isOrgBookmarked,
    archived: true,
  });

  const header = (
    <>
      <View style={styles.head}>
        <IconButton label="Back" onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color={t.colors.ink} />
        </IconButton>
      </View>
      <PageTitle sub="Closed tenders and their documents.">Archive</PageTitle>

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

      <View style={styles.searchRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bookmarked only"
          accessibilityState={{ selected: savedOnly }}
          onPress={() => setSavedOnly(v => !v)}
          style={[
            styles.star,
            surface,
            savedOnly && {
              backgroundColor: t.colors.accentWash,
              borderColor: t.colors.edge,
            },
          ]}
        >
          <Star
            size={17}
            color={savedOnly ? t.colors.accent : t.colors.muted}
            fill={savedOnly ? t.colors.accent : 'transparent'}
          />
        </Pressable>
        <View style={styles.flex}>
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder="Search title, org, tender ID"
          />
        </View>
      </View>

      <Text style={[styles.count, { color: t.colors.muted }]}>
        {view === 'tenders'
          ? `${list.total} closed ${list.total === 1 ? 'tender' : 'tenders'}`
          : `${orgs.items.length} ${
              orgs.items.length === 1 ? 'organisation' : 'organisations'
            }`}
      </Text>
    </>
  );

  const contentStyle = {
    paddingHorizontal: 18,
    paddingBottom: Math.max(insets.bottom, 16) + 16,
  };

  // One list on screen, drawing only the rows in view (closed tenders run to thousands).
  return (
    <Screen scroll={false} flush>
      {view === 'tenders' ? (
        <FlatList
          key="tenders"
          data={list.items}
          keyExtractor={x => x.id}
          renderItem={({ item: x }) => (
            <TenderRow
              tender={x}
              badgeText={closedLabel(x)}
              saved={isBookmarked(x.id)}
              onToggleSave={() => toggle(x.id)}
              onOpen={() => navigation.navigate('TenderDetail', { id: x.id })}
            />
          )}
          ListHeaderComponent={header}
          ListFooterComponent={
            <>
              {list.hasMore ? <LoadMore onPress={list.loadMore} /> : null}
              <ListStatus
                loading={list.loading}
                error={list.error}
                empty={list.items.length === 0}
                emptyText="No closed tenders match."
              />
            </>
          }
          onEndReached={list.hasMore ? list.loadMore : undefined}
          onEndReachedThreshold={0.5}
          initialNumToRender={12}
          windowSize={7}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={contentStyle}
        />
      ) : (
        <FlatList
          key="orgs"
          data={orgs.items}
          keyExtractor={g => g.name}
          renderItem={({ item: g }) => (
            <OrgRow
              org={g}
              bookmarked={isOrgBookmarked(g.name)}
              onToggleBookmark={() => toggleOrg(g.name)}
              // As BM Pro: the organisation's own page, its closed tenders.
              onOpen={() =>
                navigation.navigate('OrgTenders', {
                  org: g.name,
                  portal: portal ?? undefined,
                  archived: true,
                })
              }
            />
          )}
          ListHeaderComponent={header}
          ListFooterComponent={
            <ListStatus
              loading={orgs.loading}
              error={orgs.error}
              empty={orgs.items.length === 0}
              emptyText="No organisations with closed tenders."
            />
          }
          initialNumToRender={12}
          windowSize={7}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={contentStyle}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { marginTop: 4, marginBottom: 14, flexDirection: 'row' },
  seg: { marginBottom: 12 },
  searchRow: { flexDirection: 'row', gap: 10 },
  star: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    fontFamily: fonts.medium,
    fontSize: 12,
    marginTop: 16,
    marginBottom: 12,
  },
  empty: {
    fontFamily: fonts.regular,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 30,
  },
});
