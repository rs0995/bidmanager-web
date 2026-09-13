import { useEffect } from "react";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from "react-native-reanimated";

type SpinningIconProps = {
  spinning: boolean;
  children: React.ReactNode;
};

// Generic replacement for the web app className="animate-spin" pattern (used
// on RefreshCw/Loader2 icons) -- RN has no CSS animations, so this wraps any
// icon in a Reanimated rotation that only runs while `spinning` is true.
export function SpinningIcon({ spinning, children }: SpinningIconProps) {
  const rotation = useSharedValue(0);
  useEffect(() => {
    if (spinning) {
      rotation.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1);
    } else {
      rotation.value = 0;
    }
  }, [spinning, rotation]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}
