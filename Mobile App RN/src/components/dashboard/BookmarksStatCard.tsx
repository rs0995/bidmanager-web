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
      className="bg-surface-0 border border-border rounded-[14px] p-3"
    >
      <Bookmark size={16} color={colors.accent} />
      <View className="flex-row items-stretch mt-2 gap-2">
        <View className="items-start">
          <Text className="text-xl font-bold text-text">{orgCount}</Text>
          <Text className="text-[11px] text-text-muted">Orgs</Text>
        </View>
        <View style={{ width: 1, backgroundColor: colors.border }} />
        <View className="items-start">
          <Text className="text-xl font-bold text-text">{tenderCount}</Text>
          <Text className="text-[11px] text-text-muted">Tenders</Text>
        </View>
      </View>
    </Pressable>
  );
}
