import { useEffect } from "react";
import { View, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { cn } from "@/lib/cn";

type SkeletonProps = { className?: string; style?: ViewStyle };

// The web app shimmer (a sliding gradient) needs react-native-linear-gradient
// to reproduce exactly; a simple opacity pulse gets the same "loading"
// signal with no extra native dependency, so that is what this uses.
export function Skeleton({ className = "", style }: SkeletonProps) {
  const opacity = useSharedValue(0.5);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  }, [opacity]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      className={cn("bg-surface-1 rounded-lg", className)}
      style={[animatedStyle, style]}
    />
  );
}

export function SkeletonCard() {
  return (
    <View className="bg-surface-0 border border-border rounded-[14px] p-3">
      <Skeleton className="h-3 w-24 mb-2" />
      <Skeleton className="h-4 w-full mb-1" />
      <Skeleton className="h-4 w-2/3 mb-3" />
      <View className="flex-row justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-14" />
      </View>
    </View>
  );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <View className="flex flex-col gap-3 p-4">
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
    </View>
  );
}
