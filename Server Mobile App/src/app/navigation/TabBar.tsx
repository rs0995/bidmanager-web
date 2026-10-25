import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Activity, Layers, Menu, Radar, Users } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge, TAB_BAR_HEIGHT, Txt } from '../../components/ui';
import { useSession } from '../../state/session';
import { fonts, useTheme } from '../../theme';

const ICONS = {
  Server: Activity,
  Jobs: Layers,
  Users: Users,
  Scraper: Radar,
  More: Menu,
} as const;

// The desktop nav rail turned into a docked bottom bar: white with a top rule;
// the selected tab sits on paper with an indigo marker and an indigo icon.
// Captchas live under More, so More carries the waiting-captcha badge.
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { pendingCaptchas } = useSession();

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View
        style={[
          styles.bar,
          {
            height: TAB_BAR_HEIGHT + insets.bottom,
            paddingBottom: insets.bottom,
            backgroundColor: t.colors.surface,
            borderTopColor: t.colors.hair,
          },
        ]}
      >
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
              accessibilityLabel={name}
              accessibilityState={{ selected: focused }}
              onPress={onPress}
              style={[
                styles.tab,
                {
                  backgroundColor: focused ? t.colors.bg : 'transparent',
                  borderTopColor: focused ? t.colors.accent : 'transparent',
                },
              ]}
            >
              <View>
                <Icon
                  size={19}
                  color={focused ? t.colors.accent : t.colors.ink3}
                  strokeWidth={2}
                />
                {name === 'More' && pendingCaptchas > 0 ? (
                  <View style={styles.badge}>
                    <Badge count={pendingCaptchas} />
                  </View>
                ) : null}
              </View>
              <Txt
                style={[
                  styles.label,
                  focused
                    ? { color: t.colors.ink, fontFamily: fonts.semibold }
                    : { color: t.colors.ink2, fontFamily: fonts.regular },
                ]}
              >
                {name}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bar: { flexDirection: 'row', borderTopWidth: 1 },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderTopWidth: 2,
    marginTop: -1,
  },
  badge: { position: 'absolute', top: -5, right: -14 },
  label: { fontSize: 11 },
});
