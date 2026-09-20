import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fonts, useTheme } from '../../theme';
import { GlassBlur } from './GlassBlur';
import { Gradient } from './Gradient';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
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
    variant === 'primary'
      ? t.colors.onAccent
      : variant === 'danger'
      ? t.colors.crit
      : variant === 'ghost'
      ? t.colors.accentInk
      : t.colors.ink;

  const content = (
    <View style={[styles.row, size === 'sm' ? styles.rowSm : styles.rowMd]}>
      {loading ? <ActivityIndicator size="small" color={fg} /> : icon}
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
  const glassSecondary = t.isGlass && variant === 'secondary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        block ? styles.block : styles.auto,
        { opacity: inactive ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {variant === 'primary' ? (
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
  label: { fontFamily: fonts.bold },
  block: { alignSelf: 'stretch' },
  auto: { alignSelf: 'flex-start' },
});
