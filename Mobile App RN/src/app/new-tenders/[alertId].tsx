import { useMemo, useState, useCallback } from "react";
import { View, Text, Pressable, FlatList } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQueries } from "@tanstack/react-query";
import { ChevronRight, Inbox, Star, ArrowUpDown, Check } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { TenderCard } from "@/components/tender/TenderCard";
import { SearchField } from "@/components/tender/SearchField";
import { EmptyState } from "@/components/feedback/EmptyState";
import { SkeletonList } from "@/components/feedback/Skeleton";
import { getAlert } from "@/lib/alerts";
import { api } from "@/lib/api";
import { timeRemaining, parseINR } from "@/lib/format";
import { useBookmarkToggle } from "@/hooks/useBookmarks";
import { useThemeColors } from "@/constants/colors";

type SortKey = "newest" | "closing" | "value_high" | "value_low";

const SORT_LABELS: Record<SortKey, string> = {
  newest: "Newest first",
  closing: "Closing soonest",
  value_high: "Value: high to low",
  value_low: "Value: low to high",
};

function closingMs(t: any) {
  const { date } = timeRemaining(t.closing_date);
  return date ? date.getTime() : Infinity;
}

const SORT_COMPARATORS: Record<SortKey, (a: any, b: any) => number> = {
  newest: (a, b) => String(b.published_date || "").localeCompare(String(a.published_date || "")),
  closing: (a, b) => closingMs(a) - closingMs(b),
  value_high: (a, b) => parseINR(b.tender_value) - parseINR(a.tender_value),
  value_low: (a, b) => parseINR(a.tender_value) - parseINR(b.tender_value),
};

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
  const { isBookmarked } = useBookmarkToggle();
  const [q, setQ] = useState("");
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["tender", id],
      queryFn: () => api.tender(id),
      staleTime: 30_000,
    })),
  });

  const loading = results.some((r) => r.isLoading);
  const allTenders = useMemo(
    () =>
      results
        .map((r) => r.data)
        .filter(Boolean)
        .sort((a: any, b: any) => String(b.published_date || "").localeCompare(String(a.published_date || ""))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results.map((r) => r.dataUpdatedAt).join(",")],
  );

  const filterTender = useCallback((t: any) => {
    if (bookmarkedOnly && !isBookmarked(t.id)) return false;
    const needle = q.trim().toLowerCase();
    if (needle && !`${t.title} ${t.tender_id} ${t.organization}`.toLowerCase().includes(needle)) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarkedOnly, q]);
  const filteredTenders = useMemo(() => allTenders.filter(filterTender), [allTenders, filterTender]);
  const tenders = useMemo(
    () => [...filteredTenders].sort(SORT_COMPARATORS[sortKey]),
    [filteredTenders, sortKey],
  );

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title={orgName || "New tenders"} back />
      {!alert || ids.length === 0 ? (
        <EmptyState icon={Inbox} title="Nothing to show" body="This alert no longer has any new tenders attached." />
      ) : loading && allTenders.length === 0 ? (
        <SkeletonList />
      ) : (
        <>
          <View className="px-4 pt-3 pb-2 bg-surface-0 border-b border-border">
            <View className="flex-row items-center gap-2 mb-2">
              <Pressable
                onPress={() => setBookmarkedOnly((v) => !v)}
                className="w-[41px] h-[41px] items-center justify-center rounded-[10px] border"
                style={bookmarkedOnly ? { borderColor: colors.accent, backgroundColor: colors.accentBg } : { borderColor: colors.border, backgroundColor: colors.surface1 }}
                accessibilityLabel="Bookmarked only"
              >
                <Star size={16} color={bookmarkedOnly ? colors.accent : colors.textMuted} fill={bookmarkedOnly ? colors.accent : "none"} />
              </Pressable>
              <SearchField value={q} onSearch={setQ} placeholder="Search title, org, tender ID" />
            </View>
            <View className="flex-row items-center justify-between">
              <Pressable
                className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-border bg-surface-1"
                onPress={() => setSortMenuOpen((v) => !v)}
              >
                <ArrowUpDown size={13} color={colors.textMuted} />
                <Text className="text-[14px] font-medium text-text-muted">Sort: {SORT_LABELS[sortKey]}</Text>
              </Pressable>
            </View>
            {sortMenuOpen && (
              <View className="mt-2 bg-surface-0 border border-border rounded-[12px] overflow-hidden">
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <Pressable
                    key={key}
                    className="flex-row items-center justify-between px-3 py-2.5 border-b border-border"
                    onPress={() => { setSortKey(key); setSortMenuOpen(false); }}
                  >
                    <Text className="text-sm text-text">{SORT_LABELS[key]}</Text>
                    {sortKey === key && <Check size={15} color={colors.accent} />}
                  </Pressable>
                ))}
              </View>
            )}
          </View>
          {tenders.length === 0 ? (
            <EmptyState icon={Inbox} title="No tenders match" body="Try a different search or filter." />
          ) : (
            <FlatList
              data={tenders as any[]}
              keyExtractor={(item: any) => String(item.id)}
              renderItem={({ item }) => <TenderCard tender={item} />}
              contentContainerClassName="gap-3 p-4"
              ListHeaderComponent={
                <Text className="text-[14px] text-text-muted">
                  {tenders.length} of {ids.length} new tender{ids.length === 1 ? "" : "s"}, newest first
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
        </>
      )}
    </View>
  );
}
