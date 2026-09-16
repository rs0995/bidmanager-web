import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, Linking } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Star, ExternalLink, Plus, DownloadCloud } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { FieldRow } from "@/components/tender/FieldRow";
import { DocumentRow } from "@/components/tender/DocumentRow";
import { RequestDownloadPanel } from "@/components/tender/RequestDownloadPanel";
import { SkeletonList } from "@/components/feedback/Skeleton";
import { ErrorState } from "@/components/feedback/ErrorState";
import { useTender } from "@/hooks/useTender";
import { useTenderDocuments } from "@/hooks/useTenderDocuments";
import { useBookmarkToggle } from "@/hooks/useBookmarks";
import { fmtINR, formatDate, formatDateTimeIST, timeRemaining, urgency } from "@/lib/format";
import { useToast } from "@/components/feedback/ToastProvider";
import { createProjectFromTender } from "@/lib/projects";
import { syncTenderDocuments, downloadAllForTender } from "@/lib/documents";
import { useThemeColors, urgencyColor, hexToRgba } from "@/constants/colors";

export default function TenderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: tender, isLoading, isError, error, refetch } = useTender(id);
  const { data: docsPage } = useTenderDocuments(id);
  const { isBookmarked, toggle } = useBookmarkToggle();
  const toast = useToast();
  const colors = useThemeColors();
  const [downloadingAll, setDownloadingAll] = useState(false);

  useEffect(() => {
    if (tender && docsPage?.items?.length) syncTenderDocuments(tender, docsPage.items);
  }, [tender, docsPage]);

  if (isLoading) {
    return <View className="flex-1 bg-bg"><ScreenHeader title="Tender" back /><SkeletonList /></View>;
  }
  if (isError || !tender) {
    return <View className="flex-1 bg-bg"><ScreenHeader title="Tender" back /><ErrorState message={error?.message} onRetry={refetch} /></View>;
  }

  const bookmarked = isBookmarked(tender.id);
  const documents = docsPage?.items || [];
  const { totalDays, label, expired } = timeRemaining(tender.closing_date);
  const u = urgency(totalDays);
  const color = urgencyColor(u.key, colors);

  const handleToggle = () => {
    const nowOn = toggle(tender.id);
    if (nowOn) {
      toast?.push({
        title: "Bookmarked",
        body: "This also keeps its documents updated automatically (a recurring background check every few hours).",
      });
    }
  };

  const handleAddToProject = () => {
    const project = createProjectFromTender(tender);
    toast?.push({
      title: "Project created",
      body: `"${project.title}" added with a Ready Docs checklist.`,
      action: { label: "View project", onClick: () => router.push(`/projects/${project.id}` as any) },
    });
  };

  const handleDownloadAll = async () => {
    setDownloadingAll(true);
    try {
      const { ok, failed, total } = await downloadAllForTender(tender);
      if (!total) toast?.push({ title: "Nothing to download", body: "No downloadable files for this tender yet.", type: "info" });
      else if (failed) toast?.push({ title: `Downloaded ${ok} of ${total}`, body: `${failed} failed.`, type: "error" });
      else toast?.push({ title: `Downloaded ${ok} file${ok === 1 ? "" : "s"}` });
    } catch (e: any) {
      toast?.push({ title: "Download failed", body: e?.message, type: "error" });
    } finally {
      setDownloadingAll(false);
    }
  };

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Tender detail" back />
      <ScrollView contentContainerClassName="p-4">
        <Text className="font-mono text-[13px] font-bold" style={{ color: colors.accentHover }}>{tender.tender_id}</Text>
        <Text className="mt-1 mb-2 text-lg font-bold leading-snug text-text">{tender.title}</Text>
        <View className="flex-row gap-2 mb-4">
          <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: expired ? colors.surface2 : hexToRgba(color, 0.16) }}>
            <Text className="text-xs font-semibold" style={{ color: expired ? colors.textMuted : color }}>
              {expired ? "Closed" : label}
            </Text>
          </View>
        </View>

        <View className="bg-surface-0 border border-border rounded-[14px] mb-4 overflow-hidden">
          <View className="flex-row border-b border-border">
            <View className="w-1/2 py-2.5 px-3 border-r border-border">
              <Text className="text-[14px] text-text-muted">Tender value</Text>
              <Text className="mt-1 text-sm font-medium text-text">{fmtINR(tender.tender_value)}</Text>
            </View>
            <View className="w-1/2 py-2.5 px-3">
              <Text className="text-[14px] text-text-muted">EMD</Text>
              <Text className="mt-1 text-sm font-medium text-text">{fmtINR(tender.emd)}</Text>
            </View>
          </View>
          <View className="flex-row border-b border-border">
            <View className="w-1/2 py-2.5 px-3 border-r border-border">
              <Text className="text-[14px] text-text-muted">Category</Text>
              <Text className="mt-1 text-sm font-medium text-text">{tender.category || "—"}</Text>
            </View>
            <View className="w-1/2 py-2.5 px-3">
              <Text className="text-[14px] text-text-muted">Location</Text>
              <Text className="mt-1 text-sm font-medium text-text">{tender.location || "—"}</Text>
            </View>
          </View>
          <View className="flex-row border-b border-border">
            <View className="w-1/2 py-2.5 px-3 border-r border-border">
              <Text className="text-[14px] text-text-muted">Published date</Text>
              <Text className="mt-1 text-sm font-medium text-text">{formatDate(tender.published_date)}</Text>
            </View>
            <View className="w-1/2 py-2.5 px-3">
              <Text className="text-[14px] text-text-muted">Bid opening date</Text>
              <Text className="mt-1 text-sm font-medium text-text">{formatDate(tender.opening_date)}</Text>
            </View>
          </View>
          <View className="px-3">
            <FieldRow stacked label="Closing" value={formatDateTimeIST(tender.closing_date)} />
            <FieldRow stacked label="Pre-bid meeting" value={formatDate(tender.pre_bid_meeting_date)} />
            <FieldRow stacked label="Organisation chain" value={tender.organization} />
          </View>
        </View>

        <View className="gap-2 mb-4">
          <Pressable
            className="rounded-[11px] min-h-11 flex-row items-center justify-center gap-1.5"
            style={{
              borderWidth: 1.5,
              borderColor: bookmarked ? colors.warn : colors.accent,
              backgroundColor: bookmarked ? colors.warn : colors.surface0,
            }}
            onPress={handleToggle}
          >
            <Star size={15} color={bookmarked ? "#fff" : colors.accent} fill={bookmarked ? "#fff" : "none"} />
            <Text className="text-sm font-semibold" style={{ color: bookmarked ? "#fff" : colors.accent }}>
              {bookmarked ? "Bookmarked" : "Bookmark"}
            </Text>
          </Pressable>
          <View className="flex-row gap-2">
            <Pressable
              className="flex-1 rounded-[11px] min-h-11 flex-row items-center justify-center gap-1.5 bg-surface-2 border border-border"
              onPress={handleAddToProject}
            >
              <Plus size={15} color={colors.text} />
              <Text className="text-text text-sm font-semibold">Add to Projects</Text>
            </Pressable>
            {tender.tender_url ? (
              <Pressable
                className="flex-1 rounded-[11px] min-h-11 flex-row items-center justify-center gap-1.5 bg-surface-2 border border-border"
                onPress={() => Linking.openURL(tender.tender_url)}
              >
                <ExternalLink size={15} color={colors.text} />
                <Text className="text-text text-sm font-semibold">Open on portal</Text>
              </Pressable>
            ) : <View className="flex-1" />}
          </View>
        </View>

        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-sm font-semibold text-text">
            Published documents{documents.length ? ` (${documents.length})` : ""}
          </Text>
          {documents.length > 0 && (
            <Pressable
              className="px-2.5 py-1.5 rounded-lg flex-row items-center gap-1.5 bg-accent-bg"
              onPress={handleDownloadAll}
              disabled={downloadingAll}
            >
              <DownloadCloud size={13} color={colors.accent} />
              <Text className="text-xs font-semibold text-accent">{downloadingAll ? "Downloading…" : "Download all"}</Text>
            </Pressable>
          )}
        </View>
        {documents.length > 0 ? (
          <View className="bg-surface-0 border border-border rounded-[14px] p-3 mb-4">
            {documents.map((doc: any) => <DocumentRow key={doc.id} tenderId={tender.id} doc={doc} />)}
          </View>
        ) : (
          <View className="mb-4"><RequestDownloadPanel tender={tender} /></View>
        )}
      </ScrollView>
    </View>
  );
}
