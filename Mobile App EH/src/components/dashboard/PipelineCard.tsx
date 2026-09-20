import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from '../../theme';
import { pipeline } from '../../fixtures/dashboard';
import { Card } from '../ui/Card';
import { ProgressBar } from '../ui/ProgressBar';
import { ProgressRing } from '../ui/ProgressRing';

type Props = { data?: typeof pipeline };

export function PipelineCard({ data = pipeline }: Props) {
  const t = useTheme();
  const pct = Math.round(data.targetPct * 100);
  return (
    <Card radius="xl" padding={20} style={styles.card}>
      <Text style={[styles.title, { color: t.colors.ink }]}>{data.title}</Text>
      <Text style={[styles.sub, { color: t.colors.muted }]}>
        {data.subtitle}
      </Text>

      <View style={styles.body}>
        <View style={styles.valueCol}>
          <Text style={[styles.value, { color: t.colors.ink }]}>
            {data.value}
            <Text style={[styles.unit, { color: t.colors.muted }]}>
              {' '}
              {data.unit}
            </Text>
          </Text>
          <Text style={[styles.cap, { color: t.colors.muted }]}>
            {pct}% of quarterly target
          </Text>
        </View>
        <ProgressRing size={78} progress={data.targetPct}>
          <Text style={[styles.ringValue, { color: t.colors.ink }]}>
            {pct}%
          </Text>
          <Text style={[styles.ringLabel, { color: t.colors.muted }]}>
            TARGET
          </Text>
        </ProgressRing>
      </View>

      <View style={styles.stats}>
        {data.stats.map(s => (
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
    justifyContent: 'space-between',
    marginTop: 14,
  },
  valueCol: { flexShrink: 1 },
  value: { fontFamily: fonts.extrabold, fontSize: 34, letterSpacing: -1 },
  unit: { fontFamily: fonts.semibold, fontSize: 15, letterSpacing: 0 },
  cap: { fontFamily: fonts.regular, fontSize: 11.5, marginTop: 3 },
  ringValue: { fontFamily: fonts.extrabold, fontSize: 15 },
  ringLabel: { fontFamily: fonts.semibold, fontSize: 8.5, letterSpacing: 0.2 },
  stats: { flexDirection: 'row', gap: 10, marginTop: 18 },
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
