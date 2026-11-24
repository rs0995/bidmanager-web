import React, { memo, useCallback, useRef } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDownUp, ChevronLeft } from 'lucide-react-native';
import { IconButton, Screen, SearchField, SquareToggle } from '../ui';
import { TenderRow } from './TenderRow';
import { ListStatus, LoadMore } from '../feedback/ListStatus';
import { useBookmarks } from '../../fixtures/bookmarks';
import type { Tender } from '../../fixtures/tenders';
import { showActionSheet } from '../../platform/actionSheet';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../../app/navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export type SortOption<K extends string> = { key: K; label: string };

type Props<K extends string> = {
  title: string;
  /** Under the title, e.g. "12 tenders". */
  sub: string;
  tenders: Tender[];
  loading: boolean;
  error?: string | null;
  emptyText: string;
  loadingText?: string;
  search: string;
  onSearch: (v: string) => void;
  sort: K;
  sorts: SortOption<K>[];
  onSort: (k: K) => void;
  /** Paged lists (an organisation's tenders). */
  hasMore?: boolean;
  onLoadMore?: () => void;
  /** Closed tenders show their closing date in the badge. */
  badgeText?: (t: Tender) => string | undefined;
  footer?: React.ReactNode;
  /**
   * The organisation page: back and `action` in a fixed row, then the title and `sub`
   * (no sort label) on a full-width band, fixed above the list.
   */
  titleBand?: boolean;
  action?: React.ReactNode;
  /** Shown in place of `emptyText` when the list is empty (e.g. "Request tenders"). */
  emptyContent?: React.ReactNode;
};

const Row = memo(function Row({
  tender,
  saved,
  onToggle,
  onOpen,
  badgeText,
}: {
  tender: Tender;
  saved: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  badgeText?: string;
}) {
  return (
    <TenderRow
      tender={tender}
      saved={saved}
      badgeText={badgeText}
      onToggleSave={() => onToggle(tender.id)}
      onOpen={() => onOpen(tender.id)}
    />
  );
});

/**
 * A pushed page of tenders, as BM Pro's organisation and new-tenders pages: back, title,
 * search with a sort button beside it, then the list (only the rows on screen are drawn).
 */
export function TenderListPage<K extends string>({
  title,
  sub,
  tenders,
  loading,
  error = null,
  emptyText,
  loadingText,
  search,
  onSearch,
  sort,
  sorts,
  onSort,
  hasMore,
  onLoadMore,
  badgeText,
  footer,
  titleBand,
  action,
  emptyContent,
}: Props<K>) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { isBookmarked, toggle } = useBookmarks();
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  const onToggle = useCallback((id: string) => toggleRef.current(id), []);
  const onOpen = useCallback(
    (id: string) => navigation.navigate('TenderDetail', { id }),
    [navigation],
  );
  const current = sorts.find(s => s.key === sort)?.label ?? '';

  const back = (
    <IconButton label="Back" onPress={() => navigation.goBack()}>
      <ChevronLeft size={22} color={t.colors.ink} />
    </IconButton>
  );
  const bar = titleBand ? (
    <>
      <View style={styles.bar}>
        {back}
        {action}
      </View>
      <View
        style={[
          styles.band,
          {
            backgroundColor: t.isGlass ? t.glass.fill : t.colors.surface,
            borderColor: t.isGlass ? t.glass.border : t.colors.hair,
          },
        ]}
      >
        <Text style={[styles.title, { color: t.colors.ink }]} numberOfLines={3}>
          {title}
        </Text>
        {sub ? (
          <Text style={[styles.bandSub, { color: t.colors.muted }]}>{sub}</Text>
        ) : null}
      </View>
    </>
  ) : null;

  const header = (
    <>
      {titleBand ? (
        <View style={styles.bandGap} />
      ) : (
        <>
          <View style={styles.head}>{back}</View>
          <Text
            style={[styles.title, { color: t.colors.ink }]}
            numberOfLines={3}
          >
            {title}
          </Text>
          <Text style={[styles.sub, { color: t.colors.muted }]}>
            {sub}
            {current ? ` · ${current}` : ''}
          </Text>
        </>
      )}
      <SearchField
        value={search}
        onChangeText={onSearch}
        placeholder="Search title or tender ID"
        trailing={
          <SquareToggle
            label={`Sort: ${current}`}
            active={false}
            onPress={() =>
              showActionSheet(
                'Sort tenders',
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
      <View style={styles.gap} />
    </>
  );

  return (
    <Screen scroll={false} flush>
      {bar}
      <FlatList
        data={tenders}
        keyExtractor={x => x.id}
        renderItem={({ item }) => (
          <Row
            tender={item}
            saved={isBookmarked(item.id)}
            onToggle={onToggle}
            onOpen={onOpen}
            badgeText={badgeText?.(item)}
          />
        )}
        ListHeaderComponent={header}
        ListFooterComponent={
          <>
            {hasMore && onLoadMore ? <LoadMore onPress={onLoadMore} /> : null}
            {emptyContent && !loading && !error && tenders.length === 0 ? (
              emptyContent
            ) : (
              <ListStatus
                loading={loading}
                error={error}
                empty={tenders.length === 0}
                emptyText={emptyText}
                loadingText={loadingText}
              />
            )}
            {footer}
          </>
        }
        onEndReached={hasMore ? onLoadMore : undefined}
        onEndReachedThreshold={0.5}
        initialNumToRender={12}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 18,
          paddingBottom: Math.max(insets.bottom, 16) + 16,
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { marginTop: 4, marginBottom: 14, flexDirection: 'row' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    marginTop: 4,
    marginBottom: 14,
  },
  band: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bandSub: { fontFamily: fonts.medium, fontSize: 12.5, marginTop: 4 },
  bandGap: { height: 14 },
  title: {
    fontFamily: fonts.displaySemibold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.6,
  },
  sub: {
    fontFamily: fonts.medium,
    fontSize: 12.5,
    marginTop: 4,
    marginBottom: 14,
  },
  gap: { height: 12 },
});
