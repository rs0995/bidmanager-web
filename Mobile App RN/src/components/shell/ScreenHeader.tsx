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
    <View className="bg-surface-0 border-b border-border">
      {/* Blank strip covering the status bar area, in the app's page
          background color (not the header bar's white surface-0) — this is
          the themed backdrop the status bar icons sit on, not part of the
          white title bar below it. */}
      <View style={{ height: insets.top, backgroundColor: colors.bg }} />
      <View className="flex-row items-center gap-2 px-3 py-3" style={{ minHeight: 52 }}>
        {back && (
          <Pressable onPress={() => router.back()} className="p-1.5" accessibilityLabel="Back">
            <ChevronLeft size={20} color={colors.text} />
          </Pressable>
        )}
        <Text className="flex-1 text-[15px] text-text" numberOfLines={1} style={{ fontFamily: "BricolageGrotesque_600SemiBold" }}>{title}</Text>
        {actions}
      </View>
    </View>
  );
}
