import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from '../../theme';
import type { Tender } from '../../fixtures/tenders';
import { hoursUntilClose } from '../../lib/deadlines';
import { Card } from '../ui/Card';
import { ProgressBar } from '../ui/ProgressBar';
import { ProgressRing } from '../ui/ProgressRing';

type Props = {
  tender: Tender;
  onPress: () => void;
  /** Bookmarked tenders closing within 3 days, and the bookmarked total. */
  closingSoon: number;
  bookmarked: number;
};

/**
 * Full-width: the tender closing soonest, a ring that fills as its 3-day window runs
 * out, its portal, and how many bookmarked tenders are closing soon.
 */
export function NextDeadlineCard({
  tender,
  onPress,
  closingSoon,
  bookmarked,
}: Props) {
  const t = useTheme();
  const progress = 1 - Math.min(hoursUntilClose(tender.closeIn), 72) / 72;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${tender.short}`}
      onPress={onPress}
      style={styles.press}
    >
      <Card radius="xl" padding={16} style={styles.card}>
        <View style={styles.row}>
          <ProgressRing
            size={80}
            progress={progress}
            colors={[t.colors.crit, t.colors.accent]}
          >
            <Text style={[styles.ends, { color: t.colors.muted }]}>
              ENDS IN
            </Text>
            <Text style={[styles.remaining, { color: t.colors.ink }]}>
              {tender.closeIn}
            </Text>
          </ProgressRing>
          <View style={styles.text}>
            <Text style={[styles.heading, { color: t.colors.muted }]}>
              NEXT DEADLINE
            </Text>
            <Text
              numberOfLines={2}
              style={[styles.title, { color: t.colors.ink }]}
            >
              {tender.short}
            </Text>
            <View
              style={[styles.tag, { backgroundColor: t.colors.accentWash }]}
            >
              <Text style={[styles.tagText, { color: t.colors.accentInk }]}>
                {tender.portal}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.stat}>
          <View style={styles.statTop}>
            <Text style={[styles.statName, { color: t.colors.inkSoft }]}>
              Closing soon
            </Text>
            <Text style={[styles.statCount, { color: t.colors.muted }]}>
              {closingSoon}
            </Text>
          </View>
          <ProgressBar progress={bookmarked ? closingSoon / bookmarked : 0} />
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  press: { marginBottom: 14 },
  card: { gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  ends: { fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.3 },
  remaining: { fontFamily: fonts.monoSemibold, fontSize: 15, marginTop: 2 },
  text: { flex: 1 },
  heading: { fontFamily: fonts.bold, fontSize: 10.5, letterSpacing: 0.9 },
  title: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, marginTop: 4 },
  tag: {
    alignSelf: 'flex-start',
    marginTop: 8,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagText: { fontFamily: fonts.bold, fontSize: 10.5 },
  stat: { gap: 6 },
  statTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  statName: { fontFamily: fonts.semibold, fontSize: 11.5 },
  statCount: { fontFamily: fonts.bold, fontSize: 12 },
});
