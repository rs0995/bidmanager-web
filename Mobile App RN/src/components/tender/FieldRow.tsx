import { View, Text } from "react-native";

type FieldRowProps = {
  label: string;
  value: React.ReactNode;
  stacked?: boolean;
};

export function FieldRow({ label, value, stacked }: FieldRowProps) {
  if (value == null || value === "") return null;

  if (stacked) {
    return (
      <View className="py-2.5 border-b border-border">
        <Text className="text-xs text-text-muted">{label}</Text>
        <Text className="mt-1 text-sm font-medium text-text">{value}</Text>
      </View>
    );
  }

  return (
    <View className="flex-row justify-between gap-3 py-2.5 border-b border-border">
      <Text className="text-sm text-text-muted">{label}</Text>
      <Text className="text-sm font-medium text-text text-right" style={{ maxWidth: "62%" }}>{value}</Text>
    </View>
  );
}
