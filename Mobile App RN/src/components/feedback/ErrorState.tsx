import { View, Text } from "react-native";
import { TriangleAlert } from "lucide-react-native";
import { Button } from "../common/Button";
import { useThemeColors } from "@/constants/colors";

type ErrorStateProps = {
  message?: string;
  onRetry?: () => void;
};

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  const colors = useThemeColors();
  return (
    <View className="flex flex-col items-center justify-center gap-3 px-8 py-16">
      <TriangleAlert size={32} color={colors.danger} />
      <Text className="text-sm text-text-muted text-center">
        {message || "Something went wrong."}
      </Text>
      {onRetry && <Button variant="secondary" onPress={onRetry}>Retry</Button>}
    </View>
  );
}
