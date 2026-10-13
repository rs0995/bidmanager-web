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
  // Neutral field look (matches the search box) until switched on, then solid accent.
  const surface = {
    backgroundColor: active
      ? t.colors.accent
      : t.isGlass
      ? t.glass.fill
      : t.colors.surfaceSoft,
    borderColor: active
      ? t.colors.accent
      : t.isGlass
      ? t.glass.border
      : t.colors.hair,
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.btn, surface]}
    >
      {active ? null : <GlassBlur amount={16} />}
      <Icon
        size={20}
        color={active ? t.colors.onAccent : t.colors.muted}
        fill={active ? t.colors.onAccent : 'transparent'}
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
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
