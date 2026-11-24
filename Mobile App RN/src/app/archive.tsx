import { useState, useMemo, useCallback } from "react";
import { View, Pressable } from "react-native";
import { Star } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { SiteScope } from "@/components/tender/SiteScope";
import { SegmentedControl } from "@/components/common/SegmentedControl";
import { SearchField } from "@/components/tender/SearchField";
import { TenderList } from "@/components/tender/TenderList";
import { OrganizationList } from "@/components/tender/OrganizationList";
import { useTenders } from "@/hooks/useTenders";
import { useOrganizations } from "@/hooks/useOrganizations";
import { useBookmarkToggle, useBookmarkedTenders } from "@/hooks/useBookmarks";
import { timeRemaining } from "@/lib/format";
import { useThemeColors } from "@/constants/colors";
import { getRaw, setRaw } from "@/lib/kv";

// Closed tenders: the server's archived flag (set by its nightly sweep once a
// tender is well past its closing date). Mirrors the Tenders tab layout --
// Organisations / Tenders, search, bookmark filter.
export default function ArchiveScreen() {
  const colors = useThemeColors();
  const { isBookmarked } = useBookmarkToggle();
  const [view, setViewState] = useState<"orgs" | "tenders">(getRaw("bm.archiveLastView") === "orgs" ? "orgs" : "tenders");
  const [websiteId, setWebsiteId] = useState(getRaw("bm.tendersLastWebsiteId") || "");
  const [q, setQ] = useState("");
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [orgBookmarkedOnly, setOrgBookmarkedOnly] = useState(false);

  const setView = (v: "orgs" | "tenders") => {
    setRaw("bm.archiveLastView", v);
    setViewState(v);
  };

  const tendersQuery = useTenders({ archived: "true", website_id: websiteId, q });
  const orgsQuery = useOrganizations({ archived: true, website_id: websiteId });

  // Bookmarked-only reads the saved bookmarks directly (see the Tenders tab).
  const bookmarked = useBookmarkedTenders();
  const bookmarkedKey = bookmarked.tenders.map((t: any) => `${t.id}:${t.status}:${t.closing_date}:${t.is_archived}`).join("|");
  const bookmarkQuery = useMemo(() => ({
    data: { pages: [{ items: bookmarked.tenders }] },
    isLoading: bookmarked.isLoading,
    isError: false,
    error: null,
    fetchNextPage: () => {},
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: () => {},
  }), // eslint-disable-next-line react-hooks/exhaustive-deps
  [bookmarkedKey, bookmarked.isLoading]);
  const listQuery = bookmarkedOnly ? bookmarkQuery : tendersQuery;

  const filterFn = useCallback((t: any) => {
    if (!bookmarkedOnly) return true;
    if (!isBookmarked(t) || !t.is_archived) return false;
    if (websiteId && String(t.website_id) !== String(websiteId)) return false;
    const needle = q.trim().toLowerCase();
    if (needle && !`${t.title} ${t.tender_id} ${t.organization}`.toLowerCase().includes(needle)) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarkedOnly, websiteId, q]);
  const sortFn = useCallback((a: any, b: any) => {
    const at = timeRemaining(a.closing_date).date?.getTime() ?? 0;
    const bt = timeRemaining(b.closing_date).date?.getTime() ?? 0;
    return bt - at; // most recently closed first
  }, []);

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Archive" back />
      <SiteScope
        websiteId={websiteId}
        onChange={(id) => {
          setRaw("bm.tendersLastWebsiteId", id);
          setWebsiteId(id);
        }}
      />
      <View className="px-4 pb-1">
        <SegmentedControl
          value={view}
          onChange={(v) => setView(v as "orgs" | "tenders")}
          options={[{ value: "orgs", label: "Organisations" }, { value: "tenders", label: "Tenders" }]}
        />
      </View>
      {view === "tenders" && (
        <View className="flex-1">
          <View className="flex-row items-center gap-2 px-4 pt-3 pb-2 bg-surface-0 border-b border-border">
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
          <TenderList query={listQuery} filterFn={filterFn} sortFn={bookmarkedOnly ? sortFn : undefined} />
        </View>
      )}
      {view === "orgs" && (
        <OrganizationList
          query={orgsQuery}
          bookmarkedOnly={orgBookmarkedOnly}
          onToggleBookmarked={setOrgBookmarkedOnly}
          archived
        />
      )}
    </View>
  );
}
