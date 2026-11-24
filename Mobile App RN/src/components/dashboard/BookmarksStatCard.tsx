import { Pressable, View, Text } from "react-native";
import { router } from "expo-router";
import { Bookmark } from "lucide-react-native";
import { useThemeColors } from "@/constants/colors";

type BookmarksStatCardProps = {
  orgCount: number;
  tenderCount: number;
  to?: string;
};

// The web version used a 3-column CSS grid (value | divider | value) so both
// labels align under their own value; RN has no CSS grid, so this reproduces
// the same layout with two flex columns flanking a vertical divider View.
export function BookmarksStatCard({ orgCount, tenderCount, to }: BookmarksStatCardProps) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={() => to && router.push(to as any)}
      className="bg-surface-0 border border-border rounded-2xl px-3.5 pt-[14px] pb-[14px]"
    >
      <View className="w-[39px] h-[39px] rounded-[11px] items-center justify-center mb-2 bg-warn-bg">
        <Bookmark size={18} color={colors.warn} />
      </View>
      <View className="flex-row items-stretch gap-3">
        <View className="items-center">
          <Text className="text-[25px] text-text" style={{ letterSpacing: -0.4, fontFamily: "BricolageGrotesque_700Bold" }}>{orgCount}</Text>
          <Text className="mt-0.5 text-[14px] text-text-muted">Orgs</Text>
        </View>
        <View style={{ width: 1.5, backgroundColor: colors.border }} />
        <View className="items-center">
          <Text className="text-[25px] text-text" style={{ letterSpacing: -0.4, fontFamily: "BricolageGrotesque_700Bold" }}>{tenderCount}</Text>
          <Text className="mt-0.5 text-[14px] text-text-muted">Tenders</Text>
        </View>
      </View>
    </Pressable>
  );
}
