import { View, Text, Pressable, ScrollView } from "react-native";
import { router } from "expo-router";
import { Clock } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { SkeletonList } from "@/components/feedback/Skeleton";
import { useBookmarkedTenders } from "@/hooks/useBookmarks";
import { timeRemaining, urgency } from "@/lib/format";
import { useThemeColors, urgencyColor } from "@/constants/colors";

// Dedicated view for the dashboard's "Closing this week" stat — deliberately
// not the shared /tenders screen with a filter param: that screen shows ALL
// tenders (not just bookmarked) with a 5-day cutoff, while this stat counts
// bookmarked tenders closing within 7 days, so reusing it showed the wrong
// set of tenders entirely.
export default function ClosingThisWeekScreen() {
  const { tenders, isLoading } = useBookmarkedTenders();
  const colors = useThemeColors();

  const rows = tenders
    .map((t: any) => ({ t, r: timeRemaining(t.closing_date) }))
    .filter(({ r }: any) => !r.expired && r.totalDays != null && r.totalDays <= 7)
    .sort((a: any, b: any) => (a.r.totalDays ?? Infinity) - (b.r.totalDays ?? Infinity));

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Closing this week" back />
      {isLoading ? (
        <SkeletonList />
      ) : rows.length === 0 ? (
        <EmptyState icon={Clock} title="Nothing closing this week" body="Bookmarked tenders closing within 7 days will show up here." />
      ) : (
        <ScrollView contentContainerClassName="p-4">
          <View className="bg-surface-0 border border-border rounded-[14px] p-1">
            {rows.map(({ t, r }: any, i: number) => {
              const color = urgencyColor(urgency(r.totalDays).key, colors);
              const isLast = i === rows.length - 1;
              return (
                <Pressable
                  key={t.id}
                  className={`flex-row items-center gap-3 p-3${isLast ? "" : " border-b border-border"}`}
                  onPress={() => router.push(`/tenders/${t.id}` as any)}
                >
                  <View className="w-1 self-stretch rounded-full" style={{ backgroundColor: color }} />
                  <View className="flex-1">
                    <Text
                      className="text-[14px] uppercase text-text-muted"
                      style={{ fontFamily: "IBMPlexMono_400Regular", letterSpacing: 0.5 }}
                    >
                      {t.tender_id}
                    </Text>
                    <Text className="text-base text-text" numberOfLines={1}>{t.title}</Text>
                  </View>
                  <Text className="text-sm font-bold" style={{ color }}>{r.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
