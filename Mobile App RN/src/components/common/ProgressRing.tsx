import { useEffect } from "react";
import Svg, { Circle } from "react-native-svg";
import Animated, {
  useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing,
} from "react-native-reanimated";
import { useThemeColors } from "@/constants/colors";

type ProgressRingProps = {
  pct?: number;
  size?: number;
  indeterminate?: boolean;
};

export function ProgressRing({ pct = 0, size = 40, indeterminate = false }: ProgressRingProps) {
  const colors = useThemeColors();
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const color = indeterminate ? colors.accent : pct >= 1 ? colors.ok : pct >= 0.6 ? colors.accent : colors.warn;

  const rotation = useSharedValue(0);
  useEffect(() => {
    if (indeterminate) {
      rotation.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1);
    }
  }, [indeterminate, rotation]);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const ring = (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colors.surface3} strokeWidth={4} />
      <Circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={indeterminate ? c * 0.75 : c * (1 - pct)}
        rotation={-90}
        origin={`${size / 2}, ${size / 2}`}
      />
    </Svg>
  );

  if (!indeterminate) return ring;
  return <Animated.View style={animatedStyle}>{ring}</Animated.View>;
}
