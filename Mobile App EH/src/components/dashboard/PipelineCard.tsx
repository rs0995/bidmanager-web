import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from '../../theme';
import { formatCrores } from '../../lib/format';
import { Card } from '../ui/Card';
import { ProgressBar } from '../ui/ProgressBar';
import { ProgressRing } from '../ui/ProgressRing';

type Stat = { label: string; count: number; ratio: number };

type Props = {
  /** Combined value of the bookmarked tenders, in crores. */
  crores: number;
  /** Share of that value currently in preparation as a project. 0 to 1. */
  prepPct: number;
  stats: [Stat, Stat];
};

/** Full-width: value across bookmarked tenders, the prep-value ring, and two stat bars. */
export function PipelineCard({ crores, prepPct, stats }: Props) {
  const t = useTheme();
  const pct = Math.round(prepPct * 100);
  return (
    <Card radius="xl" padding={16} style={styles.card}>
      <Text style={[styles.title, { color: t.colors.ink }]}>
        Pipeline Snapshot
      </Text>
      <Text style={[styles.sub, { color: t.colors.muted }]}>
        Across bookmarked tenders
      </Text>

      <View style={styles.body}>
        <View style={styles.valueCol}>
          <Text style={[styles.value, { color: t.colors.ink }]}>
            {formatCrores(crores)}
            <Text style={[styles.unit, { color: t.colors.muted }]}> Cr</Text>
          </Text>
          <Text style={[styles.cap, { color: t.colors.muted }]}>
            {pct}% of value in preparation
          </Text>
        </View>
        <View style={styles.ringSlot}>
          <ProgressRing size={95} progress={prepPct}>
            <Text style={[styles.ringValue, { color: t.colors.ink }]}>
              {pct}%
            </Text>
            <Text style={[styles.ringLabel, { color: t.colors.muted }]}>
              PREP
            </Text>
          </ProgressRing>
        </View>
      </View>

      <View style={styles.stats}>
        {stats.map(s => (
          <View key={s.label} style={styles.stat}>
            <View style={styles.statTop}>
              <Text
                numberOfLines={1}
                style={[styles.statName, { color: t.colors.inkSoft }]}
              >
                {s.label}
              </Text>
              <Text style={[styles.statCount, { color: t.colors.muted }]}>
                {s.count}
              </Text>
            </View>
            <ProgressBar progress={s.ratio} />
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 14 },
  title: { fontFamily: fonts.bold, fontSize: 14 },
  sub: { fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  valueCol: { flexShrink: 1 },
  // Fills the space after the value column; the ring sits inside it, nudged right and
  // up from dead centre.
  ringSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 55,
    marginTop: -20,
  },
  value: { fontFamily: fonts.extrabold, fontSize: 30, letterSpacing: -1 },
  unit: { fontFamily: fonts.semibold, fontSize: 14, letterSpacing: 0 },
  cap: { fontFamily: fonts.regular, fontSize: 11.5, marginTop: 3 },
  ringValue: { fontFamily: fonts.extrabold, fontSize: 14 },
  ringLabel: { fontFamily: fonts.semibold, fontSize: 8, letterSpacing: 0.2 },
  stats: { flexDirection: 'row', gap: 16, marginTop: 16 },
  stat: { flex: 1, gap: 7 },
  statTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 4,
  },
  statName: { fontFamily: fonts.semibold, fontSize: 11.5, flexShrink: 1 },
  statCount: { fontFamily: fonts.bold, fontSize: 12 },
});
