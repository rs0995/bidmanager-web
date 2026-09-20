import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bookmark, ChevronRight } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import type { OrgGroup } from '../../lib/tenderFilters';
import { Card } from '../ui/Card';

type Props = {
  group: OrgGroup;
  bookmarked: boolean;
  onPress: () => void;
  onToggleBookmark: () => void;
};

export function OrganizationCard({
  group,
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
        <View style={styles.row}>
          <View style={styles.text}>
            <Text style={[styles.name, { color: t.colors.ink }]}>
              {group.name}
            </Text>
            <View style={styles.meta}>
              <Text style={[styles.metaText, { color: t.colors.muted }]}>
                {group.portals.join(' · ')}
              </Text>
              {group.closingSoon > 0 ? (
                <Text style={[styles.metaText, { color: t.colors.warn }]}>
                  {group.closingSoon} closing soon
                </Text>
              ) : null}
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              bookmarked
                ? 'Remove organisation bookmark'
                : 'Bookmark organisation'
            }
            hitSlop={10}
            onPress={onToggleBookmark}
          >
            <Bookmark
              size={19}
              color={t.colors.accent}
              fill={bookmarked ? t.colors.accent : 'transparent'}
            />
          </Pressable>
          <Text style={[styles.count, { color: t.colors.ink }]}>
            {group.tenders.length}
          </Text>
          <ChevronRight size={16} color={t.colors.muted} />
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  press: { marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { flex: 1 },
  name: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, marginTop: 4 },
  metaText: { fontFamily: fonts.regular, fontSize: 11 },
  count: { fontFamily: fonts.monoSemibold, fontSize: 14 },
});
