import { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';
import { useReducedMotion } from './motion';

const CYCLE_MS = 3200;

/**
 * Cycles through `suggestions` every few seconds (with a quick fade, none with
 * Reduce Motion) while not `paused`. Used by the Bid Agent's boxes and the
 * Filters sheet's Department search.
 */
export function useCycledHint(suggestions: string[], paused: boolean) {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  const count = suggestions.length;
  useEffect(() => {
    if (paused || count < 2) return;
    const id = setInterval(() => {
      if (reduced) {
        setI(n => n + 1);
        return;
      }
      Animated.timing(fade, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }).start(() => {
        setI(n => n + 1);
        Animated.timing(fade, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }).start();
      });
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, [paused, count, reduced, fade]);
  return { hint: count ? suggestions[i % count] : '', fade };
}
