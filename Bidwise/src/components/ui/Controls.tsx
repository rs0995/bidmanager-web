import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  LayoutChangeEvent,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { Check, Search, SlidersHorizontal } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import { GlassBlur } from './GlassBlur';
import { useReducedMotion } from './motion';

/** Small uppercase label above a heading ("YOUR NEXT OPPORTUNITY"). */
export function Kicker({ children }: { children: string }) {
  const t = useTheme();
  return (
    <Text style={[styles.kicker, { color: t.colors.muted }]}>{children}</Text>
  );
}

/** Space Grotesk page title. */
export function PageTitle({
  children,
  sub,
  right,
}: {
  children: string;
  sub?: string;
  right?: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={styles.titleRow}>
      <View style={styles.flex}>
        <Text style={[styles.title, { color: t.colors.ink }]}>{children}</Text>
        {sub ? (
          <Text style={[styles.sub, { color: t.colors.muted }]}>{sub}</Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/** Surface colours shared by inputs, chips and small controls. */
export function useSurface() {
  const t = useTheme();
  return {
    backgroundColor: t.isGlass ? t.glass.fill : t.colors.surface,
    borderColor: t.isGlass ? t.glass.border : t.colors.hair,
  };
}

export function Chip({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: React.ReactNode;
}) {
  const t = useTheme();
  const surface = useSurface();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={[
        styles.chip,
        surface,
        active && {
          backgroundColor: t.colors.accentWash,
          borderColor: t.colors.edge,
        },
      ]}
    >
      {icon}
      <Text
        style={[
          styles.chipText,
          { color: active ? t.colors.accentInk : t.colors.inkSoft },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Two or three equal segments (Organisations | Tenders, All | Unread, Light | Dark).
 * The highlight slides to the chosen segment.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  /** `icon` draws a leading icon in the segment's text colour. */
  options: {
    value: T;
    label: string;
    icon?: (color: string) => React.ReactNode;
  }[];
  value: T;
  onChange: (v: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const surface = useSurface();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    options.findIndex(o => o.value === value),
  );
  const pos = useRef(new Animated.Value(index)).current;

  useEffect(() => {
    if (reduced) {
      pos.setValue(index);
      return;
    }
    Animated.spring(pos, {
      toValue: index,
      useNativeDriver: true,
      speed: 18,
      bounciness: 5,
    }).start();
  }, [index, pos, reduced]);

  const segW = width > 0 ? (width - SEG_PAD * 2) / options.length : 0;
  const onLayout = (e: LayoutChangeEvent) =>
    setWidth(e.nativeEvent.layout.width);

  return (
    <View
      accessibilityRole="tablist"
      onLayout={onLayout}
      style={[styles.seg, surface, style]}
    >
      <GlassBlur amount={14} />
      {segW > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.segThumb,
            {
              width: segW,
              backgroundColor: t.isGlass
                ? t.glass.fillStrong
                : t.colors.accentWash,
              transform: [
                {
                  translateX: pos.interpolate({
                    inputRange: [0, Math.max(1, options.length - 1)],
                    outputRange: [0, segW * Math.max(1, options.length - 1)],
                  }),
                },
              ],
            },
          ]}
        />
      ) : null}
      {options.map(o => {
        const on = o.value === value;
        const color = on ? t.colors.accentInk : t.colors.muted;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segItem, o.icon && styles.segIconItem]}
          >
            {o.icon?.(color)}
            <Text
              style={[
                styles.segText,
                { color: on ? t.colors.accentInk : t.colors.muted },
                on && { fontFamily: fonts.semibold },
              ]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const SEG_PAD = 4;

/** Large, easy-to-hit checkbox (the tap area is 44pt even when drawn at 22). */
export function Checkbox({
  checked,
  onPress,
  label,
  size = 22,
}: {
  checked: boolean;
  onPress?: () => void;
  label: string;
  size?: number;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={11}
      style={[
        styles.box,
        {
          width: size,
          height: size,
          borderRadius: size * 0.3,
          borderColor: checked ? t.colors.accent : t.colors.muted,
          backgroundColor: checked ? t.colors.accent : 'transparent',
        },
      ]}
    >
      {checked ? (
        <Check size={size * 0.7} color={t.colors.onAccent} strokeWidth={3} />
      ) : null}
    </Pressable>
  );
}

export function SearchField({
  value,
  onChangeText,
  placeholder,
  onFilter,
  leading,
  trailing,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  onFilter?: () => void;
  /** Shown before the box (the Tenders tab's bookmarked-only square). */
  leading?: React.ReactNode;
  /** Shown after the box (a sort button). */
  trailing?: React.ReactNode;
}) {
  const t = useTheme();
  const surface = useSurface();
  return (
    <View style={styles.searchRow}>
      {leading}
      <View style={[styles.search, surface]}>
        <GlassBlur amount={14} />
        <Search size={17} color={t.colors.muted} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={t.colors.muted}
          style={[styles.searchInput, { color: t.colors.ink }]}
          returnKeyType="search"
          accessibilityLabel={placeholder}
        />
      </View>
      {onFilter ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filters"
          onPress={onFilter}
          style={[styles.filterBtn, surface]}
        >
          <SlidersHorizontal size={18} color={t.colors.ink} />
        </Pressable>
      ) : null}
      {trailing}
    </View>
  );
}

/**
 * Square on/off button the height of the search box, as BM Pro's bookmarked-only star:
 * accent border and wash when on.
 */
export function SquareToggle({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon: React.ReactNode;
}) {
  const t = useTheme();
  const surface = useSurface();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.filterBtn,
        surface,
        active && {
          backgroundColor: t.colors.accentWash,
          borderColor: t.colors.accent,
        },
      ]}
    >
      {icon}
    </Pressable>
  );
}

/** Labelled input with a leading icon (sign-in form). */
export function Field({
  label,
  icon,
  right,
  ...input
}: TextInputProps & {
  label: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
}) {
  const t = useTheme();
  const surface = useSurface();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: t.colors.muted }]}>
        {label}
      </Text>
      <View style={[styles.input, surface]}>
        <GlassBlur amount={14} />
        {icon}
        <TextInput
          placeholderTextColor={t.colors.muted}
          style={[styles.inputText, { color: t.colors.ink }]}
          accessibilityLabel={label}
          {...input}
        />
        {right}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  kicker: {
    fontFamily: fonts.medium,
    fontSize: 10,
    letterSpacing: 1.7,
    marginBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    marginBottom: 16,
  },
  title: {
    fontFamily: fonts.displaySemibold,
    fontSize: 29,
    letterSpacing: -1.2,
    lineHeight: 34,
  },
  sub: { fontFamily: fonts.regular, fontSize: 12, marginTop: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
  },
  chipText: { fontFamily: fonts.medium, fontSize: 12 },
  seg: {
    flexDirection: 'row',
    padding: SEG_PAD,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  segThumb: {
    position: 'absolute',
    top: SEG_PAD,
    left: SEG_PAD,
    height: 36,
    borderRadius: 12,
  },
  segItem: {
    flex: 1,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segIconItem: { flexDirection: 'row', gap: 6 },
  segText: { fontFamily: fonts.medium, fontSize: 13 },
  box: { borderWidth: 1.6, alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', gap: 10 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 13,
    paddingVertical: 0,
  },
  filterBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: { marginTop: 16 },
  fieldLabel: { fontFamily: fonts.regular, fontSize: 11, marginBottom: 8 },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 50,
    paddingHorizontal: 14,
    borderRadius: 13,
    borderWidth: 1,
    overflow: 'hidden',
  },
  inputText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    paddingVertical: 0,
  },
});
