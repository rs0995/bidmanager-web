import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fonts, useTheme } from '../../theme';
import { GlassBlur } from './GlassBlur';
import { Gradient } from './Gradient';
import { Spinning, usePressScale } from './motion';

type Props = {
  label: string;
  onPress?: () => void;
  /** `solid`: flat accent fill. `outline`: white with an accent border. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'solid' | 'outline';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  /** Stretch to the full width of the parent. */
  block?: boolean;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  disabled,
  block,
}: Props) {
  const t = useTheme();
  const fg =
    variant === 'primary' || variant === 'solid'
      ? t.colors.onAccent
      : variant === 'outline'
      ? t.colors.accentInk
      : variant === 'danger'
      ? t.colors.crit
      : variant === 'ghost'
      ? t.colors.accentInk
      : t.colors.ink;

  const content = (
    <View style={[styles.row, size === 'sm' ? styles.rowSm : styles.rowMd]}>
      {/* With an icon, loading spins that icon in place so the button keeps its size
          (swapping in the wider spinner made it grow, then shrink back). */}
      {icon ? (
        <Spinning spinning={!!loading}>{icon}</Spinning>
      ) : loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : null}
      <Text
        style={[
          styles.label,
          size === 'sm' ? styles.labelSm : styles.labelMd,
          { color: fg },
        ]}
      >
        {label}
      </Text>
    </View>
  );

  const shape = { borderRadius: size === 'sm' ? 12 : 16 };
  const inactive = disabled || loading;
  // Glass: the same soft edge every glass surface uses, not the accent — the accent
  // border is a Solid-only way of marking the unchecked state.
  const outlineColors = {
    backgroundColor: t.isGlass
      ? t.glass.fill
      : t.scheme === 'dark'
      ? t.colors.surfaceSoft
      : '#ffffff',
    borderColor: t.isGlass ? t.glass.border : t.colors.accent,
  };
  const glassSecondary = t.isGlass && variant === 'secondary';
  // Pressed-down feel; small buttons (Sync now) sink half as far.
  const press = usePressScale(size === 'sm' ? 0.98 : 0.96);
  const { release } = press;
  useEffect(() => {
    if (inactive) release();
  }, [inactive, release]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive }}
      disabled={inactive}
      onPress={onPress}
      {...press.handlers}
      style={({ pressed }) => [
        block ? styles.block : styles.auto,
        { opacity: inactive ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      <Animated.View style={press.style}>
        {variant === 'solid' ? (
          <View
            style={[shape, { backgroundColor: t.colors.accent }, t.shadow.sm]}
          >
            {content}
          </View>
        ) : variant === 'outline' ? (
          <View
            style={[
              shape,
              styles.outline,
              styles.clip,
              outlineColors,
              t.shadow.sm,
            ]}
          >
            {t.isGlass ? <GlassBlur amount={16} /> : null}
            {content}
          </View>
        ) : variant === 'primary' ? (
          <Gradient colors={[t.colors.accent, t.colors.accent2]} style={shape}>
            {content}
          </Gradient>
        ) : (
          <View
            style={[
              shape,
              variant === 'ghost'
                ? styles.transparent
                : variant === 'danger'
                ? { backgroundColor: t.colors.critWash }
                : {
                    backgroundColor: t.isGlass
                      ? t.glass.fillStrong
                      : t.colors.surface,
                  },
              glassSecondary && [
                styles.clip,
                { borderWidth: 1, borderColor: t.glass.border },
              ],
              variant === 'secondary' && t.shadow.sm,
            ]}
          >
            {glassSecondary ? <GlassBlur amount={18} /> : null}
            {content}
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  rowSm: { height: 36, paddingHorizontal: 14 },
  rowMd: { height: 48, paddingHorizontal: 20 },
  labelSm: { fontSize: 12.5 },
  labelMd: { fontSize: 14 },
  transparent: { backgroundColor: 'transparent' },
  clip: { overflow: 'hidden' },
  outline: { borderWidth: 1.5 },
  label: { fontFamily: fonts.bold },
  block: { alignSelf: 'stretch' },
  auto: { alignSelf: 'flex-start' },
});
