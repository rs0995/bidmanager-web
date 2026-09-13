import { Pressable, View, Text } from "react-native";
import { router } from "expo-router";
import { Star } from "lucide-react-native";
import { fmtINR, timeRemaining, urgency } from "@/lib/format";
import { useBookmarkToggle } from "@/hooks/useBookmarks";
import { useThemeColors, urgencyColor, hexToRgba } from "@/constants/colors";

export function TenderCard({ tender }: { tender: any }) {
  const { isBookmarked, toggle } = useBookmarkToggle();
  const { totalDays, label, expired } = timeRemaining(tender.closing_date);
  const u = urgency(totalDays);
  const bookmarked = isBookmarked(tender.id);
  const colors = useThemeColors();
  const color = urgencyColor(u.key, colors);

  return (
    <Pressable
      className="bg-surface-0 border border-border rounded-[14px] flex flex-col gap-1.5 p-3.5"
      onPress={() => router.push(`/tenders/${tender.id}` as any)}
    >
      <View className="flex-row items-center justify-between gap-2">
        <Text className="font-mono text-[11px] text-accent">{tender.tender_id}</Text>
        <View className="flex-row items-center gap-2">
          <View
            className="px-2 py-0.5 rounded-full"
            style={{ backgroundColor: expired ? colors.surface2 : hexToRgba(color, 0.16) }}
          >
            <Text className="font-mono text-[11px] font-semibold" style={{ color: expired ? colors.textMuted : color }}>
              {expired ? "Closed" : label}
            </Text>
          </View>
          <Pressable onPress={() => toggle(tender.id)} accessibilityLabel="Toggle bookmark" className="p-0.5">
            <Star size={17} fill={bookmarked ? colors.warn : "none"} color={bookmarked ? colors.warn : colors.textMuted} />
          </Pressable>
        </View>
      </View>
      <Text className="text-sm font-semibold text-text" numberOfLines={2}>{tender.title}</Text>
      <Text className="text-xs">
        <Text className="text-text font-semibold">{fmtINR(tender.tender_value)}</Text>
      </Text>
      {tender.organization && (
        <Text className="text-xs text-text-muted" numberOfLines={1}>{tender.organization}</Text>
      )}
    </Pressable>
  );
}
