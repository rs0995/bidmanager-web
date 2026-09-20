import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from '../../theme';
import { Portal } from '../../fixtures/tenders';
import { GlassBlur } from '../ui/GlassBlur';

type Props = {
  portals: Portal[];
  value: Portal;
  counts: Record<string, number>;
  onChange: (p: Portal) => void;
};

/** Portal selector. One portal is always selected (there is no "All"). */
export function SiteScope({ portals, value, counts, onChange }: Props) {
  const t = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      {portals.map(p => {
        const on = p === value;
        const surface = {
          backgroundColor: on
            ? t.colors.accentWash
            : t.isGlass
            ? t.glass.fill
            : t.colors.surface,
          borderColor: on ? t.colors.accent : 'transparent',
        };
        return (
          <Pressable
            key={p}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(p)}
            style={[styles.btn, surface]}
          >
            {on ? null : <GlassBlur amount={16} />}
            <View
              style={[
                styles.dot,
                { backgroundColor: on ? t.colors.accent : t.colors.muted },
              ]}
            />
            <Text
              style={[
                styles.label,
                {
                  color: on ? t.colors.accentInk : t.colors.inkSoft,
                  fontFamily: on ? fonts.bold : fonts.medium,
                },
              ]}
            >
              {p}
            </Text>
            <Text
              style={[
                styles.count,
                { color: on ? t.colors.accentInk : t.colors.muted },
              ]}
            >
              {counts[p] ?? 0}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { marginHorizontal: -18, flexGrow: 0 },
  row: { paddingHorizontal: 18, gap: 8, paddingVertical: 3 },
  btn: {
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  label: { fontSize: 12.5 },
  count: { fontFamily: fonts.monoMedium, fontSize: 11, opacity: 0.8 },
});
