import { useState } from "react";
import { View, Text, Pressable, ScrollView, useWindowDimensions, type NativeSyntheticEvent, type NativeScrollEvent } from "react-native";
import { router } from "expo-router";
import { TriangleAlert, ArrowRight } from "lucide-react-native";
import { getClosingSoon } from "@/lib/needsAttention";
import { useBookmarkedTenders } from "@/hooks/useBookmarks";
import { useThemeColors } from "@/constants/colors";

const CARD_PADDING = 16; // p-4
const VISIBLE_COUNT = 3;

export function NeedsAttentionCard() {
  const { tenders } = useBookmarkedTenders();
  const colors = useThemeColors();
  const { width: windowWidth } = useWindowDimensions();
  const [page, setPage] = useState(0);

  const urgent = getClosingSoon(tenders);

  if (urgent.length === 0) return null;

  const shown = urgent.slice(0, VISIBLE_COUNT);
  const hasMore = urgent.length > VISIBLE_COUNT;
  // The card sits inside the screen's px-4 padding, so its own content width
  // is the window width minus that outer gutter and this card's own padding.
  const pageWidth = windowWidth - CARD_PADDING * 2 - CARD_PADDING * 2;

  const handleMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
    setPage(Math.max(0, Math.min(idx, shown.length - 1)));
  };

  return (
    <View className="bg-surface-0 border border-border rounded-[19px] p-4 mb-4">
      <View className="flex-row items-center gap-2 mb-3">
        <TriangleAlert size={16} color={colors.warn} />
        <Text className="flex-1 text-sm font-bold text-text">Needs attention</Text>
        {hasMore && (
          <Pressable onPress={() => router.push("/needs-attention" as any)} hitSlop={8}>
            <Text className="text-xs font-semibold text-accent">Show all</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleMomentumEnd}
        style={{ width: pageWidth }}
      >
        {shown.map(({ tender: t, label }: any) => (
          <View key={t.id} style={{ width: pageWidth }}>
            <View className="flex-row items-center gap-3 p-[11px] rounded-lg bg-surface-1">
              <View className="rounded-full bg-danger-bg px-2 py-1">
                <Text className="text-sm font-medium text-danger">{label}</Text>
              </View>
              <Text className="flex-1 text-sm text-text" numberOfLines={2}>
                {t.title}
              </Text>
              <Pressable className="p-1" onPress={() => router.push(`/tenders/${t.id}` as any)}>
                <ArrowRight size={16} color={colors.text} />
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>

      {shown.length > 1 && (
        <View className="flex-row items-center justify-center gap-1.5 mt-2.5">
          {shown.map(({ tender: t }: any, i: number) => (
            <View
              key={t.id}
              style={{
                width: i === page ? 14 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === page ? colors.warn : colors.border,
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}
