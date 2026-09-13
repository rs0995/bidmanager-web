import { View, Text } from "react-native";
import { Inbox } from "lucide-react-native";
import { useThemeColors } from "@/constants/colors";

type EmptyStateProps = {
  icon?: React.ComponentType<{ size?: number; color?: string }>;
  title: string;
  body?: string;
  action?: React.ReactNode;
};

export function EmptyState({ icon: Icon = Inbox, title, body, action }: EmptyStateProps) {
  const colors = useThemeColors();
  return (
    <View className="flex flex-col items-center justify-center gap-2 px-8 py-16">
      <Icon size={32} color={colors.textMuted} />
      <Text className="text-sm font-semibold text-text text-center">{title}</Text>
      {body && <Text className="text-xs text-text-muted text-center">{body}</Text>}
      {action}
    </View>
  );
}
