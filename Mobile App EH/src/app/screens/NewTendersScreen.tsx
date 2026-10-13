import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { ChevronRight, Inbox } from 'lucide-react-native';
import { TenderCard } from '../../components/tender/TenderCard';
import {
  EmptyState,
  Screen,
  ScreenHeader,
  useToast,
} from '../../components/ui';
import { useAlerts } from '../../fixtures/alerts';
import { useBookmarks } from '../../fixtures/bookmarks';
import { tenders } from '../../fixtures/tenders';
import { publishedKey } from '../../lib/dates';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

/** The tenders a "new tenders" alert reported, newest published first. */
export function NewTendersScreen() {
  const t = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { params } =
    useRoute<
      NativeStackScreenProps<RootStackParamList, 'NewTenders'>['route']
    >();
  const toast = useToast();
  const { alerts } = useAlerts();
  const { isBookmarked, toggle } = useBookmarks();

  const alert = alerts.find(a => a.id === params.alertId);
  const orgName = alert?.orgName ?? '';
  const rows = useMemo(() => {
    const ids = alert?.newTenderIds ?? [];
    return tenders
      .filter(x => ids.includes(x.id))
      .sort((a, b) => publishedKey(b.published) - publishedKey(a.published));
  }, [alert]);

  if (rows.length === 0) {
    return (
      <Screen>
        <ScreenHeader title="New tenders" onBack={() => navigation.goBack()} />
        <EmptyState
          icon={<Inbox size={24} color={t.colors.accentInk} />}
          title="Nothing to show"
          description="This alert no longer has any new tenders attached."
        />
      </Screen>
    );
  }

  const viewAll = orgName ? (
    <Pressable
      accessibilityRole="button"
      onPress={() => navigation.navigate('OrgTenders', { name: orgName })}
      style={styles.viewAll}
    >
      <Text style={[styles.viewAllText, { color: t.colors.accentInk }]}>
        View all tenders from {orgName}
      </Text>
      <ChevronRight size={16} color={t.colors.accentInk} />
    </Pressable>
  ) : null;

  return (
    <Screen scroll={false} flush>
      <FlatList
        data={rows}
        keyExtractor={x => x.id}
        ListHeaderComponent={
          <ScreenHeader
            title={orgName || 'New tenders'}
            titleLines={2}
            subtitle={`${rows.length} new tender${
              rows.length === 1 ? '' : 's'
            }, newest first`}
            onBack={() => navigation.goBack()}
          />
        }
        ListFooterComponent={viewAll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <TenderCard
            tender={item}
            bookmarked={isBookmarked(item.id)}
            onPress={() => navigation.navigate('TenderDetail', { id: item.id })}
            onToggleBookmark={() =>
              toast.show(toggle(item.id) ? 'Bookmarked' : 'Bookmark removed')
            }
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingBottom: 40 },
  viewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 14,
  },
  viewAllText: { fontFamily: fonts.bold, fontSize: 13.5 },
});
