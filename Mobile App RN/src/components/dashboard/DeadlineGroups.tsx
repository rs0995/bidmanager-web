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
    .filter(({ r }: any) => !r.expired)
    .sort((a: any, b: any) => (a.r.totalDays ?? Infinity) - (b.r.totalDays ?? Infinity))
    .slice(0, 10);

  return (
    <View className="bg-surface-0 border border-border rounded-[19px] p-4">
      <Text className="mb-3 text-base text-text" style={{ fontFamily: "BricolageGrotesque_700Bold" }}>Upcoming deadlines</Text>
      {BANDS.map((band) => {
        const rows = withUrgency.filter(({ r }: any) => urgency(r.totalDays).label === band);
        if (rows.length === 0) return null;
        const key = urgency(rows[0].r.totalDays).key;
        const color = urgencyColor(key, colors);
        return (
          <View key={band} className="mb-3">
            <Text className="mb-1.5 text-xs font-bold uppercase tracking-wide" style={{ color }}>{band}</Text>
            {rows.map(({ t, r }: any) => (
              <Pressable
                key={t.id}
                className="flex-row items-center gap-3 py-2"
                onPress={() => router.push(`/tenders/${t.id}` as any)}
              >
                <View className="w-1 self-stretch rounded-full" style={{ backgroundColor: color }} />
                <View className="flex-1">
                  <Text
                    className="text-xs uppercase text-text-muted"
                    style={{ fontFamily: "IBMPlexMono_400Regular", letterSpacing: 0.5 }}
                  >
                    {t.tender_id}
                  </Text>
                  <Text className="text-base text-text" numberOfLines={1}>{t.title}</Text>
                </View>
                <Text className="text-sm font-bold" style={{ color }}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
        );
      })}
    </View>
  );
}
