import { useMemo } from "react";
import { View, Text, Pressable, FlatList } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQueries } from "@tanstack/react-query";
import { ChevronRight, Inbox } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { TenderCard } from "@/components/tender/TenderCard";
import { EmptyState } from "@/components/feedback/EmptyState";
import { SkeletonList } from "@/components/feedback/Skeleton";
import { getAlert } from "@/lib/alerts";
import { api } from "@/lib/api";
import { useThemeColors } from "@/constants/colors";

// Shows exactly the tenders a bulk "N new tenders added under <org>" alert
// reported (ids stored on the alert at sync time), newest published first.
// There's no server filter for "first seen after X", so each id is fetched
// individually; the ["tender", id] key is shared with the detail screen and
// useBookmarkedTenders, so opening a card afterwards is instant.
export default function NewTendersScreen() {
  const { alertId } = useLocalSearchParams<{ alertId: string }>();
  const alert = getAlert(alertId);
  const ids: number[] = alert?.newTenderIds ?? [];
  const orgName: string = alert?.orgName ?? "";
  const colors = useThemeColors();

  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["tender", id],
      queryFn: () => api.tender(id),
      staleTime: 30_000,
    })),
  });

  const loading = results.some((r) => r.isLoading);
  const tenders = useMemo(
    () =>
      results
        .map((r) => r.data)
        .filter(Boolean)
        .sort((a: any, b: any) => String(b.published_date || "").localeCompare(String(a.published_date || ""))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results.map((r) => r.dataUpdatedAt).join(",")],
  );

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title={orgName || "New tenders"} back />
      {!alert || ids.length === 0 ? (
        <EmptyState icon={Inbox} title="Nothing to show" body="This alert no longer has any new tenders attached." />
      ) : loading && tenders.length === 0 ? (
        <SkeletonList />
      ) : (
        <FlatList
          data={tenders as any[]}
          keyExtractor={(item: any) => String(item.id)}
          renderItem={({ item }) => <TenderCard tender={item} />}
          contentContainerClassName="gap-3 p-4"
          ListHeaderComponent={
            <Text className="text-[14px] text-text-muted">
              {ids.length} new tender{ids.length === 1 ? "" : "s"}, newest first
            </Text>
          }
          ListFooterComponent={
            orgName ? (
              <Pressable
                className="mt-1 flex-row items-center justify-center gap-1 py-3"
                onPress={() =>
                  router.push(`/tenders/org/${encodeURIComponent(orgName)}?sort_by=published_date&sort_order=desc` as any)
                }
              >
                <Text className="text-sm font-semibold text-accent">View all tenders from {orgName}</Text>
                <ChevronRight size={16} color={colors.accent} />
              </Pressable>
            ) : null
          }
        />
      )}
    </View>
  );
}
