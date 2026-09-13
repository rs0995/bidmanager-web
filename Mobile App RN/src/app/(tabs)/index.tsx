import { useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { Globe, FolderOpen, Clock, IndianRupee, RefreshCw } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
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
  const [syncing, setSyncing] = useState(false);

  const activeProjects = projects.filter((p: any) => p.status !== "Archived");
  const pipelineValue = activeProjects.reduce((sum: number, p: any) => sum + parseINR(p.project_value), 0);
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
      <ScreenHeader title="Overview" />
      <ScrollView contentContainerClassName="p-4">
        {isLoading && <SkeletonList count={2} />}
        {isError && <ErrorState message={error?.message} onRetry={refetch} />}
        {stats && (
          <>
            <NeedsAttentionCard />

            <View className="flex-row flex-wrap gap-3 mb-4">
              <View className="flex-1 basis-[47%]">
                <StatCard icon={Globe} label="Tenders synced" value={stats.active_tenders} to="/tenders" />
              </View>
              <View className="flex-1 basis-[47%]">
                <StatCard icon={FolderOpen} label="Active projects" value={activeProjects.length} to="/projects" />
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
                  alert={closingThisWeek > 0}
                />
              </View>
            </View>

            <View className="bg-surface-0 border border-border rounded-[14px] p-4 mb-4">
              <View className="flex-row items-center gap-2 mb-1">
                <IndianRupee size={14} color={colors.accent} />
                <Text className="text-xs font-bold uppercase tracking-wide text-text-muted">Pipeline value</Text>
              </View>
              <Text className="text-2xl font-bold text-text">{fmtINR(pipelineValue)}</Text>
              <Text className="mt-1 text-xs text-text-muted">
                Sum of your local project values ({activeProjects.length} active)
              </Text>
            </View>

            <View
              className="rounded-2xl p-4 mb-4 flex-row items-center gap-3"
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
                <Text className="mt-0.5 text-xs text-text-muted">
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
