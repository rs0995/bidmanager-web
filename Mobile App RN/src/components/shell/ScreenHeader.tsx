import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/constants/colors";

type ScreenHeaderProps = {
  title: string;
  back?: boolean;
  actions?: React.ReactNode;
};

export function ScreenHeader({ title, back = false, actions }: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  return (
    <View
      className="flex-row items-center gap-2 px-3 bg-surface-0 border-b border-border"
      style={{ minHeight: 52, paddingTop: insets.top }}
    >
      {back && (
        <Pressable onPress={() => router.back()} className="p-1.5" accessibilityLabel="Back">
          <ChevronLeft size={20} color={colors.text} />
        </Pressable>
      )}
      <Text className="flex-1 text-[15px] font-semibold text-text" numberOfLines={1}>{title}</Text>
      {actions}
    </View>
  );
}
