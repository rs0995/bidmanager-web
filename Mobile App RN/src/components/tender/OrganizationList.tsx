import { useMemo, useState } from "react";
import { View, FlatList } from "react-native";
import { Bookmark, Search, Building2 } from "lucide-react-native";
import { OrganizationCard } from "./OrganizationCard";
import { SkeletonList } from "@/components/feedback/Skeleton";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Chip } from "@/components/common/Chip";
import { Input } from "@/components/common/Field";
import { useOrgBookmarkToggle } from "@/hooks/useBookmarks";
import { useThemeColors } from "@/constants/colors";

type OrganizationListProps = {
  query: any;
  bookmarkedOnly: boolean;
  onToggleBookmarked: (value: boolean) => void;
};

export function OrganizationList({ query, bookmarkedOnly, onToggleBookmarked }: OrganizationListProps) {
  const { data, isLoading, isError, error, refetch } = query;
  const { isOrgBookmarked } = useOrgBookmarkToggle();
  const [search, setSearch] = useState("");
  const colors = useThemeColors();

  const items = useMemo(() => {
    let all = data || [];
    if (bookmarkedOnly) {
      all = all.filter((org: any) => isOrgBookmarked(org.name));
    } else {
      all = all.filter((org: any) => org.is_available !== false);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      all = all.filter((org: any) => org.name.toLowerCase().includes(q));
    }
    if (bookmarkedOnly) {
      all = [...all].sort((a: any, b: any) => (a.is_available === false ? 1 : 0) - (b.is_available === false ? 1 : 0));
    }
    return all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, bookmarkedOnly, search]);

  const header = (
    <View className="px-4 pt-3 pb-2 bg-bg">
      <View className="relative mb-2 justify-center">
        <Search size={15} color={colors.textMuted} style={{ position: "absolute", left: 12, zIndex: 1 }} />
        <Input
          style={{ paddingLeft: 34 }}
          placeholder="Search organisations"
          value={search}
          onChangeText={setSearch}
        />
      </View>
      <View className="flex-row gap-2">
        <Chip active={bookmarkedOnly} onPress={() => onToggleBookmarked(!bookmarkedOnly)}>
          <Bookmark size={12} color={bookmarkedOnly ? colors.accent : colors.textMuted} /> Bookmarked
        </Chip>
      </View>
    </View>
  );

  return (
    <View className="flex-1">
      {header}
      {isLoading && <SkeletonList />}
      {isError && <ErrorState message={error?.message} onRetry={refetch} />}
      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={Building2}
          title={search ? "No organisations match your search" : bookmarkedOnly ? "No bookmarked organisations" : "No organizations found"}
          body={search ? "Try a different search." : bookmarkedOnly ? "Bookmark an organisation to see it here." : "Try a different portal scope."}
        />
      )}
      {!isLoading && !isError && items.length > 0 && (
        <FlatList
          data={items}
          keyExtractor={(item: any) => String(item.id)}
          renderItem={({ item }) => <OrganizationCard org={item} />}
          contentContainerClassName="gap-2 px-4 pb-4"
        />
      )}
    </View>
  );
}
