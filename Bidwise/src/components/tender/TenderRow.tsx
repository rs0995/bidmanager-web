import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Building2, MapPin, Star } from 'lucide-react-native';
import { Card } from '../ui/Card';
import type { Tender } from '../../fixtures/tenders';
import { leftLabel } from '../../lib/deadlines';
import { useAccess } from '../../lib/account';
import { fonts, useTheme } from '../../theme';

/**
 * Due badge: urgent tone for anything closing within 5 days. `text` replaces the
 * countdown (archived tenders show "Closed 19 Aug" in a neutral tone).
 */
export function DueBadge({ tender, text }: { tender: Tender; text?: string }) {
  const t = useTheme();
  const urgent = !text && tender.state !== 'ok';
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: text
            ? t.colors.surfaceSunk
            : urgent
            ? t.colors.warnWash
            : t.colors.accentWash,
        },
      ]}
    >
      <Text
        style={[
          styles.badgeText,
          {
            color: text
              ? t.colors.inkSoft
              : urgent
              ? t.colors.warn
              : t.colors.accentInk,
          },
        ]}
      >
        {text ?? leftLabel(tender.closeIn)}
      </Text>
    </View>
  );
}

export function TenderRow({
  tender,
  saved,
  onOpen,
  onToggleSave,
  badgeText,
}: {
  tender: Tender;
  saved: boolean;
  /** Replaces the countdown badge (archived tenders). */
  badgeText?: string;
  onOpen: () => void;
  onToggleSave: () => void;
}) {
  const t = useTheme();
  const canSave = useAccess().bookmarks;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${tender.short}, ${tender.org}`}
      onPress={onOpen}
    >
      <Card padding={16} radius="lg" elevation="sm" style={styles.card}>
        <View style={styles.top}>
          <View style={styles.org}>
            <Building2 size={15} color={t.colors.accent} />
            <Text
              numberOfLines={1}
              style={[styles.orgText, { color: t.colors.inkSoft }]}
            >
              {tender.org}
            </Text>
          </View>
          <View style={styles.right}>
            <DueBadge tender={tender} text={badgeText} />
            {/* No star when the organisation turned bookmarks off for this member. */}
            {canSave ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={saved ? 'Unsave tender' : 'Save tender'}
                accessibilityState={{ selected: saved }}
                onPress={onToggleSave}
                hitSlop={10}
                style={[
                  styles.star,
                  saved && { backgroundColor: t.colors.accentWash },
                ]}
              >
                <Star
                  size={17}
                  color={saved ? t.colors.accent : t.colors.muted}
                  fill={saved ? t.colors.accent : 'transparent'}
                />
              </Pressable>
            ) : null}
          </View>
        </View>
        <Text style={[styles.id, { color: t.colors.muted }]}>
          {tender.refId ?? tender.id}
        </Text>
        <Text numberOfLines={2} style={[styles.title, { color: t.colors.ink }]}>
          {tender.title}
        </Text>
        <View style={styles.loc}>
          <MapPin size={13} color={t.colors.muted} />
          <Text
            numberOfLines={1}
            style={[styles.locText, { color: t.colors.muted }]}
          >
            {tender.location} ·{' '}
            <Text style={[styles.value, { color: t.colors.ink }]}>
              {tender.value}
            </Text>
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  org: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  orgText: { fontFamily: fonts.medium, fontSize: 11, flexShrink: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7 },
  badgeText: { fontFamily: fonts.semibold, fontSize: 10 },
  id: { fontFamily: fonts.monoMedium, fontSize: 10, marginTop: 12 },
  title: {
    // Portal titles are long and often ALL CAPS: Inter at normal spacing stays even.
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 4,
  },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  locText: { fontFamily: fonts.regular, fontSize: 11 },
  value: { fontFamily: fonts.semibold, fontSize: 12 },
  star: {
    width: 30,
    height: 30,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
