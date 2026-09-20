import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import { Gradient } from './Gradient';

type Props = {
  /** 0 to 1. */
  progress: number;
  height?: number;
  colors?: [string, string];
};

export function ProgressBar({ progress, height = 6, colors }: Props) {
  const t = useTheme();
  const pct = `${Math.max(0, Math.min(1, progress)) * 100}%` as `${number}%`;
  return (
    <View
      style={[
        styles.track,
        { height, backgroundColor: t.colors.surfaceSunk, borderRadius: height },
      ]}
    >
      <Gradient
        colors={colors ?? [t.colors.accent, t.colors.accent2]}
        style={{ width: pct, height, borderRadius: height }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { overflow: 'hidden' },
});
