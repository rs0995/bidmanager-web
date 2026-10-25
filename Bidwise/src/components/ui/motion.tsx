import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from 'react-native';

/** True when the user has asked the OS to reduce motion. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then(v => alive && setReduced(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      setReduced,
    );
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);
  return reduced;
}

/**
 * Press feedback that reads as a button being pushed down: while held the control sinks
 * slightly (to `to`) and drops 1.5pt; on release it eases back. No spring, so it never
 * overshoots past its resting size. Spread `handlers` onto a Pressable and put `style`
 * on an Animated.View inside it.
 */
export function usePressScale(to = 0.96) {
  const p = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  return useMemo(() => {
    const animate = (value: number) =>
      Animated.timing(p, {
        toValue: value,
        duration: value ? 90 : 160,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    return {
      style: {
        transform: [
          {
            scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, to] }),
          },
          {
            translateY: p.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 1.5],
            }),
          },
        ],
      },
      /** Eases back up without a press-out (e.g. the button turned busy mid-press). */
      release: () => animate(0),
      handlers: {
        onPressIn: () => {
          if (!reduced) animate(1);
        },
        onPressOut: () => {
          if (!reduced) animate(0);
        },
      },
    };
  }, [p, reduced, to]);
}

/**
 * Fades and lifts its children in whenever `id` changes (a sub tab switched), so the new
 * list arrives instead of popping in.
 */
export function FadeSwitch({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduced) return;
    v.setValue(0);
    Animated.timing(v, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [id, v, reduced]);
  return (
    <Animated.View
      style={{
        opacity: v,
        transform: [
          {
            translateY: v.interpolate({
              inputRange: [0, 1],
              outputRange: [8, 0],
            }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

/** Spins its children while `spinning` (a sync in progress). */
export function Spinning({
  spinning,
  children,
}: {
  spinning: boolean;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!spinning || reduced) {
      v.stopAnimation();
      v.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(v, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spinning, reduced, v]);
  const rotate = v.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      {children}
    </Animated.View>
  );
}

/**
 * A sub tab's content that stays mounted while hidden, so switching back is instant (no
 * list to rebuild). Becoming active it settles in quickly from slightly faded and lower,
 * starting visible so the switch never reads as a pause.
 */
export function KeepAlivePane({
  active,
  children,
  style,
}: {
  active: boolean;
  children: React.ReactNode;
  /** e.g. `{ flex: 1 }` around a list that fills the screen. */
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!active || reduced) return;
    v.setValue(0);
    Animated.timing(v, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [active, v, reduced]);
  return (
    <Animated.View
      style={[
        style,
        !active && paneStyles.hidden,
        {
          opacity: v.interpolate({
            inputRange: [0, 1],
            outputRange: [0.45, 1],
          }),
          transform: [
            {
              translateY: v.interpolate({
                inputRange: [0, 1],
                outputRange: [6, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const paneStyles = StyleSheet.create({ hidden: { display: 'none' } });
