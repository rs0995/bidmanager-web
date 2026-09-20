import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Star } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import type { Tender } from '../../fixtures/tenders';
import { Card } from '../ui/Card';
import { StatusChip } from '../ui/Chip';

type Props = {
  tender: Tender;
  bookmarked: boolean;
  onPress: () => void;
  onToggleBookmark: () => void;
};

export function TenderCard({
  tender,
  bookmarked,
  onPress,
  onToggleBookmark,
}: Props) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.press}
    >
      <Card padding={14} elevation="sm">
        <View style={styles.top}>
          <Text
            numberOfLines={1}
            style={[styles.id, { color: t.colors.accentInk }]}
          >
            {tender.id}
          </Text>
          <View style={styles.right}>
            <StatusChip tone={tender.state} label={tender.closeIn} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                bookmarked ? 'Remove bookmark' : 'Bookmark tender'
              }
              hitSlop={10}
              onPress={onToggleBookmark}
            >
              <Star
                size={18}
                color={t.colors.accent}
                fill={bookmarked ? t.colors.accent : 'transparent'}
              />
            </Pressable>
          </View>
        </View>
        <Text style={[styles.title, { color: t.colors.ink }]}>
          {tender.title}
        </Text>
        <View style={styles.meta}>
          <Text style={[styles.metaText, { color: t.colors.muted }]}>
            {tender.portal}
          </Text>
          <Text
            style={[styles.metaText, styles.value, { color: t.colors.inkSoft }]}
          >
            {tender.value}
          </Text>
          <Text style={[styles.metaText, { color: t.colors.muted }]}>
            {tender.location}
          </Text>
        </View>
        <Text
          numberOfLines={1}
          style={[styles.metaText, { color: t.colors.muted }]}
        >
          {tender.org}
        </Text>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  press: { marginBottom: 10 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  id: { flex: 1, fontFamily: fonts.monoMedium, fontSize: 11 },
  title: {
    fontFamily: fonts.semibold,
    fontSize: 13.5,
    lineHeight: 19,
    marginTop: 8,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 14,
    marginTop: 8,
    marginBottom: 4,
  },
  metaText: { fontFamily: fonts.regular, fontSize: 11.5 },
  value: { fontFamily: fonts.bold },
});
