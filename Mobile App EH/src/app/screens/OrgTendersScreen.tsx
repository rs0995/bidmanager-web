import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { TenderCard } from '../../components/tender/TenderCard';
import {
  Screen,
  ScreenHeader,
  StatusChip,
  useToast,
} from '../../components/ui';
import { useBookmarks } from '../../fixtures/bookmarks';
import { tenders } from '../../fixtures/tenders';
import type { RootStackParamList } from '../navigation/types';

export function OrgTendersScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { params } =
    useRoute<
      NativeStackScreenProps<RootStackParamList, 'OrgTenders'>['route']
    >();
  const toast = useToast();
  const { isBookmarked, toggle } = useBookmarks();
  const rows = tenders.filter(
    x =>
      x.org === params.name && (!params.portal || x.portal === params.portal),
  );

  const header = (
    <View>
      <ScreenHeader
        title={params.name}
        titleLines={2}
        subtitle="Organisation"
        onBack={() => navigation.goBack()}
      />
      <View style={styles.chips}>
        <StatusChip tone="plain" label={`${rows.length} tenders`} />
        {params.portal ? (
          <StatusChip tone="plain" label={params.portal} />
        ) : null}
      </View>
    </View>
  );

  return (
    <Screen scroll={false} flush>
      <FlatList
        data={rows}
        keyExtractor={x => x.id}
        ListHeaderComponent={header}
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
  chips: { flexDirection: 'row', gap: 8, marginTop: -8, marginBottom: 16 },
});
