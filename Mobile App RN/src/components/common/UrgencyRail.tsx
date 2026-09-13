import { View } from "react-native";

type UrgencyRailProps = { color: string };

// color must be a real resolved value (e.g. from constants/colors.js
// urgencyColor(key, colors)), not a CSS var string — lib/format.js urgency()
// still returns "var(--x)" strings for the web app, so RN call sites resolve
// through urgencyColor() instead of using .color directly.
export function UrgencyRail({ color }: UrgencyRailProps) {
  return <View className="w-1 self-stretch rounded-full" style={{ backgroundColor: color }} />;
}
