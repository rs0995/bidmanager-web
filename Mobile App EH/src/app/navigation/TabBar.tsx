import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from '@react-native-community/blur';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Bell, FileText, FolderOpen, House, Menu } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gradient } from '../../components/ui/Gradient';
import { useAlerts } from '../../fixtures/alerts';
import { fonts, useTheme } from '../../theme';

import { TAB_BAR_HEIGHT as TAB_ROW_HEIGHT } from '../../components/ui/Screen';

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
    borderTopColor: glass ? t.glass.border : t.colors.hair,
  };

  // Docked: the bar is fixed to the bottom edge and spans the full width (the home
  // indicator area sits inside it). Content scrolls independently behind it.
  return (
    <>
      <View pointerEvents="box-none" style={styles.wrap}>
        <View
          style={[
            styles.bar,
            barSurface,
            {
              height: TAB_ROW_HEIGHT + insets.bottom,
              paddingBottom: insets.bottom,
            },
          ]}
        >
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
                <View style={styles.slot}>
                  {focused ? (
                    <Gradient
                      colors={[t.colors.accent, t.colors.accent2]}
                      style={styles.pillBg}
                    />
                  ) : null}
                  <View style={styles.iconBox}>
                    <Icon
                      size={20}
                      color={focused ? t.colors.onAccent : t.colors.muted}
                      strokeWidth={focused ? 2.2 : 2}
                    />
                    {name === 'Alerts' && unread > 0 ? (
                      <View
                        accessibilityLabel={`${unread} unread alerts`}
                        style={[
                          styles.badge,
                          {
                            backgroundColor: t.colors.crit,
                            borderColor: glass
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
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Narrow highlight behind the active icon; the badge is anchored to the icon itself.
  slot: {
    width: 52,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillBg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
  },
  iconBox: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -8,
    right: -10,
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
