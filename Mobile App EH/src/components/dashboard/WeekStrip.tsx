import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from '../../theme';
import type { WeekDay } from '../../fixtures/dashboard';

export function WeekStrip({ days }: { days: WeekDay[] }) {
  const t = useTheme();
  return (
    <View style={styles.row}>
      {days.map(d => (
        <View
          key={d.num}
          style={[
            styles.day,
            d.today && {
              backgroundColor: t.isGlass ? t.glass.fill : t.colors.surface,
            },
            d.today && t.shadow.sm,
          ]}
        >
          <Text style={[styles.name, { color: t.colors.muted }]}>
            {d.name.toUpperCase()}
          </Text>
          <Text
            style={[
              styles.num,
              { color: d.today ? t.colors.accentInk : t.colors.ink },
            ]}
          >
            {d.num}
          </Text>
          <View style={styles.marks}>
            {d.closing === 0 && d.meeting === 0 ? (
              <View style={[styles.dot, { backgroundColor: t.colors.hair }]} />
            ) : null}
            {Array.from({ length: d.closing }).map((_, i) => (
              <View
                key={`c${i}`}
                style={[styles.dot, { backgroundColor: t.colors.accent }]}
              />
            ))}
            {Array.from({ length: d.meeting }).map((_, i) => (
              <View
                key={`m${i}`}
                style={[
                  styles.dot,
                  styles.meetingDot,
                  { backgroundColor: t.colors.muted },
                ]}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 7, marginBottom: 16 },
  day: {
    flex: 1,
    borderRadius: 16,
    paddingTop: 9,
    paddingBottom: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  name: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 0.3 },
  num: { fontFamily: fonts.bold, fontSize: 15, marginTop: 3 },
  marks: {
    flexDirection: 'row',
    gap: 3,
    marginTop: 7,
    height: 12,
    alignItems: 'flex-start',
  },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  meetingDot: { opacity: 0.55 },
});
