import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import { cn } from "@/lib/cn";
import { useThemeColors } from "@/constants/colors";

type StatCardProps = {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  value: React.ReactNode;
  to?: string;
  alert?: boolean;
};

export function StatCard({ icon: Icon, label, value, to, alert }: StatCardProps) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={() => to && router.push(to as any)}
      className={cn("bg-surface-0 rounded-[14px] border p-3", alert ? "border-warn" : "border-border")}
    >
      <Icon size={16} color={colors.accent} />
      <Text className="mt-2 text-xl font-bold text-text">{value}</Text>
      <Text className="text-[11px] text-text-muted">{label}</Text>
    </Pressable>
  );
}
