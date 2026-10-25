import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import { Txt } from './Txt';

type Variant = 'default' | 'primary' | 'success' | 'danger' | 'ghost';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  busy?: boolean;
  disabled?: boolean;
  /** Stretch to the parent's width. */
  block?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Square bordered button with the desktop `Btn` variants. */
export function Button({
  label,
  onPress,
  variant = 'default',
  size = 'md',
  icon: Icon,
  busy,
  disabled,
  block,
  style,
}: Props) {
  const t = useTheme();
  const c = {
    default: { bg: t.colors.surface, fg: t.colors.ink, bd: t.colors.hair },
    primary: { bg: t.colors.accent, fg: t.colors.onAccent, bd: t.colors.accent },
    success: { bg: t.colors.ok, fg: t.colors.onAccent, bd: t.colors.ok },
    danger: { bg: t.colors.surface, fg: t.colors.bad, bd: t.colors.badLine },
    ghost: { bg: 'transparent', fg: t.colors.ink2, bd: 'transparent' },
  }[variant];
  const off = disabled || busy;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        {
          backgroundColor: c.bg,
          borderColor: c.bd,
          opacity: off ? 0.45 : pressed ? 0.7 : 1,
        },
        block && styles.block,
        style,
      ]}
    >
      <View style={styles.row}>
        {busy ? (
          <ActivityIndicator size="small" color={c.fg} />
        ) : Icon ? (
          <Icon size={14} color={c.fg} strokeWidth={2} />
        ) : null}
        <Txt
          style={[
            styles.text,
            { color: c.fg, fontSize: size === 'sm' ? 12 : 13 },
          ]}
        >
          {label}
        </Txt>
      </View>
    </Pressable>
  );
}

type IconButtonProps = {
  icon: LucideIcon;
  label: string;
  onPress?: () => void;
  /** danger: the desktop's danger button — red icon, red-tinted border. */
  tone?: 'default' | 'danger';
};

export function IconButton({
  icon: Icon,
  label,
  onPress,
  tone = 'default',
}: IconButtonProps) {
  const danger = tone === 'danger';
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.icon,
        {
          backgroundColor: t.colors.surface,
          borderColor: danger ? t.colors.badLine : t.colors.hair,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Icon size={16} color={danger ? t.colors.bad : t.colors.ink} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  md: { height: 40, paddingHorizontal: 14 },
  sm: { height: 32, paddingHorizontal: 10 },
  block: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { fontFamily: fonts.medium },
  icon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
