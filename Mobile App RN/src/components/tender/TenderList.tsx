import { useMemo, useEffect } from "react";
import { FlatList, View, ActivityIndicator } from "react-native";
import { Globe } from "lucide-react-native";
import { TenderCard } from "./TenderCard";
import { SkeletonList } from "@/components/feedback/Skeleton";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";

type TenderListProps = {
  query: any;
  filterFn?: (t: any) => boolean;
  sortFn?: (a: any, b: any) => number;
  onRowsChange?: (rows: any[]) => void;
  renderEmpty?: () => React.ReactNode;
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null;
};

// RN has no IntersectionObserver — FlatList's onEndReached is the native
// equivalent for infinite scroll, and also gives virtualization for free
// (the web version rendered every fetched row into the DOM).
export function TenderList({ query, filterFn, sortFn, onRowsChange, renderEmpty, ListHeaderComponent }: TenderListProps) {
  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = query;

  const allRows = useMemo(() => (data ? data.pages.flatMap((p: any) => p.items) : []), [data]);
  // Sorted client-side as a safety net: the server is asked to sort (via
  // sort_by/sort_order query params where callers pass them), but pages are
  // fetched independently, and if the server doesn't honor the params this
  // still guarantees the union of loaded rows renders in the right order.
  const sortedRows = useMemo(() => (sortFn ? allRows.slice().sort(sortFn) : allRows), [allRows, sortFn]);
  const rows = useMemo(() => (filterFn ? sortedRows.filter(filterFn) : sortedRows), [sortedRows, filterFn]);

  useEffect(() => { onRowsChange?.(allRows); }, [allRows, onRowsChange]);

  if (isLoading) return <SkeletonList />;
  if (isError) return <ErrorState message={error?.message} onRetry={refetch} />;

  if (rows.length === 0) {
    if (renderEmpty) return <>{renderEmpty()}</>;
    return <EmptyState icon={Globe} title="No tenders found" body="Try adjusting your search or filters." />;
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(item: any) => String(item.id)}
      renderItem={({ item }) => <TenderCard tender={item} />}
      contentContainerClassName="gap-3 p-4"
      ListHeaderComponent={ListHeaderComponent}
      onEndReachedThreshold={0.5}
      onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
      ListFooterComponent={
        isFetchingNextPage
          ? <View className="py-6 items-center justify-center"><ActivityIndicator /></View>
          : <View className="h-4" />
      }
    />
  );
}
