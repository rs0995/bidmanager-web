import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from '../../theme';
import { Card } from '../ui/Card';

export type FieldItem = { label: string; value: string; full?: boolean };

/** Groups items into rows: a `full` item is its own row, otherwise two side by side. */
function buildRows(items: FieldItem[]): FieldItem[][] {
  const rows: FieldItem[][] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.full) {
      rows.push([it]);
      continue;
    }
    const next = items[i + 1];
    if (next && !next.full) {
      rows.push([it, next]);
      i += 1;
    } else {
      rows.push([it]);
    }
  }
  return rows;
}

/** Two-column label/value grid used on detail screens, with a divider between a pair. */
export function FieldGrid({ items }: { items: FieldItem[] }) {
  const t = useTheme();
  const rows = buildRows(items);
  return (
    <Card padding={0} elevation="sm">
      {rows.map((row, ri) => (
        <View
          key={row[0].label}
          style={[
            styles.row,
            ri > 0 && {
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: t.colors.hair,
            },
          ]}
        >
          {row.map((it, ci) => (
            <React.Fragment key={it.label}>
              {ci > 0 ? (
                <View
                  style={[styles.divider, { backgroundColor: t.colors.hair }]}
                />
              ) : null}
              <View style={[styles.cell, it.full ? styles.full : styles.half]}>
                <Text style={[styles.label, { color: t.colors.muted }]}>
                  {it.label.toUpperCase()}
                </Text>
                <Text style={[styles.value, { color: t.colors.ink }]}>
                  {it.value}
                </Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  divider: { width: StyleSheet.hairlineWidth },
  cell: { paddingHorizontal: 14, paddingVertical: 11 },
  half: { flex: 1 },
  full: { width: '100%' },
  label: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.6 },
  value: { fontFamily: fonts.medium, fontSize: 13, marginTop: 3 },
});
