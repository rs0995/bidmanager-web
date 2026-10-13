import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LucideIcon } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import { GlassBlur } from './GlassBlur';

type Option<K extends string> = {
  key: K;
  label: string;
  /** Optional leading icon. */
  icon?: LucideIcon;
};

type Props<K extends string> = {
  options: Option<K>[];
  value: K;
  onChange: (key: K) => void;
};

export function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
}: Props<K>) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.track,
        {
          backgroundColor: t.colors.surfaceSunk,
          borderColor: t.isGlass ? t.glass.border : t.colors.hair,
        },
      ]}
    >
      <GlassBlur amount={18} />
      {options.map(o => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={[
              styles.seg,
              on && {
                backgroundColor: t.isGlass ? t.glass.fillStrong : t.colors.bg,
              },
              on && t.shadow.sm,
            ]}
          >
            {o.icon ? (
              <o.icon size={15} color={on ? t.colors.ink : t.colors.muted} />
            ) : null}
            <Text
              style={[
                styles.label,
                {
                  color: on ? t.colors.ink : t.colors.muted,
                  fontFamily: on ? fonts.bold : fonts.medium,
                },
              ]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: 13,
    borderWidth: 1,
    padding: 3,
    overflow: 'hidden',
  },
  seg: {
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 10,
  },
  label: { fontSize: 13 },
});
