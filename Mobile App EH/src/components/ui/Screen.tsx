import React from 'react';
import {
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from '@react-native-community/blur';
import { useTheme } from '../../theme';
import { EdgeFade } from './EdgeFade';

const TAB_BAR_HEIGHT = 62;

/** Bottom padding that keeps the last item clear of the floating tab bar. */
export function useTabBarClearance() {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + Math.max(insets.bottom, 12) + 22;
}

const ORBS = [
  { cx: '86%', cy: '10%', r: 170, c: 0 },
  { cx: '6%', cy: '30%', r: 150, c: 1 },
  { cx: '94%', cy: '48%', r: 170, c: 2 },
  { cx: '4%', cy: '66%', r: 160, c: 3 },
  { cx: '80%', cy: '86%', r: 170, c: 1 },
  { cx: '30%', cy: '98%', r: 140, c: 0 },
] as const;

/** Flat colour in Solid style; gradient + soft colour orbs in Glass style. */
export function ScreenBackground() {
  const t = useTheme();
  if (!t.isGlass) {
    return (
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.bg }]}
      />
    );
  }
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="bgGrad" x1="0" y1="0" x2="0.4" y2="1">
            <Stop offset="0" stopColor={t.glass.screenA} />
            <Stop offset="1" stopColor={t.glass.screenB} />
          </LinearGradient>
          {ORBS.map((o, i) => (
            <RadialGradient key={i} id={`orb${i}`} cx="50%" cy="50%" r="50%">
              <Stop
                offset="0"
                stopColor={t.glass.orbs[o.c]}
                stopOpacity={0.9}
              />
              <Stop offset="1" stopColor={t.glass.orbs[o.c]} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bgGrad)" />
        {ORBS.map((o, i) => (
          <Circle key={i} cx={o.cx} cy={o.cy} r={o.r} fill={`url(#orb${i})`} />
        ))}
      </Svg>
    </View>
  );
}

/**
 * Sits over the top safe-area (clock, battery, Dynamic Island) so scrolled content never
 * runs underneath the status row. Opaque in Solid, blurred in Glass.
 */
function StatusBarScrim() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  if (insets.top <= 0) return null;
  const fadeColor = t.isGlass ? t.glass.screenA : t.colors.bg;
  return (
    <>
      <View
        pointerEvents="none"
        style={[
          styles.scrim,
          { height: insets.top, backgroundColor: fadeColor },
        ]}
      >
        {t.isGlass ? (
          <BlurView
            style={styles.scrimBlur}
            blurType={t.glass.blurType}
            blurAmount={24}
            reducedTransparencyFallbackColor={fadeColor}
          />
        ) : null}
      </View>
      <EdgeFade
        direction="down"
        color={fadeColor}
        height={16}
        offset={insets.top}
      />
    </>
  );
}

type Props = {
  children: React.ReactNode;
  /** Set false for screens that manage their own list scrolling. */
  scroll?: boolean;
  /** Reserve room for the floating tab bar (tab screens). Default false. */
  tabBar?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Skip top safe-area padding (screens with their own native header). */
  noTopInset?: boolean;
  /** No horizontal or bottom padding: the child (a FlatList) pads itself. */
  flush?: boolean;
};

export function Screen({
  children,
  scroll = true,
  tabBar = false,
  contentStyle,
  noTopInset,
  flush,
}: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const top = noTopInset ? 8 : insets.top + 8;
  const padding: ViewStyle = flush
    ? { paddingTop: top }
    : {
        paddingTop: top,
        paddingHorizontal: 18,
        paddingBottom: tabBar ? clearance : Math.max(insets.bottom, 16) + 16,
      };

  return (
    <View style={[styles.root, { backgroundColor: t.colors.bg }]}>
      <ScreenBackground />
      {scroll ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[padding, contentStyle]}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, padding, contentStyle]}>{children}</View>
      )}
      {noTopInset ? null : <StatusBarScrim />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  scrimBlur: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
