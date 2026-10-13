import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import { fonts, useTheme } from '../../theme';

type Props = Omit<TextInputProps, 'style'> & {
  label?: string;
  error?: string;
  hint?: string;
};

export function Field({ label, error, hint, ...input }: Props) {
  const t = useTheme();
  return (
    <View style={styles.wrap}>
      {label ? (
        <Text style={[styles.label, { color: t.colors.inkSoft }]}>{label}</Text>
      ) : null}
      <TextInput
        placeholderTextColor={t.colors.muted}
        accessibilityLabel={label}
        {...input}
        style={[
          styles.input,
          {
            color: t.colors.ink,
            backgroundColor: t.colors.surfaceSunk,
            borderColor: error ? t.colors.crit : t.colors.hair,
          },
        ]}
      />
      {error ? (
        <Text style={[styles.note, { color: t.colors.crit }]}>{error}</Text>
      ) : hint ? (
        <Text style={[styles.note, { color: t.colors.muted }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontFamily: fonts.semibold, fontSize: 12 },
  input: {
    fontFamily: fonts.medium,
    fontSize: 14,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  note: { fontFamily: fonts.medium, fontSize: 11.5 },
});
