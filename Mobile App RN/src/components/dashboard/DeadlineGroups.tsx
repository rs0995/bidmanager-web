import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import { Clock } from "lucide-react-native";
import { timeRemaining, urgency } from "@/lib/format";
import { useBookmarkedTenders } from "@/hooks/useBookmarks";
import { EmptyState } from "@/components/feedback/EmptyState";
import { useThemeColors, urgencyColor } from "@/constants/colors";

const BANDS = ["Critical", "Soon", "Comfortable"];

export function DeadlineGroups() {
  const { tenders, isLoading } = useBookmarkedTenders();
  const colors = useThemeColors();

  if (isLoading) return null;
  if (tenders.length === 0) {
    return <EmptyState icon={Clock} title="No upcoming deadlines" body="Bookmark a tender to track its closing date here." />;
  }

  const withUrgency = tenders
    .map((t: any) => ({ t, r: timeRemaining(t.closing_date) }))
    .filter(({ r }: any) => !r.expired);

  return (
    <View className="bg-surface-0 border border-border rounded-[14px] p-4">
      <Text className="mb-3 text-sm font-bold text-text">Upcoming deadlines</Text>
      {BANDS.map((band) => {
        const rows = withUrgency.filter(({ r }: any) => urgency(r.totalDays).label === band);
        if (rows.length === 0) return null;
        const key = urgency(rows[0].r.totalDays).key;
        const color = urgencyColor(key, colors);
        return (
          <View key={band} className="mb-3">
            <Text className="mb-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color }}>{band}</Text>
            {rows.map(({ t, r }: any) => (
              <Pressable
                key={t.id}
                className="flex-row items-center gap-3 py-2"
                onPress={() => router.push(`/tenders/${t.id}` as any)}
              >
                <View className="w-1 self-stretch rounded-full" style={{ backgroundColor: color }} />
                <View className="flex-1">
                  <Text className="font-mono text-[10px] text-accent">{t.tender_id}</Text>
                  <Text className="text-sm text-text" numberOfLines={1}>{t.title}</Text>
                </View>
                <Text className="text-xs font-semibold" style={{ color }}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
        );
      })}
    </View>
  );
}
