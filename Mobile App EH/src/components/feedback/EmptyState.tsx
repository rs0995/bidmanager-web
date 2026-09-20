import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fonts, useTheme } from '../../theme';
import { Button } from '../ui/Button';

type Props = {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: Props) {
  const t = useTheme();
  return (
    <View style={styles.wrap}>
      {icon ? (
        <View style={[styles.icon, { backgroundColor: t.colors.accentWash }]}>
          {icon}
        </View>
      ) : null}
      <Text style={[styles.title, { color: t.colors.ink }]}>{title}</Text>
      {description ? (
        <Text style={[styles.desc, { color: t.colors.muted }]}>
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <Button
            label={actionLabel}
            onPress={onAction}
            size="sm"
            variant="secondary"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: 36,
    paddingHorizontal: 24,
    gap: 6,
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: { fontFamily: fonts.bold, fontSize: 15, textAlign: 'center' },
  desc: {
    fontFamily: fonts.regular,
    fontSize: 12.5,
    textAlign: 'center',
    lineHeight: 18,
  },
  action: { marginTop: 10 },
});
