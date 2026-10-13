import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, StyleKey, useTheme } from '../../theme';

type Props = {
  value: StyleKey;
  onChange: (v: StyleKey) => void;
};

const STOPS: { key: StyleKey; label: string }[] = [
  { key: 'solid', label: 'Solid' },
  { key: 'glass', label: 'Glass' },
];

/** Two-stop slider between the Solid and Glass looks: the thumb sits under the chosen side. */
export function StyleSlider({ value, onChange }: Props) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.track,
        {
          backgroundColor: t.colors.surfaceSunk,
          borderColor: t.isGlass ? t.glass.border : t.colors.hair,
        },
      ]}
    >
      <View style={styles.inner}>
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            { backgroundColor: t.colors.accent },
            value === 'glass' ? styles.right : styles.left,
          ]}
        />
        {STOPS.map(s => {
          const on = s.key === value;
          return (
            <Pressable
              key={s.key}
              accessibilityRole="radio"
              accessibilityLabel={`${s.label} style`}
              accessibilityState={{ selected: on }}
              onPress={() => onChange(s.key)}
              style={styles.stop}
            >
              <Text
                style={[
                  styles.label,
                  {
                    color: on ? t.colors.onAccent : t.colors.muted,
                    fontFamily: on ? fonts.bold : fonts.medium,
                  },
                ]}
              >
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    padding: 3,
  },
  inner: { flex: 1, flexDirection: 'row' },
  thumb: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '50%',
    borderRadius: 11,
  },
  left: { left: 0 },
  right: { right: 0 },
  stop: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13.5 },
});
