import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowRight, TriangleAlert } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import type { AttentionItem } from '../../lib/attention';
import { Card } from '../ui/Card';

type Props = {
  items: AttentionItem[];
  onOpen: (item: AttentionItem) => void;
};

/** Bookmarked tenders closing soon that still have no documents. */
export function NeedsAttentionCard({ items, onOpen }: Props) {
  const t = useTheme();
  if (items.length === 0) return null;
  // Solid: a barely darker inset row (page colour); Glass keeps the sunken tint.
  const rowBg = t.isGlass ? t.colors.surfaceSunk : t.colors.bg;
  const level = {
    crit: { bg: t.colors.critWash, fg: t.colors.crit, label: 'Critical' },
    soon: { bg: t.colors.warnWash, fg: t.colors.warn, label: 'Soon' },
  } as const;
  return (
    <Card
      elevation="md"
      radius="xl"
      padding={12}
      style={[styles.card, t.isGlass && styles.noTopEdge]}
    >
      <View style={styles.head}>
        <TriangleAlert size={17} color={t.colors.warn} />
        <Text style={[styles.title, { color: t.colors.ink }]}>
          Needs attention
        </Text>
      </View>
      {items.map(it => (
        <Pressable
          key={it.tender.id}
          accessibilityRole="button"
          accessibilityLabel={`Open ${it.tender.short}`}
          onPress={() => onOpen(it)}
          style={[styles.row, { backgroundColor: rowBg }]}
        >
          <View style={[styles.pill, { backgroundColor: level[it.level].bg }]}>
            <Text style={[styles.pillText, { color: level[it.level].fg }]}>
              {level[it.level].label}
            </Text>
          </View>
          <Text style={[styles.text, { color: t.colors.ink }]}>
            {it.tender.short} closes soon with no documents yet
          </Text>
          <ArrowRight size={16} color={t.colors.muted} />
        </Pressable>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 14 },
  // Glass: drop the bright top edge, which read as a blurred line over the calendar.
  noTopEdge: { borderTopColor: 'transparent' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  title: { fontFamily: fonts.bold, fontSize: 15 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginTop: 6,
  },
  pill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  pillText: { fontFamily: fonts.bold, fontSize: 12.5 },
  text: { flex: 1, fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19 },
});
