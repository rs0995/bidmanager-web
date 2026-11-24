import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { BlurView } from '@react-native-community/blur';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Files, Folder, LayoutGrid, Menu, Sparkles } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_HEIGHT } from '../../components/ui/Screen';
import { useReducedMotion } from '../../components/ui/motion';
import { useBidAgent } from '../../data/bidAgent';
import { useAccess } from '../../lib/account';
import { useTheme } from '../../theme';

const ICONS = {
  Dashboard: LayoutGrid,
  Tenders: Files,
  Projects: Folder,
  More: Menu,
} as const;

const LABELS = {
  Dashboard: 'Overview',
  Tenders: 'Tenders',
  Projects: 'Projects',
  More: 'More',
} as const;

const PAD = 7;
const GAP = 3;
/** The centre Bid Agent button: its slot in the bar and the raised circle. */
const CENTER_W = 64;
const CENTER_SIZE = 56;
const RING = 4;

/**
 * Icon-only floating island spanning the full width, with a slim side margin. The
 * highlight behind the current tab slides to the tab you pick. In the middle sits a
 * raised round Bid Agent button (not a tab): it opens the Bid Agent hub. Alerts are
 * reached from the dashboard bell.
 */
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const t = useTheme();
  const access = useAccess();
  const agentBusy = useBidAgent().useBusy();
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
  const center = access.projects; // the agent works on tenders in Projects' section
  const mid = Math.floor(count / 2);
  const centerSpace = center ? CENTER_W + GAP : 0;
  // The island has a 1pt border: the tabs share the width inside it.
  const tabW =
    width > 0
      ? (width - 2 - PAD * 2 - GAP * (count - 1) - centerSpace) / count
      : 0;
  const xs = state.routes.map(
    (_r, i) => i * (tabW + GAP) + (center && i >= mid ? centerSpace : 0),
  );
  const inputRange = count > 1 ? xs.map((_x, i) => i) : [0, 1];
  const outputRange = count > 1 ? xs : [0, 0];
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
                      translateX: pos.interpolate({ inputRange, outputRange }),
                    },
                  ],
                },
              ]}
            />
          </View>
        ) : null}
        {state.routes.flatMap((route, index) => {
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
          const tab = (
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
            </Pressable>
          );
          return center && index === mid
            ? [
                <CenterButton
                  key="bid-agent"
                  busy={agentBusy}
                  onPress={() =>
                    (navigation.navigate as (name: string) => void)(
                      'BidAgentHub',
                    )
                  }
                />,
                tab,
              ]
            : [tab];
        })}
      </View>
    </View>
  );
}

function CenterButton({
  onPress,
  busy,
}: {
  onPress: () => void;
  busy: boolean;
}) {
  const t = useTheme();
  // The ring takes the page colour so the circle sits in a notch of the island.
  return (
    <View style={styles.centerSlot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Bid Agent"
        accessibilityHint="Ask the Bid Agent about any tender"
        onPress={onPress}
        style={({ pressed }) => [
          styles.center,
          {
            backgroundColor: t.colors.accent,
            borderColor: t.colors.bg,
            transform: [{ scale: pressed ? 0.94 : 1 }],
          },
          t.shadow.md,
        ]}
      >
        <Sparkles size={23} color={t.colors.onAccent} strokeWidth={2} />
        {busy ? (
          <View
            accessibilityLabel="The Bid Agent is working"
            style={[
              styles.busyDot,
              { backgroundColor: t.colors.good, borderColor: t.colors.accent },
            ]}
          />
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  centerSlot: {
    width: CENTER_W,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    position: 'absolute',
    top: (46 - CENTER_SIZE) / 2 - 16,
    width: CENTER_SIZE,
    height: CENTER_SIZE,
    borderRadius: CENTER_SIZE / 2,
    borderWidth: RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busyDot: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
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
});
