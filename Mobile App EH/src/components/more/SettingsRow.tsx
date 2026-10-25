import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, LucideIcon } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';

type Props = {
  icon: LucideIcon;
  label: string;
  /** Second line under the label. */
  sub?: string;
  /** Muted text on the right. */
  value?: string;
  onPress?: () => void;
  /** Custom right-hand control (e.g. a Toggle). Replaces the chevron. */
  right?: React.ReactNode;
  /** Draw a divider under the row. */
  divider?: boolean;
  accessibilityLabel?: string;
};

/** One row of a settings group: icon chip, label, optional value, chevron or control. */
export function SettingsRow({
  icon: Icon,
  label,
  sub,
  value,
  onPress,
  right,
  divider,
  accessibilityLabel,
}: Props) {
  const t = useTheme();
  const body = (
    <View
      style={[
        styles.row,
        divider && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: t.colors.hair,
        },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: t.colors.accentWash }]}>
        <Icon size={16} color={t.colors.accentInk} />
      </View>
      <View style={styles.text}>
        <Text style={[styles.label, { color: t.colors.ink }]}>{label}</Text>
        {sub ? (
          <Text style={[styles.sub, { color: t.colors.muted }]}>{sub}</Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[styles.value, { color: t.colors.muted }]}>{value}</Text>
      ) : null}
      {right ??
        (onPress ? <ChevronRight size={16} color={t.colors.muted} /> : null)}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0 },
  label: { fontFamily: fonts.semibold, fontSize: 14 },
  sub: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 2,
  },
  value: { fontFamily: fonts.medium, fontSize: 12.5 },
});
