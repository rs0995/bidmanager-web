import { useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { router } from "expo-router";
import { Loader2, CheckCircle2, TriangleAlert, DownloadCloud, RefreshCw } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { SpinningIcon } from "@/components/common/SpinningIcon";
import { useAllDownloads, isPdfDoc, isZipDoc } from "@/lib/documents";
import { requestTenderUpdate } from "@/lib/tenderUpdates";
import { getBookmarks } from "@/lib/store";
import { getProjects } from "@/lib/projects";
import { canonTenderId, resolveTenderIds } from "@/lib/tenderKey";
import { useToast } from "@/components/feedback/ToastProvider";
import { useThemeColors } from "@/constants/colors";
import { cn } from "@/lib/cn";

const META: Record<string, { icon: any; spin?: boolean; label: string; color: "accent" | "ok" | "danger" }> = {
  requested: { icon: Loader2, spin: true, label: "Requested…", color: "accent" },
  downloading: { icon: Loader2, spin: true, label: "Downloading…", color: "accent" },
  downloaded: { icon: CheckCircle2, label: "Ready", color: "ok" },
  failed: { icon: TriangleAlert, label: "Failed", color: "danger" },
};

function relativeTime(iso?: string) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default function DownloadsScreen() {
  const rows = useAllDownloads();
  const colors = useThemeColors();
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);

  // Re-checks every bookmarked/project tender for new corrigendum or pre-bid
  // minutes right now, bypassing tenderUpdates.js 24h cooldown gate (this
  // is an explicit user action, not the passive background check) so a
  // tender whose corrigendum was issued before it was ever auto-checked
  // still gets picked up.
  const handleSync = async () => {
    setSyncing(true);
    try {
      // By portal tender id, resolved to the current rows in one call.
      const projectTenderIds = getProjects().map((p: any) => canonTenderId(p.source_tender_id)).filter(Boolean);
      const ids = [...new Set([...getBookmarks(), ...projectTenderIds])];
      let ok = 0;
      let failed = 0;
      let resolved: Record<string, any> = {};
      try { resolved = await resolveTenderIds(ids); } catch { failed = ids.length; }
      for (const id of Object.keys(resolved)) {
        try {
          const tender = resolved[id];
          // The portal no longer serves documents for a closed tender.
          if (tender.is_archived) continue;
          await new Promise<void>((resolve) => {
            requestTenderUpdate(tender, (result: any) => {
              if (result?.ok) ok += 1; else failed += 1;
              resolve();
            }).catch(() => { failed += 1; resolve(); });
          });
        } catch {
          failed += 1;
        }
      }
      if (ids.length === 0) {
        toast?.push({ title: "Nothing to sync", body: "Bookmark a tender or start a project first." });
      } else if (ok + failed === 0) {
        toast?.push({ title: "Nothing to check", body: "All bookmarked and project tenders are closed." });
      } else if (failed === 0) {
        toast?.push({ title: `Checked ${ok} tender${ok === 1 ? "" : "s"}`, body: "Any new corrigendum or pre-bid minutes have been downloaded." });
      } else {
        toast?.push({ title: `Checked ${ok + failed} tenders`, body: `${failed} failed.`, type: "error" });
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader
        title="Downloads"
        back
        actions={(
          <Pressable className="flex-row items-center gap-1.5 p-1.5" onPress={handleSync} disabled={syncing}>
            <SpinningIcon spinning={syncing}>
              <RefreshCw size={15} color={colors.accent} />
            </SpinningIcon>
            <Text className="text-xs font-semibold text-accent">{syncing ? "Syncing…" : "Sync"}</Text>
          </Pressable>
        )}
      />
      <ScrollView contentContainerClassName="p-4">
        {rows.length === 0 ? (
          <EmptyState icon={DownloadCloud} title="No downloads yet" body="Request or download tender documents and they will show up here." />
        ) : (
          <View className="bg-surface-0 border border-border rounded-[14px] p-1">
            {rows.map((d: any, i: number) => {
              const meta = META[d.client_status] || META.requested;
              const Icon = meta.icon;
              const color = colors[meta.color];
              const isOpenable = d.client_status === "downloaded" && (isPdfDoc(d) || isZipDoc(d));
              const isLast = i === rows.length - 1;
              const openDocument = () => {
                if (isPdfDoc(d)) {
                  router.push({ pathname: "/documents/[id]/view", params: { id: String(d.id) } });
                } else if (isZipDoc(d)) {
                  router.push({ pathname: "/documents/[id]/archive", params: { id: String(d.id) } });
                }
              };
              return (
                <Pressable
                  key={d.id}
                  className={cn("flex-row items-start gap-3 p-3", !isLast && "border-b border-border")}
                  onPress={openDocument}
                  disabled={!isOpenable}
                >
                  <SpinningIcon spinning={Boolean(meta.spin)}>
                    <Icon size={16} color={color} style={{ marginTop: 2 }} />
                  </SpinningIcon>
                  <View className="flex-1">
                    <Text className="text-sm text-text" numberOfLines={1}>{d.tender_title || d.tender_id || "Untitled tender"}</Text>
                    <Text className="text-[14px] text-text-muted" numberOfLines={1}>{d.file_name || "All documents"}</Text>
                    {d.client_status === "failed" && d.error && (
                      <Text className="text-xs text-danger" numberOfLines={1}>{d.error}</Text>
                    )}
                  </View>
                  <View className="items-end">
                    <Text className="text-xs font-medium" style={{ color }}>{meta.label}</Text>
                    <Text className="text-[14px] text-text-muted">
                      {relativeTime(d.downloaded_at || d.requested_at || d.updated_at)}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
