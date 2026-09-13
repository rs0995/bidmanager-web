import { Pressable, Text } from "react-native";
import { cn } from "@/lib/cn";

type ChipProps = {
  active?: boolean;
  children: React.ReactNode;
  onPress?: () => void;
};

export function Chip({ active, children, onPress }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      className={cn(
        "flex-row items-center gap-1 px-3 py-1.5 rounded-full border border-border bg-surface-1",
        active && "bg-accent-bg border-accent",
      )}
    >
      <Text className={cn("text-[13px] font-medium text-text-muted", active && "text-accent")}>
        {children}
      </Text>
    </Pressable>
  );
}
