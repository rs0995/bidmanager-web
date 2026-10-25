import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { Building2, Globe } from 'lucide-react-native';
import { OrganizationCard } from '../../components/tender/OrganizationCard';
import { TenderCard } from '../../components/tender/TenderCard';
import {
  EmptyState,
  Screen,
  ScreenHeader,
  SearchField,
  SegmentedControl,
  useToast,
} from '../../components/ui';
import { useBookmarks } from '../../fixtures/bookmarks';
import { tenders } from '../../fixtures/tenders';
import { groupByOrg } from '../../lib/tenderFilters';
import { useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

type BookmarkView = 'orgs' | 'tenders';

/** Everything the user has bookmarked, across portals: organisations and tenders. */
export function BookmarksScreen() {
  const t = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { params } =
    useRoute<
      NativeStackScreenProps<RootStackParamList, 'Bookmarks'>['route']
    >();
  const toast = useToast();
  const { isBookmarked, toggle, isOrgBookmarked, toggleOrg } = useBookmarks();
  const [view, setView] = useState<BookmarkView>(params?.view ?? 'orgs');
  const [search, setSearch] = useState('');

  const changeView = (v: BookmarkView) => {
    setView(v);
    setSearch('');
  };

  const needle = search.trim().toLowerCase();
  const tenderRows = useMemo(
    () =>
      tenders.filter(
        x =>
          isBookmarked(x.id) &&
          (!needle ||
            `${x.title} ${x.org} ${x.id}`.toLowerCase().includes(needle)),
      ),
    [isBookmarked, needle],
  );
  const orgRows = useMemo(
    () =>
      groupByOrg(tenders, null, search, {
        bookmarkedOnly: true,
        isOrgBookmarked,
      }),
    [search, isOrgBookmarked],
  );

  const searching = needle.length > 0;
  const header = (
    <View>
      <ScreenHeader
        title="Bookmarks"
        subtitle={
          view === 'orgs'
            ? `${orgRows.length} organisations`
            : `${tenderRows.length} tenders`
        }
        onBack={() => navigation.goBack()}
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
      <View style={styles.search}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={
            view === 'orgs'
              ? 'Search bookmarked organisations'
              : 'Search bookmarked tenders'
          }
        />
      </View>
    </View>
  );

  const empty = (
    <EmptyState
      icon={
        view === 'orgs' ? (
          <Building2 size={24} color={t.colors.accentInk} />
        ) : (
          <Globe size={24} color={t.colors.accentInk} />
        )
      }
      title={
        searching
          ? view === 'orgs'
            ? 'No organisations match your search'
            : 'No tenders match your search'
          : view === 'orgs'
          ? 'No bookmarked organisations'
          : 'No bookmarked tenders'
      }
      description={
        searching
          ? 'Try a different search.'
          : view === 'orgs'
          ? 'Bookmark an organisation to see it here.'
          : 'Bookmark a tender to see it here.'
      }
    />
  );

  return (
    <Screen scroll={false} flush>
      {view === 'orgs' ? (
        <FlatList
          key="orgs"
          data={orgRows}
          keyExtractor={g => g.name}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <OrganizationCard
              group={item}
              bookmarked={isOrgBookmarked(item.name)}
              onPress={() =>
                navigation.navigate('OrgTenders', { name: item.name })
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
      ) : (
        <FlatList
          key="tenders"
          data={tenderRows}
          keyExtractor={x => x.id}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          contentContainerStyle={styles.content}
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
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingBottom: 40 },
  seg: { marginTop: 4 },
  search: { flexDirection: 'row', marginTop: 14, marginBottom: 12 },
});
