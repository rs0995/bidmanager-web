import React, { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

type Props = {
  /** `down`: solid at the top, transparent at the bottom (under the status bar).
   *  `up`: transparent at the top, solid at the bottom (behind the tab bar). */
  direction: 'down' | 'up';
  color: string;
  height: number;
  /** Opacity at the solid end. Default 1. */
  strength?: number;
  /** Distance from the screen edge, for a fade that starts below a solid inset. */
  offset?: number;
};

/** Vertical colour fade that hides scrolled content near a screen edge. */
export function EdgeFade({
  direction,
  color,
  height,
  strength = 1,
  offset = 0,
}: Props) {
  const id = `f${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const solid = strength;
  const [top, bottom] = direction === 'down' ? [solid, 0] : [0, solid];
  return (
    <View
      pointerEvents="none"
      style={[
        styles.base,
        direction === 'down' ? { top: offset } : { bottom: offset },
        { height },
      ]}
    >
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={top} />
            <Stop offset="1" stopColor={color} stopOpacity={bottom} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { position: 'absolute', left: 0, right: 0 },
});
