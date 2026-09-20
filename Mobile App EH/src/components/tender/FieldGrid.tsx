import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from '../../theme';
import { Card } from '../ui/Card';

export type FieldItem = { label: string; value: string; full?: boolean };

/** Two-column label/value grid used on detail screens. */
export function FieldGrid({ items }: { items: FieldItem[] }) {
  const t = useTheme();
  return (
    <Card padding={0} elevation="sm">
      <View style={styles.grid}>
        {items.map((it, i) => (
          <View
            key={it.label}
            style={[
              styles.cell,
              it.full ? styles.full : styles.half,
              i > 0 && {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: t.colors.hair,
              },
            ]}
          >
            <Text style={[styles.label, { color: t.colors.muted }]}>
              {it.label.toUpperCase()}
            </Text>
            <Text style={[styles.value, { color: t.colors.ink }]}>
              {it.value}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { paddingHorizontal: 14, paddingVertical: 11 },
  half: { width: '50%' },
  full: { width: '100%' },
  label: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.6 },
  value: { fontFamily: fonts.medium, fontSize: 13, marginTop: 3 },
});
