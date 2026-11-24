import React, { useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';
import { BRAND, fonts, useTheme } from '../../theme';

// The mark, in a 1024×1024 design space: the desktop app's icon (Client UI/assets/icon.svg)
// on a full-bleed navy tile. Three rising bars under a green tick badge. Same geometry as
// the app icon (assets/brand/bidwise-icon.svg, ios/Bidwise/Images.xcassets/AppIcon.appiconset).
const TICK = 'M651 294 L699 342 L784 245';

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
      <Svg width="100%" height="100%" viewBox="0 0 1024 1024">
        <Defs>
          <LinearGradient
            id={id('tile')}
            x1="0"
            y1="0"
            x2="1024"
            y2="1024"
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={BRAND.tileTop} />
            <Stop offset="1" stopColor={BRAND.tileBottom} />
          </LinearGradient>
          <LinearGradient
            id={id('bar')}
            x1="0"
            y1="812"
            x2="0"
            y2="304"
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0" stopColor={BRAND.barFrom} />
            <Stop offset="1" stopColor={BRAND.barTo} />
          </LinearGradient>
        </Defs>
        <Rect width="1024" height="1024" fill={`url(#${id('tile')})`} />
        <Rect
          x="196"
          y="576"
          width="156"
          height="236"
          rx="42"
          fill={BRAND.barLow}
        />
        <Rect
          x="382"
          y="452"
          width="156"
          height="360"
          rx="42"
          fill={BRAND.barMid}
        />
        <Rect
          x="568"
          y="304"
          width="156"
          height="508"
          rx="42"
          fill={`url(#${id('bar')})`}
        />
        <Circle cx="716" cy="292" r="151" fill={BRAND.badgeRing} />
        <Circle cx="716" cy="292" r="131" fill={BRAND.badge} />
        <Path
          d={TICK}
          fill="none"
          stroke="#ffffff"
          strokeWidth={59}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

/** The mark followed by the word "bidwise". */
export function Wordmark({
  size = 'md',
}: {
  /** `xl`: the sign-in screen's large logo. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const t = useTheme();
  const k =
    size === 'xl' ? 1.6 : size === 'lg' ? 1.25 : size === 'sm' ? 0.8 : 1;
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
  word: { fontFamily: fonts.semibold, letterSpacing: -0.5 },
});
