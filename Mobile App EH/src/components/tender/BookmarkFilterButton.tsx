import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Bookmark, Star } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { GlassBlur } from '../ui/GlassBlur';

type Props = {
  /** `star` filters tenders, `ribbon` filters organisations. */
  kind: 'star' | 'ribbon';
  active: boolean;
  onPress: () => void;
};

/** Square toggle placed before the search field: show only bookmarked items. */
export function BookmarkFilterButton({ kind, active, onPress }: Props) {
  const t = useTheme();
  const Icon = kind === 'star' ? Star : Bookmark;
  const label =
    kind === 'star'
      ? 'Show bookmarked tenders only'
      : 'Show bookmarked organisations only';
  const surface = {
    backgroundColor: active
      ? t.colors.accentWash
      : t.isGlass
      ? t.glass.fill
      : t.colors.surface,
    borderColor: active
      ? t.colors.accent
      : t.isGlass
      ? t.glass.border
      : 'transparent',
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.btn, surface, t.shadow.sm]}
    >
      {active ? null : <GlassBlur amount={16} />}
      <Icon
        size={20}
        color={t.colors.accent}
        fill={active ? t.colors.accent : 'transparent'}
        strokeWidth={2}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
