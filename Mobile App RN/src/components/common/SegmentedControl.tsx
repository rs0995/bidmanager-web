import { View, Pressable, Text } from "react-native";
import { cn } from "@/lib/cn";
import { useThemeColors } from "@/constants/colors";

type Option = { value: string; label: string; icon?: React.ComponentType<{ size?: number; color?: string }> };

type SegmentedControlProps = {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
};

export function SegmentedControl({ options, value, onChange }: SegmentedControlProps) {
  const colors = useThemeColors();
  return (
    <View className="flex-row w-full bg-surface-1 border border-border rounded-[10px] p-[3px] gap-0.5">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            className={cn(
              "flex-1 flex-row items-center justify-center gap-1 py-2 px-2.5 rounded-lg",
              active && "bg-surface-0",
            )}
          >
            {opt.icon && <opt.icon size={14} color={active ? colors.text : colors.textMuted} />}
            <Text className={cn("text-[13px] text-text-muted", active && "text-text font-semibold")}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
