import { useState, useMemo, useCallback } from "react";
import { View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { SiteScope } from "@/components/tender/SiteScope";
import { SegmentedControl } from "@/components/common/SegmentedControl";
import { TenderFilterBar } from "@/components/tender/TenderFilterBar";
import { TenderFilterSheet } from "@/components/tender/TenderFilterSheet";
import { TenderList } from "@/components/tender/TenderList";
import { OrganizationList } from "@/components/tender/OrganizationList";
import { useTenders } from "@/hooks/useTenders";
import { useOrganizations } from "@/hooks/useOrganizations";
import { useBookmarkToggle } from "@/hooks/useBookmarks";
import { timeRemaining } from "@/lib/format";
import { customFilterPass } from "@/components/tender/CustomFilterMenu";
import { getRaw, setRaw } from "@/lib/kv";

function toStr(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] || "" : v || "";
}

export default function TendersScreen() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const { isBookmarked } = useBookmarkToggle();

  const filters = useMemo(() => {
    const out: Record<string, string> = {};
    Object.entries(params).forEach(([k, v]) => { out[k] = toStr(v); });
    return out;
  }, [params]);

  const view = filters.view
    ? (filters.view === "orgs" ? "orgs" : "tenders")
    : (getRaw("bm.tendersLastView") === "orgs" ? "orgs" : "tenders");
  const websiteId = filters.website_id || getRaw("bm.tendersLastWebsiteId") || "";
  const customFilters = filters.custom ? filters.custom.split(",").filter(Boolean) : [];
  const bookmarkedOnly = filters.bookmarked_only === "1";
  const closingSoon = filters.closing5 === "1";
  const orgBookmarkedOnly = filters.org_bookmarked === "1";

  const apiFilters = useMemo(() => {
    const { view: _v, custom: _c, bookmarked_only: _b, closing5: _c5, org_bookmarked: _o, ...rest } = filters;
    if (rest.archived === undefined || rest.archived === "") rest.archived = "false";
    rest.website_id = websiteId;
    return rest;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, websiteId]);

  const tendersQuery = useTenders(apiFilters);
  const orgsQuery = useOrganizations({ website_id: apiFilters.website_id, q: apiFilters.q });

  const onChange = useCallback((patch: Record<string, string>) => {
    const next: Record<string, string> = { ...filters };
    Object.entries(patch).forEach(([key, value]) => {
      if (value) next[key] = value; else delete next[key];
    });
    router.setParams(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const filterFn = useCallback((t: any) => {
    if (bookmarkedOnly && !isBookmarked(t.id)) return false;
    if (closingSoon) {
      const { totalDays, expired } = timeRemaining(t.closing_date);
      if (expired || totalDays == null || totalDays > 5) return false;
    }
    for (const key of customFilters) if (!customFilterPass(t, key)) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarkedOnly, closingSoon, customFilters.join(",")]);

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Tenders" />
      <SiteScope
        websiteId={apiFilters.website_id}
        onChange={(id) => {
          setRaw("bm.tendersLastWebsiteId", id);
          onChange({ website_id: id });
        }}
      />
      <View className="px-4 pb-1">
        <SegmentedControl
          value={view}
          onChange={(v) => {
            setRaw("bm.tendersLastView", v);
            onChange({ view: v === "tenders" ? "" : v });
          }}
          options={[{ value: "orgs", label: "Organisations" }, { value: "tenders", label: "Tenders" }]}
        />
      </View>
      {view === "tenders" && (
        <View className="flex-1">
          <TenderFilterBar
            q={filters.q}
            onSearch={(q) => onChange({ q })}
            bookmarkedOnly={bookmarkedOnly}
            onToggleBookmarked={(v) => onChange({ bookmarked_only: v ? "1" : "" })}
            closingSoon={closingSoon}
            onToggleClosingSoon={(v) => onChange({ closing5: v ? "1" : "" })}
            customFilters={customFilters}
            onAddCustom={(key) => onChange({ custom: [...customFilters, key].join(",") })}
            onRemoveCustom={(key) => onChange({ custom: customFilters.filter((k) => k !== key).join(",") })}
            rows={rows}
            onOpenAdvanced={() => setSheetOpen(true)}
          />
          <TenderList query={tendersQuery} filterFn={filterFn} onRowsChange={setRows} />
          <TenderFilterSheet open={sheetOpen} onClose={() => setSheetOpen(false)} filters={filters} onApply={onChange} />
        </View>
      )}
      {view === "orgs" && (
        <OrganizationList
          query={orgsQuery}
          bookmarkedOnly={orgBookmarkedOnly}
          onToggleBookmarked={(v) => onChange({ org_bookmarked: v ? "1" : "" })}
        />
      )}
    </View>
  );
}
