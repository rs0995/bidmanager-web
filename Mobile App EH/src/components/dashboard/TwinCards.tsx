import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Clock, Cloud } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import { nextDeadline, syncStatus } from '../../fixtures/dashboard';
import { Card } from '../ui/Card';
import { ProgressRing } from '../ui/ProgressRing';

export function NextDeadlineCard({
  data = nextDeadline,
}: {
  data?: typeof nextDeadline;
}) {
  const t = useTheme();
  return (
    <Card style={styles.card}>
      <Text style={[styles.heading, { color: t.colors.ink }]}>
        Next Deadline
      </Text>
      <View style={styles.center}>
        <ProgressRing
          size={96}
          progress={data.progress}
          colors={[t.colors.crit, t.colors.accent]}
        >
          <Text style={[styles.ends, { color: t.colors.muted }]}>ENDS IN</Text>
          <Text style={[styles.remaining, { color: t.colors.ink }]}>
            {data.remaining}
          </Text>
        </ProgressRing>
        <Text style={[styles.what, { color: t.colors.ink }]}>{data.title}</Text>
        <View style={[styles.tag, { backgroundColor: t.colors.accentWash }]}>
          <Text style={[styles.tagText, { color: t.colors.accentInk }]}>
            {data.portal}
          </Text>
        </View>
      </View>
    </Card>
  );
}

export function SyncCard({ data = syncStatus }: { data?: typeof syncStatus }) {
  const t = useTheme();
  return (
    <Card style={styles.card}>
      <Text style={[styles.heading, { color: t.colors.ink }]}>Sync</Text>
      <View style={[styles.icon, { backgroundColor: t.colors.accentWash }]}>
        <Cloud size={20} color={t.colors.accentInk} />
      </View>
      <Text style={[styles.count, { color: t.colors.ink }]}>
        {data.newTenders}
      </Text>
      <Text style={[styles.countLabel, { color: t.colors.muted }]}>
        {data.label}
      </Text>
      <View style={styles.meta}>
        <Clock size={11} color={t.colors.muted} />
        <Text style={[styles.metaText, { color: t.colors.muted }]}>
          {data.lastSynced}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  heading: { fontFamily: fonts.bold, fontSize: 12.5, marginBottom: 12 },
  center: { alignItems: 'center' },
  ends: { fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.3 },
  remaining: { fontFamily: fonts.monoSemibold, fontSize: 15, marginTop: 2 },
  what: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    marginTop: 12,
    textAlign: 'center',
    lineHeight: 15,
  },
  tag: {
    marginTop: 7,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  tagText: { fontFamily: fonts.bold, fontSize: 9.5 },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  count: { fontFamily: fonts.extrabold, fontSize: 26, letterSpacing: -0.5 },
  countLabel: { fontFamily: fonts.regular, fontSize: 11, marginTop: 1 },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 'auto',
    paddingTop: 12,
  },
  metaText: { fontFamily: fonts.regular, fontSize: 10.5, flexShrink: 1 },
});
