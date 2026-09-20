import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from '@react-native-community/blur';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Bell, FileText, FolderOpen, House, Menu } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EdgeFade } from '../../components/ui/EdgeFade';
import { Gradient } from '../../components/ui/Gradient';
import { useAlerts } from '../../fixtures/alerts';
import { fonts, useTheme } from '../../theme';

const ICONS = {
  Dashboard: House,
  Tenders: FileText,
  Projects: FolderOpen,
  Alerts: Bell,
  More: Menu,
} as const;

const LABELS = {
  Dashboard: 'Dashboard',
  Tenders: 'Tenders',
  Projects: 'Projects',
  Alerts: 'Alerts',
  More: 'More',
} as const;

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const t = useTheme();
  const { unread } = useAlerts();
  const insets = useSafeAreaInsets();
  const glass = t.isGlass;
  const barSurface = {
    backgroundColor: glass ? t.glass.fillStrong : t.colors.surface,
    borderColor: glass ? t.glass.border : 'transparent',
    borderWidth: glass ? StyleSheet.hairlineWidth * 2 : 0,
  };

  const bottomInset = Math.max(insets.bottom, 12);
  const fadeColor = glass ? t.glass.screenB : t.colors.bg;

  // The bar is fixed to the bottom of the screen and never scrolls; content scrolls
  // independently behind it and fades out before reaching it.
  return (
    <>
      <EdgeFade
        direction="up"
        color={fadeColor}
        height={62 + bottomInset + 34}
        strength={glass ? 0.85 : 0.97}
      />
      <View
        pointerEvents="box-none"
        style={[styles.wrap, { paddingBottom: bottomInset }]}
      >
        <View style={[styles.bar, barSurface, t.shadow.md]}>
          {glass ? (
            <BlurView
              style={StyleSheet.absoluteFill}
              blurType={t.glass.blurType}
              blurAmount={20}
              reducedTransparencyFallbackColor={t.colors.bg}
            />
          ) : null}
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const name = route.name as keyof typeof ICONS;
            const Icon = ICONS[name];
            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented)
                navigation.navigate(route.name);
            };
            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityLabel={LABELS[name]}
                accessibilityState={{ selected: focused }}
                onPress={onPress}
                style={styles.tab}
              >
                {focused ? (
                  <Gradient
                    colors={[t.colors.accent, t.colors.accent2]}
                    style={styles.pill}
                  >
                    <Icon
                      size={20}
                      color={t.colors.onAccent}
                      strokeWidth={2.2}
                    />
                  </Gradient>
                ) : (
                  <View style={styles.pill}>
                    <Icon size={20} color={t.colors.muted} strokeWidth={2} />
                  </View>
                )}
                {name === 'Alerts' && unread > 0 ? (
                  <View
                    accessibilityLabel={`${unread} unread alerts`}
                    style={[
                      styles.badge,
                      {
                        backgroundColor: t.colors.crit,
                        borderColor: t.isGlass
                          ? t.glass.fillStrong
                          : t.colors.surface,
                      },
                    ]}
                  >
                    <Text style={styles.badgeText}>
                      {unread > 9 ? '9+' : unread}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, bottom: 0 },
  bar: {
    height: 62,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 2,
    right: 6,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#ffffff', fontFamily: fonts.extrabold, fontSize: 8.5 },
  pill: {
    height: 46,
    alignSelf: 'stretch',
    marginHorizontal: 2,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
