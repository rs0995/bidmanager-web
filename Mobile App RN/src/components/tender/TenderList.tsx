import { useMemo, useEffect } from "react";
import { FlatList, View } from "react-native";
import { Globe } from "lucide-react-native";
import { TenderCard } from "./TenderCard";
import { SkeletonList } from "@/components/feedback/Skeleton";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";

type TenderListProps = {
  query: any;
  filterFn?: (t: any) => boolean;
  onRowsChange?: (rows: any[]) => void;
  renderEmpty?: () => React.ReactNode;
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null;
};

// RN has no IntersectionObserver — FlatList's onEndReached is the native
// equivalent for infinite scroll, and also gives virtualization for free
// (the web version rendered every fetched row into the DOM).
export function TenderList({ query, filterFn, onRowsChange, renderEmpty, ListHeaderComponent }: TenderListProps) {
  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = query;

  const allRows = useMemo(() => (data ? data.pages.flatMap((p: any) => p.items) : []), [data]);
  const rows = useMemo(() => (filterFn ? allRows.filter(filterFn) : allRows), [allRows, filterFn]);

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
      ListFooterComponent={isFetchingNextPage ? <SkeletonList count={2} /> : <View className="h-4" />}
    />
  );
}
