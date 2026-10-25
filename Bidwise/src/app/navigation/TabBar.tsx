import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BlurView } from '@react-native-community/blur';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Bell, Files, Folder, LayoutGrid, Menu } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_HEIGHT } from '../../components/ui/Screen';
import { useReducedMotion } from '../../components/ui/motion';
import { useAlerts } from '../../fixtures/alerts';
import { fonts, useTheme } from '../../theme';

const ICONS = {
  Dashboard: LayoutGrid,
  Tenders: Files,
  Projects: Folder,
  Alerts: Bell,
  More: Menu,
} as const;

const LABELS = {
  Dashboard: 'Overview',
  Tenders: 'Tenders',
  Projects: 'Projects',
  Alerts: 'Alerts',
  More: 'More',
} as const;

const PAD = 7;
const GAP = 3;

/**
 * Icon-only floating island spanning the full width, with a slim side margin. The
 * highlight behind the current tab slides to the tab you pick.
 */
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const t = useTheme();
  const { unread } = useAlerts();
  const insets = useSafeAreaInsets();
  const glass = t.isGlass;
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const pos = useRef(new Animated.Value(state.index)).current;
  useEffect(() => {
    if (reduced) {
      pos.setValue(state.index);
      return;
    }
    Animated.spring(pos, {
      toValue: state.index,
      useNativeDriver: true,
      speed: 20,
      bounciness: 4,
    }).start();
  }, [state.index, pos, reduced]);
  const count = state.routes.length;
  // The island has a 1pt border: the tabs share the width inside it.
  const tabW =
    width > 0 ? (width - 2 - PAD * 2 - GAP * (count - 1)) / count : 0;
  const onLayout = (e: LayoutChangeEvent) =>
    setWidth(e.nativeEvent.layout.width);
  const surface = {
    backgroundColor: glass ? t.glass.fillStrong : t.colors.surface,
    borderColor: glass ? t.glass.border : t.colors.hair,
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: Math.max(insets.bottom - 8, 10) }]}
    >
      <View
        onLayout={onLayout}
        style={[
          styles.island,
          surface,
          { height: TAB_BAR_HEIGHT },
          t.shadow.md,
        ]}
      >
        {glass ? (
          <View style={styles.clip}>
            <BlurView
              style={StyleSheet.absoluteFill}
              blurType={t.glass.blurType}
              blurAmount={20}
              reducedTransparencyFallbackColor={t.colors.bg}
            />
          </View>
        ) : null}
        {tabW > 0 ? (
          <View pointerEvents="none" style={styles.track}>
            <Animated.View
              style={[
                styles.highlight,
                {
                  width: tabW,
                  backgroundColor: glass
                    ? `${t.colors.accent}1f`
                    : t.colors.accentWash,
                  transform: [
                    {
                      translateX: pos.interpolate({
                        inputRange: [0, Math.max(1, count - 1)],
                        outputRange: [0, (tabW + GAP) * Math.max(1, count - 1)],
                      }),
                    },
                  ],
                },
              ]}
            />
          </View>
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
              <Icon
                size={21}
                color={focused ? t.colors.accent : t.colors.muted}
                strokeWidth={1.8}
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
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 10, right: 10 },
  island: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GAP,
    paddingHorizontal: PAD,
    borderRadius: 27,
    borderWidth: 1,
  },
  clip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 27,
    overflow: 'hidden',
    zIndex: -1,
  },
  track: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: PAD,
    right: PAD,
    justifyContent: 'center',
  },
  highlight: { height: 46, borderRadius: 19 },
  tab: {
    flex: 1,
    height: 46,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 6,
    left: '54%',
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#ffffff', fontFamily: fonts.bold, fontSize: 8.5 },
});
