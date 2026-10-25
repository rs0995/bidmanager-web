import React from 'react';
import {
  ScrollView,
  ScrollViewProps,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';

export const TAB_BAR_HEIGHT = 58;

/** Bottom padding a scrolling tab screen needs so its last row clears the docked tab bar. */
export function useTabBarClearance() {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + insets.bottom + 16;
}

type Props = {
  /** Fixed header rendered above the scrolling content (AppHeader). */
  header?: React.ReactNode;
  /** Fixed footer pinned to the bottom (e.g. a sticky save bar). */
  footer?: React.ReactNode;
  children?: React.ReactNode;
  /** false: children manage their own scrolling (FlatList, log console). */
  scroll?: boolean;
  /** true on tab screens: adds bottom clearance for the tab bar. */
  tabBar?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  scrollProps?: ScrollViewProps;
};

// Every screen: opaque status-bar area (the clock/battery row is always readable),
// a fixed header, then content that scrolls independently of the tab bar.
export function Screen({
  header,
  footer,
  children,
  scroll = true,
  tabBar,
  contentStyle,
  scrollProps,
}: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const bottom = tabBar ? clearance : insets.bottom + 16;

  return (
    <View style={[styles.fill, { backgroundColor: t.colors.bg }]}>
      {/* Status-bar area matches the white masthead below it. */}
      <View style={{ height: insets.top, backgroundColor: t.colors.surface }} />
      {header}
      {scroll ? (
        <ScrollView
          {...scrollProps}
          style={styles.fill}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: footer ? 16 : bottom },
            contentStyle,
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View
          style={[
            styles.fill,
            { paddingBottom: footer ? 0 : bottom },
            contentStyle,
          ]}
        >
          {children}
        </View>
      )}
      {footer ? (
        <View
          style={[
            styles.footer,
            {
              borderTopColor: t.colors.hair,
              backgroundColor: t.colors.surface,
              paddingBottom: tabBar ? clearance - 4 : insets.bottom + 10,
            },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 10 },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
});
