import React from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CalendarCheck } from 'lucide-react-native';
import { TenderCard } from '../../components/tender/TenderCard';
import {
  EmptyState,
  Screen,
  ScreenHeader,
  useToast,
} from '../../components/ui';
import { useBookmarks } from '../../fixtures/bookmarks';
import { tenders } from '../../fixtures/tenders';
import { closesWithinDays } from '../../lib/tenderFilters';
import { useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

/** Bookmarked tenders closing within 7 days. */
export function ClosingThisWeekScreen() {
  const t = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const toast = useToast();
  const { isBookmarked, toggle } = useBookmarks();
  const rows = tenders.filter(
    x => isBookmarked(x.id) && closesWithinDays(x, 7),
  );

  return (
    <Screen scroll={false} flush>
      <FlatList
        data={rows}
        keyExtractor={x => x.id}
        ListHeaderComponent={
          <ScreenHeader
            title="Closing this week"
            subtitle="Your bookmarked tenders closing within 7 days"
            onBack={() => navigation.goBack()}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon={<CalendarCheck size={24} color={t.colors.accentInk} />}
            title="Nothing closing this week"
            description="Bookmark tenders to see their deadlines here."
          />
        }
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
});
