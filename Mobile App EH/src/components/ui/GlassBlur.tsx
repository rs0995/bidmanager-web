import React from 'react';
import { StyleSheet } from 'react-native';
import { BlurView } from '@react-native-community/blur';
import { useTheme } from '../../theme';

/**
 * Backdrop blur layer for glass surfaces. Renders nothing in Solid style. The parent must
 * clip it (`overflow: 'hidden'` and a border radius) so the blur follows the corners.
 */
export function GlassBlur({ amount = 20 }: { amount?: number }) {
  const t = useTheme();
  if (!t.isGlass) return null;
  return (
    <BlurView
      style={styles.fill}
      blurType={t.glass.blurType}
      blurAmount={amount}
      reducedTransparencyFallbackColor={t.colors.bg}
    />
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
