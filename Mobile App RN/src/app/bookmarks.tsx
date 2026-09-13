import { useMemo, useState } from "react";
import { View, ScrollView } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Search, Building2, Globe } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { SegmentedControl } from "@/components/common/SegmentedControl";
import { TenderCard } from "@/components/tender/TenderCard";
import { OrganizationCard } from "@/components/tender/OrganizationCard";
import { SkeletonList } from "@/components/feedback/Skeleton";
import { EmptyState } from "@/components/feedback/EmptyState";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Input } from "@/components/common/Field";
import { useBookmarkedTenders, useOrgBookmarkToggle } from "@/hooks/useBookmarks";
import { useOrganizations } from "@/hooks/useOrganizations";
import { useThemeColors } from "@/constants/colors";
import { getRaw, setRaw } from "@/lib/kv";

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const colors = useThemeColors();
  return (
    <View className="relative mb-2 justify-center">
      <Search size={15} color={colors.textMuted} style={{ position: "absolute", left: 12, zIndex: 1 }} />
      <Input style={{ paddingLeft: 34 }} placeholder={placeholder} value={value} onChangeText={onChange} />
    </View>
  );
}

export default function BookmarksScreen() {
  const { view: viewParam } = useLocalSearchParams<{ view?: string }>();
  const view = viewParam === "tenders"
    ? "tenders"
    : (viewParam ? "orgs" : (getRaw("bm.bookmarksLastView") === "tenders" ? "tenders" : "orgs"));
  const setView = (v: string) => {
    setRaw("bm.bookmarksLastView", v);
    router.setParams({ view: v });
  };
  const [tenderSearch, setTenderSearch] = useState("");
  const [orgSearch, setOrgSearch] = useState("");

  const { tenders, isLoading: tendersLoading } = useBookmarkedTenders();
  const { isOrgBookmarked } = useOrgBookmarkToggle();
  const orgsQuery = useOrganizations({});

  const filteredTenders = useMemo(() => {
    let rows = tenders;
    if (tenderSearch.trim()) {
      const q = tenderSearch.trim().toLowerCase();
      rows = rows.filter((t: any) => (
        t.title?.toLowerCase().includes(q)
        || t.tender_id?.toLowerCase().includes(q)
        || t.organization?.toLowerCase().includes(q)
      ));
    }
    return rows;
  }, [tenders, tenderSearch]);

  const filteredOrgs = useMemo(() => {
    let rows = (orgsQuery.data || []).filter((org: any) => isOrgBookmarked(org.name));
    if (orgSearch.trim()) {
      const q = orgSearch.trim().toLowerCase();
      rows = rows.filter((org: any) => org.name.toLowerCase().includes(q));
    }
    return [...rows].sort((a: any, b: any) => (a.is_available === false ? 1 : 0) - (b.is_available === false ? 1 : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgsQuery.data, orgSearch]);

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Bookmarks" back />
      <View className="px-4 pt-3 pb-1">
        <SegmentedControl
          value={view}
          onChange={setView}
          options={[{ value: "orgs", label: "Organisations" }, { value: "tenders", label: "Tenders" }]}
        />
      </View>

      {view === "tenders" && (
        <ScrollView>
          <View className="px-4 pt-2 pb-1">
            <SearchBox value={tenderSearch} onChange={setTenderSearch} placeholder="Search bookmarked tenders" />
          </View>
          {tendersLoading && <SkeletonList />}
          {!tendersLoading && filteredTenders.length === 0 && (
            <EmptyState
              icon={Globe}
              title={tenderSearch ? "No tenders match your search" : "No bookmarked tenders"}
              body={tenderSearch ? "Try a different search." : "Bookmark a tender to see it here."}
            />
          )}
          {!tendersLoading && filteredTenders.length > 0 && (
            <View className="flex flex-col gap-3 p-4 pt-2">
              {filteredTenders.map((t: any) => <TenderCard key={t.id} tender={t} />)}
            </View>
          )}
        </ScrollView>
      )}

      {view === "orgs" && (
        <ScrollView>
          <View className="px-4 pt-2 pb-1">
            <SearchBox value={orgSearch} onChange={setOrgSearch} placeholder="Search bookmarked organisations" />
          </View>
          {orgsQuery.isLoading && <SkeletonList />}
          {orgsQuery.isError && <ErrorState message={orgsQuery.error?.message} onRetry={orgsQuery.refetch} />}
          {!orgsQuery.isLoading && !orgsQuery.isError && filteredOrgs.length === 0 && (
            <EmptyState
              icon={Building2}
              title={orgSearch ? "No organisations match your search" : "No bookmarked organisations"}
              body={orgSearch ? "Try a different search." : "Bookmark an organisation to see it here."}
            />
          )}
          {!orgsQuery.isLoading && !orgsQuery.isError && filteredOrgs.length > 0 && (
            <View className="flex flex-col gap-2 p-4 pt-2">
              {filteredOrgs.map((org: any) => <OrganizationCard key={org.id} org={org} showWebsite />)}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
