import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { ExternalLink, FolderPlus, Star } from 'lucide-react-native';
import { DocumentRow } from '../../components/tender/DocumentRow';
import { FieldGrid } from '../../components/tender/FieldGrid';
import {
  Button,
  EmptyState,
  Screen,
  ScreenHeader,
  StatusChip,
  useToast,
} from '../../components/ui';
import { useBookmarks } from '../../fixtures/bookmarks';
import { getTender } from '../../fixtures/tenders';
import { fonts, useTheme } from '../../theme';
import type { RootStackParamList } from '../navigation/types';

export function TenderDetailScreen() {
  const t = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { params } =
    useRoute<
      NativeStackScreenProps<RootStackParamList, 'TenderDetail'>['route']
    >();
  const toast = useToast();
  const { isBookmarked, toggle } = useBookmarks();
  const tender = getTender(params.id);

  if (!tender) {
    return (
      <Screen>
        <ScreenHeader title="Tender" onBack={() => navigation.goBack()} />
        <EmptyState
          title="Tender not found"
          description="It may have been removed."
        />
      </Screen>
    );
  }

  const bookmarked = isBookmarked(tender.id);

  return (
    <Screen>
      <ScreenHeader title="Tender" onBack={() => navigation.goBack()} />

      <Text style={[styles.id, { color: t.colors.accentInk }]}>
        {tender.id}
      </Text>
      <Text style={[styles.title, { color: t.colors.ink }]}>
        {tender.title}
      </Text>
      <View style={styles.chips}>
        <StatusChip tone={tender.state} label={`Closes ${tender.closeIn}`} />
        <StatusChip tone="plain" label={tender.portal} />
      </View>

      <FieldGrid
        items={[
          { label: 'Tender value', value: tender.value },
          { label: 'EMD', value: tender.emd },
          { label: 'Category', value: tender.category },
          { label: 'Location', value: tender.location },
          { label: 'Published', value: tender.published },
          { label: 'Pre-bid meeting', value: tender.prebid },
          { label: 'Closing', value: tender.closing, full: true },
          { label: 'Organisation chain', value: tender.org, full: true },
        ]}
      />

      <View style={styles.actions}>
        <Button
          block
          variant={bookmarked ? 'secondary' : 'primary'}
          label={bookmarked ? 'Bookmarked' : 'Bookmark'}
          icon={
            <Star
              size={16}
              color={bookmarked ? t.colors.accent : t.colors.onAccent}
              fill={bookmarked ? t.colors.accent : 'transparent'}
            />
          }
          onPress={() =>
            toast.show(toggle(tender.id) ? 'Bookmarked' : 'Bookmark removed')
          }
        />
        <View style={styles.pair}>
          <View style={styles.half}>
            <Button
              block
              variant="secondary"
              label="Add to Projects"
              icon={<FolderPlus size={16} color={t.colors.ink} />}
              onPress={() => toast.show('Project created')}
            />
          </View>
          <View style={styles.half}>
            <Button
              block
              variant="secondary"
              label="Open on portal"
              icon={<ExternalLink size={16} color={t.colors.ink} />}
              onPress={() => toast.show('Opening the tender notice…')}
            />
          </View>
        </View>
      </View>

      <Text style={[styles.section, { color: t.colors.muted }]}>
        PUBLISHED DOCUMENTS
      </Text>
      {tender.docs.map(d => (
        <DocumentRow
          key={d.name}
          doc={d}
          onRequest={() =>
            toast.show('Requested — it will arrive with the next update')
          }
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  id: { fontFamily: fonts.monoMedium, fontSize: 11.5 },
  title: {
    fontFamily: fonts.extrabold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.2,
    marginTop: 6,
  },
  chips: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 16 },
  actions: { gap: 10, marginTop: 16 },
  pair: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  section: {
    fontFamily: fonts.bold,
    fontSize: 10.5,
    letterSpacing: 0.9,
    marginTop: 24,
    marginBottom: 10,
    marginLeft: 2,
  },
});
