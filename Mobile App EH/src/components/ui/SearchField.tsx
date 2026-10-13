import React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import { GlassBlur } from './GlassBlur';

type Props = {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
};

export function SearchField({
  value,
  onChangeText,
  placeholder = 'Search',
}: Props) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: t.isGlass ? t.glass.fill : t.colors.surfaceSoft,
          borderColor: t.isGlass ? t.glass.border : t.colors.hair,
        },
      ]}
    >
      <GlassBlur amount={18} />
      <Search size={18} color={t.colors.muted} />
      <TextInput
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.colors.muted}
        autoCorrect={false}
        style={[styles.input, { color: t.colors.ink }]}
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={8}
          onPress={() => onChangeText('')}
        >
          <X size={15} color={t.colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    paddingVertical: 0,
  },
});
