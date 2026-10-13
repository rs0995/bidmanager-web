import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronDown } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import { GlassBlur } from '../ui/GlassBlur';

type Props = {
  options: readonly string[];
  value: string;
  /** Optional tender count shown beside each portal. */
  counts?: Record<string, number>;
  onChange: (p: string) => void;
};

/** Portal dropdown: shows the selected portal; tapping opens the list of portals. */
export function PortalSelect({ options, value, counts, onChange }: Props) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const field = {
    backgroundColor: t.isGlass ? t.glass.fill : t.colors.surfaceSoft,
    borderColor: t.isGlass ? t.glass.border : t.colors.hair,
  };
  const count = (p: string) =>
    counts && counts[p] !== undefined ? String(counts[p]) : null;

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Portal: ${value}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(o => !o)}
        style={[styles.trigger, field]}
      >
        <GlassBlur amount={16} />
        <View style={[styles.dot, { backgroundColor: t.colors.accent }]} />
        <Text style={[styles.value, { color: t.colors.ink }]}>{value}</Text>
        {count(value) ? (
          <Text style={[styles.count, { color: t.colors.muted }]}>
            {count(value)}
          </Text>
        ) : null}
        <View style={styles.spacer} />
        <View style={open ? styles.flip : undefined}>
          <ChevronDown size={18} color={t.colors.muted} />
        </View>
      </Pressable>
      {open ? (
        <View style={[styles.menu, field]}>
          <GlassBlur amount={18} />
          {options.map(p => {
            const on = p === value;
            return (
              <Pressable
                key={p}
                accessibilityRole="menuitem"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  setOpen(false);
                  onChange(p);
                }}
                style={styles.option}
              >
                <Text
                  style={[
                    styles.optionText,
                    {
                      color: on ? t.colors.accentInk : t.colors.ink,
                      fontFamily: on ? fonts.bold : fonts.medium,
                    },
                  ]}
                >
                  {p}
                </Text>
                {count(p) ? (
                  <Text style={[styles.count, { color: t.colors.muted }]}>
                    {count(p)}
                  </Text>
                ) : null}
                <View style={styles.tick}>
                  {on ? <Check size={16} color={t.colors.accent} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  value: { fontFamily: fonts.semibold, fontSize: 14 },
  count: { fontFamily: fonts.monoMedium, fontSize: 11.5 },
  spacer: { flex: 1 },
  flip: { transform: [{ rotate: '180deg' }] },
  menu: {
    marginTop: 6,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  optionText: { fontSize: 14 },
  tick: { width: 18, marginLeft: 'auto', alignItems: 'flex-end' },
});
