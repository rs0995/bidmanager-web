import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { cn } from "@/lib/cn";
import { useThemeColors } from "@/constants/colors";

type Variant = "accent" | "ok" | "warn" | "danger";

type StatCardProps = {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  value: React.ReactNode;
  to?: string;
  variant?: Variant;
  alert?: boolean;
};

const VARIANT_BG: Record<Variant, string> = {
  accent: "bg-accent-bg",
  ok: "bg-ok-bg",
  warn: "bg-warn-bg",
  danger: "bg-danger-bg",
};

export function StatCard({ icon: Icon, label, value, to, variant = "accent", alert }: StatCardProps) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={() => to && router.push(to as any)}
      className={cn("bg-surface-0 rounded-2xl border px-3.5 pt-[14px] pb-[14px]", alert ? "border-warn" : "border-border")}
    >
      <View className={cn("w-[39px] h-[39px] rounded-[11px] items-center justify-center mb-2", VARIANT_BG[variant])}>
        <Icon size={18} color={colors[variant]} />
      </View>
      <Text className="text-[25px] text-text" style={{ letterSpacing: -0.4, fontFamily: "BricolageGrotesque_700Bold" }}>{value}</Text>
      <Text className="mt-0.5 text-[14px] text-text-muted">{label}</Text>
    </Pressable>
  );
}
