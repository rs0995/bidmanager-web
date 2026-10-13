import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, ScreenHeader } from '../../components/ui';
import { StyleSlider } from '../../components/ui/StyleSlider';
import {
  ACCENT_KEYS,
  ACCENTS,
  BASES,
  BaseKey,
  fonts,
  useTheme,
  useThemePrefs,
} from '../../theme';
import type { RootStackParamList } from '../navigation/types';

/** A rounded-square swatch; the chosen one gets a ring with a small gap around it. */
function Swatch({
  color,
  label,
  selected,
  onPress,
  ringColor,
  outline,
}: {
  color: string;
  label: string;
  selected: boolean;
  onPress: () => void;
  ringColor: string;
  /** Draw a hairline around the swatch (for near-white colours). */
  outline?: string;
}) {
  const border = outline ? { borderWidth: 1, borderColor: outline } : null;
  const ring = selected ? { borderColor: ringColor } : null;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.ring, ring]}
    >
      <View style={[styles.swatch, { backgroundColor: color }, border]} />
    </Pressable>
  );
}

/** Accent, base colour (Light + Solid only) and Solid/Glass style. Changes apply instantly. */
export function AppearanceScreen() {
  const t = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { prefs, setPrefs } = useThemePrefs();
  const shade = t.scheme === 'dark' ? 'dark' : 'light';

  const caption = (name: string, value: string) => (
    <Text style={[styles.caption, { color: t.colors.muted }]}>
      {`${name}: `}
      <Text style={{ color: t.colors.ink, fontFamily: fonts.bold }}>
        {value}
      </Text>
    </Text>
  );

  return (
    <Screen>
      <ScreenHeader
        title="Colours & style"
        onBack={() => navigation.goBack()}
      />

      <View style={styles.swatches}>
        {ACCENT_KEYS.map(k => (
          <Swatch
            key={k}
            color={ACCENTS[k][shade].a}
            label={`Accent ${ACCENTS[k].label}`}
            selected={k === prefs.accent}
            ringColor={t.colors.ink}
            onPress={() => setPrefs({ accent: k })}
          />
        ))}
      </View>
      {caption('Accent', ACCENTS[prefs.accent].label)}

      {t.isGlass ? null : (
        <>
          <View style={[styles.swatches, styles.baseRow]}>
            {(Object.keys(BASES) as BaseKey[]).map(k => (
              <Swatch
                key={k}
                color={BASES[k].swatch}
                label={`Base ${BASES[k].label}`}
                selected={k === prefs.base}
                ringColor={t.colors.ink}
                outline={t.colors.hair}
                onPress={() => setPrefs({ base: k })}
              />
            ))}
          </View>
          {caption('Base colour', BASES[prefs.base].label)}
        </>
      )}

      <Text style={[styles.label, { color: t.colors.muted }]}>STYLE</Text>
      <StyleSlider
        value={prefs.style}
        onChange={style => setPrefs({ style })}
      />
      <Text style={[styles.hint, { color: t.colors.muted }]}>
        Solid is flat and opaque; Glass is translucent with a soft blur.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  swatches: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginTop: 8,
  },
  baseRow: { marginTop: 26 },
  ring: {
    width: 52,
    height: 52,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: 'transparent',
    padding: 3,
  },
  swatch: { flex: 1, borderRadius: 12 },
  caption: {
    fontFamily: fonts.medium,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 10,
  },
  label: {
    fontFamily: fonts.bold,
    fontSize: 10.5,
    letterSpacing: 0.8,
    marginTop: 30,
    marginBottom: 8,
    marginLeft: 2,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    marginTop: 8,
    marginLeft: 2,
  },
});
