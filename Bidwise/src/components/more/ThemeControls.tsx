import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Polygon } from 'react-native-svg';
import { Monitor, Moon, Sun } from 'lucide-react-native';
import { Segmented } from '../ui';
import {
  ACCENT_KEYS,
  ACCENTS,
  accentSwatch,
  fonts,
  useTheme,
  useThemePrefs,
} from '../../theme';
import type { StyleKey, ThemeMode } from '../../theme';

/** Accent circle with a hairline border; Mono is white and black split diagonally. */
function SwatchDot({
  fill,
  split,
  hair,
}: {
  fill: string;
  split: string | null;
  hair: string;
}) {
  if (!split)
    return (
      <View
        style={[styles.dot, { backgroundColor: fill, borderColor: hair }]}
      />
    );
  return (
    <View style={[styles.dot, { borderColor: hair }]}>
      <Svg width="100%" height="100%" viewBox="0 0 16 16">
        <Polygon points="0,0 16,0 0,16" fill={fill} />
        <Polygon points="16,0 16,16 0,16" fill={split} />
        <Line x1="16" y1="0" x2="0" y2="16" stroke={hair} strokeWidth={0.5} />
      </Svg>
    </View>
  );
}

/**
 * Everything in More's Theme row: Dark / Light / System, the display (Solid, Liquid
 * glass, Paper) and the accent colour. Paper is BM Pro's own theme with its fixed
 * indigo, so it has no accent choice. Saved on this device.
 */
export function ThemeControls() {
  const t = useTheme();
  const { prefs, setPrefs } = useThemePrefs();
  const paper = prefs.style === 'paper';
  const label = (text: string) => (
    <Text style={[styles.label, { color: t.colors.muted }]}>{text}</Text>
  );

  return (
    <View>
      <Segmented<ThemeMode>
        style={styles.first}
        value={prefs.mode}
        onChange={mode => setPrefs({ mode })}
        options={[
          {
            value: 'dark',
            label: 'Dark',
            icon: c => <Moon size={15} color={c} />,
          },
          {
            value: 'light',
            label: 'Light',
            icon: c => <Sun size={15} color={c} />,
          },
          {
            value: 'system',
            label: 'System',
            icon: c => <Monitor size={15} color={c} />,
          },
        ]}
      />

      {label('Display')}
      <Segmented<StyleKey>
        value={prefs.style}
        onChange={style => setPrefs({ style })}
        options={[
          { value: 'solid', label: 'Solid' },
          { value: 'glass', label: 'Liquid glass' },
          { value: 'paper', label: 'Paper' },
        ]}
      />

      {paper ? null : (
        <>
          {label('Accent colour')}
          <View style={styles.swatches}>
            {ACCENT_KEYS.map(k => {
              const on = prefs.accent === k;
              const sw = accentSwatch(k);
              // The chosen colour gets a ring in its own shade; Mono uses the ink.
              const ring = sw.split ? t.colors.ink : sw.fill;
              return (
                <Pressable
                  key={k}
                  accessibilityRole="radio"
                  accessibilityLabel={ACCENTS[k].label}
                  accessibilityState={{ selected: on }}
                  onPress={() => setPrefs({ accent: k })}
                  hitSlop={4}
                  style={[
                    styles.ring,
                    { borderColor: on ? ring : 'transparent' },
                  ]}
                >
                  <SwatchDot
                    fill={sw.fill}
                    split={sw.split}
                    hair={t.colors.hair}
                  />
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  first: { marginTop: 12 },
  label: {
    fontFamily: fonts.medium,
    fontSize: 12.5,
    marginTop: 16,
    marginBottom: 8,
  },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  // Ring around the chosen circle, set off from it by a small gap.
  ring: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    overflow: 'hidden',
  },
});
