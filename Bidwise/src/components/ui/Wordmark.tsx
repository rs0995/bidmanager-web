import React, { useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { BRAND, fonts, useTheme } from '../../theme';

// The mark, in a 100×100 tile: two slanted slabs (white to ice blue) on a near-black
// tile with a warm glow rising from the bottom. Same geometry as the app icon
// (ios/Bidwise/Images.xcassets/AppIcon.appiconset).
const TOP_SLAB = '37.25,21.3 73.95,21.3 73.95,36.4 26.05,36.4';
const LOW_SLAB =
  '45.35,46.7 65,46.7 65,57.3 40,77.3 26.05,77.3 26.05,62.2 34.25,62.2';

/** The square brand mark on its own (sign-in, lock screen). */
export function BrandMark({ size = 38 }: { size?: number }) {
  const t = useTheme();
  // Unique per instance: duplicate SVG ids break on web.
  const uid = `bm${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const id = (name: string) => `${uid}${name}`;
  return (
    <View
      style={[
        styles.mark,
        {
          width: size,
          height: size,
          borderRadius: size * 0.29,
          // A hairline edge keeps the dark tile defined on dark and glass screens.
          borderWidth: t.scheme === 'dark' || t.isGlass ? 1 : 0,
          borderColor: t.isGlass ? t.glass.edge : 'rgba(255,255,255,0.10)',
        },
      ]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        <Defs>
          <RadialGradient
            id={id('glow')}
            cx="50"
            cy="108"
            rx="95"
            ry="72"
            fx="50"
            fy="108"
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={BRAND.glowRim} stopOpacity={1} />
            <Stop offset="0.3" stopColor={BRAND.glow} stopOpacity={0.95} />
            <Stop offset="0.65" stopColor={BRAND.glowDeep} stopOpacity={0.45} />
            <Stop offset="1" stopColor={BRAND.glowDeep} stopOpacity={0} />
          </RadialGradient>
          <LinearGradient
            id={id('slab')}
            x1="0"
            y1="21.3"
            x2="0"
            y2="77.3"
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={BRAND.slabTop} />
            <Stop offset="1" stopColor={BRAND.slabBottom} />
          </LinearGradient>
        </Defs>
        <Rect width="100" height="100" fill={BRAND.tile} />
        <Rect width="100" height="100" fill={`url(#${id('glow')})`} />
        <Polygon points={TOP_SLAB} fill={`url(#${id('slab')})`} />
        <Polygon points={LOW_SLAB} fill={`url(#${id('slab')})`} />
      </Svg>
    </View>
  );
}

/** The mark followed by the word "bidwise". */
export function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const t = useTheme();
  const k = size === 'lg' ? 1.25 : size === 'sm' ? 0.8 : 1;
  const dark = t.scheme === 'dark';
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="header"
      accessibilityLabel="bidwise"
    >
      <BrandMark size={38 * k} />
      <Text
        style={[
          styles.word,
          {
            color: dark ? BRAND.wordDark : BRAND.wordLight,
            fontSize: 25 * k,
          },
        ]}
      >
        bidwise
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  mark: { overflow: 'hidden' },
  word: { fontFamily: fonts.bold, letterSpacing: -1 },
});
