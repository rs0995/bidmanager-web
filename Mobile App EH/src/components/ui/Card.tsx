import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from '@react-native-community/blur';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../../theme';

type Props = {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Corner radius token. Default `lg` (22). */
  radius?: 'md' | 'lg' | 'xl';
  /** Inner padding in px. Default 16. */
  padding?: number;
  /** Shadow depth. Default `md`. */
  elevation?: 'sm' | 'md';
  /** Glass only: use the stronger fill (tab bar, sheets). */
  strong?: boolean;
};

/** Soft specular highlight across the top of a glass surface. */
function GlassSheen({ dark }: { dark: boolean }) {
  return (
    <View pointerEvents="none" style={styles.sheen}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="sheen" x1="0" y1="0" x2="0.35" y2="1">
            <Stop
              offset="0"
              stopColor="#ffffff"
              stopOpacity={dark ? 0.12 : 0.42}
            />
            <Stop
              offset="0.5"
              stopColor="#ffffff"
              stopOpacity={dark ? 0.03 : 0.1}
            />
            <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#sheen)" />
      </Svg>
    </View>
  );
}

// Solid style: opaque surface + soft shadow.
// Glass style: translucent fill, backdrop blur, specular sheen, bright top edge.
export function Card({
  children,
  style,
  radius = 'lg',
  padding = 16,
  elevation = 'md',
  strong,
}: Props) {
  const t = useTheme();
  const base: ViewStyle = { borderRadius: t.radius[radius], padding };

  if (!t.isGlass) {
    return (
      <View
        style={[
          base,
          { backgroundColor: t.colors.surface },
          t.shadow[elevation],
          style,
        ]}
      >
        {children}
      </View>
    );
  }

  const glassSurface: ViewStyle = {
    backgroundColor: strong ? t.glass.fillStrong : t.glass.fill,
    borderWidth: 1,
    borderColor: t.glass.border,
    borderTopColor: t.glass.edge,
    borderLeftColor: t.glass.edge,
    overflow: 'hidden',
  };
  return (
    <View style={[base, glassSurface, t.shadow[elevation], style]}>
      <BlurView
        style={styles.fill}
        blurType={t.glass.blurType}
        blurAmount={22}
        reducedTransparencyFallbackColor={t.colors.bg}
      />
      <GlassSheen dark={t.scheme === 'dark'} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
