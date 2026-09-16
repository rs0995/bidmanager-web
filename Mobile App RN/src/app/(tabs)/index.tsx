import { useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Globe, FolderOpen, Clock, RefreshCw } from "lucide-react-native";
import { StatCard } from "@/components/dashboard/StatCard";
import { BookmarksStatCard } from "@/components/dashboard/BookmarksStatCard";
import { NeedsAttentionCard } from "@/components/dashboard/NeedsAttentionCard";
import { DeadlineGroups } from "@/components/dashboard/DeadlineGroups";
import { SkeletonList } from "@/components/feedback/Skeleton";
import { ErrorState } from "@/components/feedback/ErrorState";
import { Button } from "@/components/common/Button";
import { SpinningIcon } from "@/components/common/SpinningIcon";
import { useStats } from "@/hooks/useStats";
import { useBookmarkToggle, useBookmarkedTenders, useOrgBookmarkToggle } from "@/hooks/useBookmarks";
import { useProjects } from "@/lib/projects";
import { useSettings } from "@/lib/store";
import { syncNow } from "@/lib/sync";
import { fmtINR, timeRemaining, parseINR } from "@/lib/format";
import { useToast } from "@/components/feedback/ToastProvider";
import { useThemeColors } from "@/constants/colors";

const STALE_MS = 30 * 60 * 1000;

export default function OverviewScreen() {
  const { data: stats, isLoading, isError, error, refetch } = useStats();
  const { bookmarkedIds } = useBookmarkToggle();
  const { bookmarkedOrgNames } = useOrgBookmarkToggle();
  const { tenders: trackedTenders } = useBookmarkedTenders();
  const projects = useProjects();
  const { lastSyncAt } = useSettings();
  const toast = useToast();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [syncing, setSyncing] = useState(false);

  const activeProjects = projects.filter((p: any) => p.status !== "Archived");
  const pipelineValue = activeProjects.reduce((sum: number, p: any) => sum + parseINR(p.project_value), 0);
  const [pipelineAmount, pipelineUnit] = fmtINR(pipelineValue).split(" ");
  const closingThisWeek = trackedTenders.filter((t: any) => {
    const { totalDays, expired } = timeRemaining(t.closing_date);
    return !expired && totalDays != null && totalDays <= 7;
  }).length;

  const isStale = !lastSyncAt || (Date.now() - new Date(lastSyncAt).getTime()) > STALE_MS;

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncNow();
      await refetch();
      toast?.push({ title: "Sync complete" });
    } catch (e: any) {
      toast?.push({ title: "Sync failed", body: e?.message, type: "error" });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerClassName="p-4" contentContainerStyle={{ paddingTop: insets.top + 16 }}>
        <Text className="text-2xl text-text mb-4" style={{ fontFamily: "BricolageGrotesque_700Bold" }}>Overview</Text>
        {isLoading && <SkeletonList count={2} />}
        {isError && <ErrorState message={error?.message} onRetry={refetch} />}
        {stats && (
          <>
            <NeedsAttentionCard />

            <View className="flex-row flex-wrap gap-3 mb-4">
              <View className="flex-1 basis-[47%]">
                <StatCard icon={Globe} label="Tenders synced" value={stats.active_tenders} to="/tenders" variant="accent" />
              </View>
              <View className="flex-1 basis-[47%]">
                <StatCard icon={FolderOpen} label="Active projects" value={activeProjects.length} to="/projects" variant="ok" />
              </View>
              <View className="flex-1 basis-[47%]">
                <BookmarksStatCard orgCount={bookmarkedOrgNames.size} tenderCount={bookmarkedIds.size} to="/bookmarks" />
              </View>
              <View className="flex-1 basis-[47%]">
                <StatCard
                  icon={Clock}
                  label="Closing this week"
                  value={closingThisWeek}
                  to="/tenders?closing5=1"
                  variant="danger"
                />
              </View>
            </View>

            <View className="bg-surface-0 border border-border rounded-[19px] p-4 mb-4">
              <View className="flex-row items-center justify-between gap-2 mb-2">
                <Text className="flex-1 text-sm font-semibold text-text" numberOfLines={1}>
                  Pipeline value — bids in preparation
                </Text>
                <View className="rounded-full bg-surface-2 px-3 py-1.5">
                  <Text className="text-[14px] text-text-muted">{activeProjects.length} projects</Text>
                </View>
              </View>
              <Text className="text-[29px] text-text" style={{ letterSpacing: -0.5, fontFamily: "BricolageGrotesque_700Bold" }}>
                {pipelineAmount}
                {pipelineUnit ? <Text className="text-[14px] font-medium text-text-muted"> {pipelineUnit}</Text> : null}
              </Text>
            </View>

            <View
              className="rounded-[19px] p-4 mb-4 flex-row items-center gap-3"
              style={{
                backgroundColor: isStale ? colors.accentBg : colors.surface1,
                borderWidth: 1,
                borderColor: isStale ? colors.accent : colors.border,
              }}
            >
              <View className="flex-1">
                <Text className="text-sm font-semibold" style={{ color: isStale ? colors.accent : colors.text }}>
                  {isStale ? "Sync tenders" : "Up to date"}
                </Text>
                <Text className="mt-0.5 text-[14px] text-text-muted">
                  {lastSyncAt
                    ? `Last synced ${new Date(lastSyncAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
                    : "Never synced yet"}
                </Text>
              </View>
              <Button onPress={handleSync} disabled={syncing}>
                <View className="flex-row items-center gap-1.5">
                  <SpinningIcon spinning={syncing}>
                    <RefreshCw size={14} color="#fff" />
                  </SpinningIcon>
                  <Text className="text-white text-sm font-semibold">{syncing ? "Syncing…" : "Sync now"}</Text>
                </View>
              </Button>
            </View>

            <DeadlineGroups />
          </>
        )}
      </ScrollView>
    </View>
  );
}
