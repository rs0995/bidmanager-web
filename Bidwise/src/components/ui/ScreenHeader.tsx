import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bell, ChevronLeft } from 'lucide-react-native';
import { fonts, useTheme } from '../../theme';
import { GlassBlur } from './GlassBlur';
import { Gradient } from './Gradient';

/** Square gradient tile with initials, used before the Dashboard title. */
export function InitialsTile({ initials }: { initials: string }) {
  const t = useTheme();
  return (
    <Gradient
      colors={[t.colors.accent, t.colors.accent2]}
      style={[styles.tile, t.shadow.sm]}
    >
      <Text style={[styles.initials, { color: t.colors.onAccent }]}>
        {initials}
      </Text>
    </Gradient>
  );
}

/** Round-rect icon button; used for the alerts bell (top right) and back. */
export function IconButton({
  children,
  onPress,
  label,
  badge,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  label: string;
  badge?: number;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        styles.iconBtn,
        { backgroundColor: t.isGlass ? t.glass.fill : t.colors.surface },
        t.isGlass && styles.glassBorder,
        t.isGlass && { borderColor: t.glass.border },
        t.shadow.sm,
      ]}
    >
      {/* The blur is clipped to the button's corners here; the button itself can't
          clip, or the badge would be cut off at the corner. */}
      {t.isGlass ? (
        <View style={styles.blurClip} pointerEvents="none">
          <GlassBlur amount={16} />
        </View>
      ) : null}
      {children}
      {badge ? (
        <View
          style={[
            styles.badge,
            { backgroundColor: t.colors.crit, borderColor: t.colors.surface },
          ]}
        >
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

type Props = {
  title: string;
  subtitle?: string;
  /** Initials tile before the title (Dashboard). */
  initials?: string;
  /** Show a back button before the title (pushed screens). */
  onBack?: () => void;
  /** Max lines for the title (long organisation names). Default 1. */
  titleLines?: number;
  /** Alerts bell at the top right. Pass unread count for the badge. */
  onBellPress?: () => void;
  unread?: number;
  right?: React.ReactNode;
};

export function ScreenHeader({
  title,
  subtitle,
  initials,
  onBack,
  titleLines = 1,
  onBellPress,
  unread,
  right,
}: Props) {
  const t = useTheme();
  return (
    <View style={styles.row}>
      {initials ? <InitialsTile initials={initials} /> : null}
      {onBack ? (
        <IconButton label="Back" onPress={onBack}>
          <ChevronLeft size={22} color={t.colors.ink} />
        </IconButton>
      ) : null}
      <View style={styles.text}>
        <Text
          numberOfLines={titleLines}
          style={[styles.title, { color: t.colors.ink }]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={1}
            style={[styles.subtitle, { color: t.colors.muted }]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {onBellPress ? (
        <IconButton label="Alerts" onPress={onBellPress} badge={unread}>
          <Bell size={20} color={t.colors.inkSoft} />
        </IconButton>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 6,
    marginBottom: 20,
  },
  text: { flex: 1 },
  title: { fontFamily: fonts.extrabold, fontSize: 21, letterSpacing: -0.4 },
  subtitle: { fontFamily: fonts.regular, fontSize: 12, marginTop: 1 },
  tile: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { fontFamily: fonts.extrabold, fontSize: 14, letterSpacing: -0.3 },
  glassBorder: { borderWidth: 1 },
  blurClip: {
    ...StyleSheet.absoluteFill,
    borderRadius: 13,
    overflow: 'hidden',
  },
  iconBtn: {
    overflow: 'visible',
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 5,
    right: 5,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 8.5 },
});
