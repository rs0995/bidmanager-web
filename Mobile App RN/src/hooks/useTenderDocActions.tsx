import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { RefreshCw, TriangleAlert } from "lucide-react-native";
import { SpinningIcon } from "@/components/common/SpinningIcon";
import { useToast } from "@/components/feedback/ToastProvider";
import { useDocumentsForTender, isCorruptDownload, requestTenderDownload } from "@/lib/documents";
import { getTenderSyncGate, getLastCheckedAt, requestTenderUpdate, useTenderUpdatePending } from "@/lib/tenderUpdates";
import { getStatusSyncGate, requestTenderStatusFetch, useTenderStatusPending } from "@/lib/tenderStatus";
import { queryClient } from "@/lib/queryClient";
import { api } from "@/lib/api";
import { useThemeColors, hexToRgba } from "@/constants/colors";

function formatDateTime(ms: number | null | undefined) {
  if (!ms) return "an unknown time";
  return new Date(ms).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// Shared by the tender detail and project detail screens: the header "check
// for updates" icon and the "files look corrupted -> Re-download" banner.
// `tender` is the live tender payload (undefined while loading / unlinked) and
// `documents` the server's document list for it.
export function useTenderDocActions(tender: any, documents: any[]) {
  const toast = useToast();
  const colors = useThemeColors();
  const tenderId = Number(tender?.id);
  const [startingUpdate, setStartingUpdate] = useState(false);
  const [reDownloading, setReDownloading] = useState(false);
  const localDocs = useDocumentsForTender(tenderId);
  const updatePending = useTenderUpdatePending(tenderId);
  const statusPending = useTenderStatusPending(tenderId);
  // Archived (closed) tenders sync their portal status + result files instead of
  // checking for new tender documents.
  const archived = Boolean(tender?.is_archived);

  const hasCorruptDocs = localDocs.some((r: any) => isCorruptDownload(r));
  const syncBusy = (archived ? statusPending : updatePending) || startingUpdate;

  const noUpdates = (lastCheckedAt: number | null) => toast?.push({
    title: "No Updates Available",
    body: `Last checked on ${formatDateTime(lastCheckedAt)}.`,
    type: "info",
  });

  const handleSyncUpdates = async () => {
    if (!tender || syncBusy) return;
    setStartingUpdate(true);
    try {
      // Fresh copy, not the cached one: carries the server's last-checked time.
      const fresh: any = await queryClient.fetchQuery({
        queryKey: ["tender", tenderId],
        queryFn: () => api.tender(tenderId),
        staleTime: 0,
      });
      const gate = getTenderSyncGate(fresh);
      if (!gate.allowed) {
        noUpdates(getLastCheckedAt(fresh));
        return;
      }
      await requestTenderUpdate(fresh, (result: any) => {
        if (!result.ok) {
          toast?.push({ title: "Update check failed", body: result.error, type: "error" });
        } else if (result.newDocuments > 0) {
          toast?.push({
            title: `${result.newDocuments} new document${result.newDocuments === 1 ? "" : "s"}`,
            body: "They're listed below — download to save them to this device.",
          });
        } else {
          noUpdates(result.lastCheckedAt);
        }
      });
      toast?.push({
        title: "Checking the portal",
        body: "Looking for new corrigendum or pre-bid files — this can take a few minutes.",
        type: "info",
      });
    } catch (e: any) {
      toast?.push({ title: "Could not check for updates", body: e?.message, type: "error" });
    } finally {
      setStartingUpdate(false);
    }
  };

  const handleStatusSync = async () => {
    if (!tender || syncBusy) return;
    setStartingUpdate(true);
    try {
      const fresh: any = await queryClient.fetchQuery({
        queryKey: ["tender", tenderId],
        queryFn: () => api.tender(tenderId),
        staleTime: 0,
      });
      const gate = getStatusSyncGate(fresh);
      if (!gate.allowed) {
        toast?.push({
          title: fresh.status ? `Status unchanged: ${fresh.status}` : "No status update available",
          body: `Last checked on ${formatDateTime(gate.lastCheckedAt)}.`,
          type: "info",
        });
        return;
      }
      const resultsBefore = documents.filter((d: any) => d.type === "result").length;
      await requestTenderStatusFetch(fresh, (result: any) => {
        if (!result.ok) {
          toast?.push({ title: "Status check failed", body: result.error, type: "error" });
          return;
        }
        const newFiles = Math.max(0, result.resultFiles - resultsBefore);
        if (!result.status) {
          toast?.push({ title: "No status found", body: "The portal did not return a status for this tender yet.", type: "info" });
        } else if (result.statusChanged || newFiles > 0) {
          toast?.push({
            title: `Status: ${result.status}`,
            body: newFiles > 0
              ? `${newFiles} new status file${newFiles === 1 ? "" : "s"} available to download.`
              : "The tender status was updated.",
          });
        } else {
          toast?.push({
            title: `Status unchanged: ${result.status}`,
            body: `Last checked on ${formatDateTime(result.lastCheckedAt)}.`,
            type: "info",
          });
        }
      });
      toast?.push({
        title: "Fetching status",
        body: "The server is checking the portal for this tender's current status — this can take a few minutes.",
        type: "info",
      });
    } catch (e: any) {
      toast?.push({ title: "Could not fetch status", body: e?.message, type: "error" });
    } finally {
      setStartingUpdate(false);
    }
  };

  const handleReDownload = async () => {
    if (!tender || reDownloading) return;
    setReDownloading(true);
    try {
      const row: any = await requestTenderDownload(tender, "redownload");
      toast?.push(row.created
        ? {
            title: "Re-download started",
            body: "A new download job was sent to the server for this tender — this can take a few minutes.",
            type: "info",
          }
        : {
            title: "Already in progress",
            body: "The server is already running a download job for this tender. It will refresh when that finishes.",
            type: "info",
          });
    } catch (e: any) {
      toast?.push({ title: "Could not start re-download", body: e?.message, type: "error" });
    } finally {
      setReDownloading(false);
    }
  };

  // Shown once the tender's documents have been downloaded from the portal at
  // least once -- i.e. the server has a document list, so the first-time
  // "Request download" panel is no longer displayed. Whether this phone has
  // saved the files locally doesn't matter.
  const showSync = Boolean(tender) && (archived ? true : (documents.length > 0 || updatePending));

  const syncButton = showSync ? (
    <Pressable
      className="p-1.5"
      style={{ opacity: syncBusy ? 0.6 : 1 }}
      onPress={archived ? handleStatusSync : handleSyncUpdates}
      disabled={syncBusy}
      accessibilityLabel={archived ? "Fetch tender status" : "Check for document updates"}
    >
      <SpinningIcon spinning={syncBusy}>
        <RefreshCw size={18} color={colors.accent} />
      </SpinningIcon>
    </Pressable>
  ) : undefined;

  const reDownloadBanner = hasCorruptDocs ? (
    <View
      className="flex-row items-center gap-2 p-3 rounded-[12px] mb-3"
      style={{ backgroundColor: hexToRgba(colors.warn, 0.14), borderWidth: 1, borderColor: colors.warn }}
    >
      <TriangleAlert size={16} color={colors.warn} />
      <Text className="flex-1 text-xs" style={{ color: colors.warn }}>
        Some downloaded files look incomplete or corrupted.
      </Text>
      <Pressable
        className="px-2.5 py-1.5 rounded-lg"
        style={{ backgroundColor: colors.warn }}
        onPress={handleReDownload}
        disabled={reDownloading}
      >
        <Text className="text-xs font-semibold text-white">{reDownloading ? "Starting…" : "Re-download"}</Text>
      </Pressable>
    </View>
  ) : null;

  return { syncButton, reDownloadBanner, hasCorruptDocs };
}
