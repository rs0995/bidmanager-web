import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from '../../theme';
import { GlassBlur } from './GlassBlur';
import { Gradient } from './Gradient';

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** Small trailing text, e.g. a count. */
  trailing?: string;
};

/** Selectable pill used for portal / filter rows. */
export function Chip({ label, selected, onPress, trailing }: ChipProps) {
  const t = useTheme();
  const textColor = selected ? t.colors.onAccent : t.colors.inkSoft;
  const inner = (
    <View style={styles.row}>
      <Text style={[styles.label, { color: textColor }]}>{label}</Text>
      {trailing ? (
        <Text style={[styles.trailing, { color: textColor }]}>{trailing}</Text>
      ) : null}
    </View>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
    >
      {selected ? (
        <Gradient
          colors={[t.colors.accent, t.colors.accent2]}
          style={[styles.pill, styles.selected]}
        >
          {inner}
        </Gradient>
      ) : (
        <View
          style={[
            styles.pill,
            styles.clip,
            { backgroundColor: t.isGlass ? t.glass.fill : t.colors.surface },
            t.isGlass && styles.glassBorder,
            t.isGlass && { borderColor: t.glass.border },
            t.shadow.sm,
          ]}
        >
          <GlassBlur amount={16} />
          {inner}
        </View>
      )}
    </Pressable>
  );
}

export type Tone = 'ok' | 'soon' | 'crit' | 'plain' | 'accent';

/** Small status / countdown pill, monospaced. */
export function StatusChip({ tone, label }: { tone: Tone; label: string }) {
  const t = useTheme();
  const map = {
    ok: [t.colors.goodWash, t.colors.good],
    soon: [t.colors.warnWash, t.colors.warn],
    crit: [t.colors.critWash, t.colors.crit],
    plain: [t.colors.surfaceSunk, t.colors.inkSoft],
    accent: [t.colors.accentWash, t.colors.accentInk],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.status, { backgroundColor: bg }]}>
      <Text style={[styles.statusText, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: 999, paddingHorizontal: 15, paddingVertical: 9 },
  clip: { overflow: 'hidden' },
  glassBorder: { borderWidth: 1 },
  selected: {},
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontFamily: fonts.semibold, fontSize: 12.5 },
  trailing: { fontFamily: fonts.monoMedium, fontSize: 11, opacity: 0.75 },
  status: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  statusText: { fontFamily: fonts.monoSemibold, fontSize: 10.5 },
});
