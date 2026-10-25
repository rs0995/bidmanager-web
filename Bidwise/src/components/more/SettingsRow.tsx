import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '../ui/Card';
import { fonts, useTheme } from '../../theme';

/** Titled group of settings rows on one card. */
export function SettingsSection({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={styles.section}>
      {title ? (
        <Text style={[styles.sectionTitle, { color: t.colors.muted }]}>
          {title}
        </Text>
      ) : null}
      <Card padding={4} radius="lg" elevation="sm">
        {children}
      </Card>
    </View>
  );
}

export function SettingsRow({
  icon,
  title,
  sub,
  value,
  right,
  onPress,
  disabled,
  last,
  below,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  sub?: string;
  /** Short status on the right ("4 min ago", "2 in progress"). */
  value?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  last?: boolean;
  below?: React.ReactNode;
  tone?: 'danger';
}) {
  const t = useTheme();
  const body = (
    <View
      style={[
        styles.row,
        !last && { borderBottomWidth: 1, borderBottomColor: t.colors.hair },
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.top}>
        <View
          style={[
            styles.icon,
            {
              backgroundColor:
                tone === 'danger' ? t.colors.critWash : t.colors.accentWash,
            },
          ]}
        >
          {icon}
        </View>
        <View style={styles.text}>
          <Text
            style={[
              styles.title,
              { color: tone === 'danger' ? t.colors.crit : t.colors.ink },
            ]}
          >
            {title}
          </Text>
          {sub ? (
            <Text style={[styles.sub, { color: t.colors.muted }]}>{sub}</Text>
          ) : null}
        </View>
        {value ? (
          <Text style={[styles.value, { color: t.colors.muted }]}>{value}</Text>
        ) : null}
        {right}
      </View>
      {below}
    </View>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
    >
      {body}
    </Pressable>
  ) : (
    body
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 18 },
  sectionTitle: {
    fontFamily: fonts.medium,
    fontSize: 12,
    marginBottom: 8,
    marginLeft: 4,
  },
  row: { paddingVertical: 12, paddingHorizontal: 12 },
  disabled: { opacity: 0.5 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
  title: { fontFamily: fonts.medium, fontSize: 13.5 },
  sub: {
    fontFamily: fonts.regular,
    fontSize: 11.5,
    marginTop: 2,
    lineHeight: 16,
  },
  value: { fontFamily: fonts.regular, fontSize: 12 },
});
