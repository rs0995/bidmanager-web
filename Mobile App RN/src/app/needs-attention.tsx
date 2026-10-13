import { View, Text, Pressable, ScrollView } from "react-native";
import { router } from "expo-router";
import { ArrowRight } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { TriangleAlert } from "lucide-react-native";
import { getClosingSoon } from "@/lib/needsAttention";
import { useBookmarkedTenders } from "@/hooks/useBookmarks";
import { useThemeColors } from "@/constants/colors";

export default function NeedsAttentionScreen() {
  const { tenders } = useBookmarkedTenders();
  const colors = useThemeColors();

  const urgent = getClosingSoon(tenders);

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Needs attention" back />
      {urgent.length === 0 ? (
        <EmptyState
          icon={TriangleAlert}
          title="Nothing needs attention"
          body="Bookmarked tenders with 1 day left will show up here."
        />
      ) : (
        <ScrollView contentContainerClassName="p-4">
          <View className="flex flex-col gap-2">
            {urgent.map(({ tender: t, label }: any) => (
              <Pressable
                key={t.id}
                className="flex-row items-center gap-3 p-[11px] rounded-lg bg-surface-1"
                onPress={() => router.push(`/tenders/${t.id}` as any)}
              >
                <View className="rounded-full bg-danger-bg px-2 py-1">
                  <Text className="text-sm font-medium text-danger">{label}</Text>
                </View>
                <Text className="flex-1 text-sm text-text" numberOfLines={2}>
                  {t.title}
                </Text>
                <ArrowRight size={16} color={colors.text} />
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
