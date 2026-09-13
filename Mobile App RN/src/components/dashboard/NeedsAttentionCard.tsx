import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import { TriangleAlert, CircleAlert, ArrowRight } from "lucide-react-native";
import { timeRemaining, urgency } from "@/lib/format";
import { useBookmarkedTenders } from "@/hooks/useBookmarks";
import { useThemeColors } from "@/constants/colors";

export function NeedsAttentionCard() {
  const { tenders } = useBookmarkedTenders();
  const colors = useThemeColors();

  const urgent = tenders.filter((t: any) => {
    const { totalDays, expired } = timeRemaining(t.closing_date);
    return !expired && urgency(totalDays).label === "Critical" && !t.has_documents;
  });

  if (urgent.length === 0) return null;

  return (
    <View className="bg-surface-0 border rounded-[14px] p-4 mb-4" style={{ borderColor: colors.warn }}>
      <View className="flex-row items-center gap-2 mb-3">
        <TriangleAlert size={16} color={colors.warn} />
        <Text className="text-sm font-bold text-text">Needs attention</Text>
      </View>
      <View className="flex flex-col gap-2">
        {urgent.slice(0, 3).map((t: any) => (
          <View key={t.id} className="flex-row items-center gap-3 p-2.5 rounded-lg bg-surface-1">
            <CircleAlert size={16} color={colors.danger} />
            <Text className="flex-1 text-sm text-text" numberOfLines={2}>
              {t.title} closes soon with no documents yet
            </Text>
            <Pressable className="p-1" onPress={() => router.push(`/tenders/${t.id}` as any)}>
              <ArrowRight size={16} color={colors.text} />
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}
