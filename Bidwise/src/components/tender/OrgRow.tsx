import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bookmark, Building2 } from 'lucide-react-native';
import { Card } from '../ui/Card';
import type { OrgItem } from '../../data/tenderSource';
import { fonts, useTheme } from '../../theme';
import { useAccess } from '../../lib/account';

export function OrgRow({
  org,
  bookmarked,
  onOpen,
  onToggleBookmark,
}: {
  org: OrgItem;
  bookmarked: boolean;
  onOpen: () => void;
  onToggleBookmark: () => void;
}) {
  const t = useTheme();
  const canBookmark = useAccess().bookmarks;
  const n = org.count;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${org.name}, ${n} tenders`}
      onPress={onOpen}
    >
      <Card padding={14} radius="lg" elevation="sm" style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.icon, { backgroundColor: t.colors.accentWash }]}>
            <Building2 size={18} color={t.colors.accent} />
          </View>
          <View style={styles.text}>
            <Text
              numberOfLines={1}
              style={[styles.name, { color: t.colors.ink }]}
            >
              {org.name}
            </Text>
            <Text style={[styles.meta, { color: t.colors.muted }]}>
              {org.portals.join(', ')} · {n} {n === 1 ? 'tender' : 'tenders'}
              {org.closingSoon ? ` · ${org.closingSoon} closing soon` : ''}
            </Text>
          </View>
          {canBookmark ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                bookmarked
                  ? 'Remove organisation bookmark'
                  : 'Bookmark organisation'
              }
              accessibilityState={{ selected: bookmarked }}
              onPress={onToggleBookmark}
              hitSlop={10}
              style={styles.mark}
            >
              <Bookmark
                size={19}
                color={bookmarked ? t.colors.accent : t.colors.muted}
                fill={bookmarked ? t.colors.accent : 'transparent'}
              />
            </Pressable>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
  // Organisation names come from the portals: Inter at normal spacing, as titles.
  name: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21 },
  meta: { fontFamily: fonts.regular, fontSize: 11, marginTop: 3 },
  mark: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
