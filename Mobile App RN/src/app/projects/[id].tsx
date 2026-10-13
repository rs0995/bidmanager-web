import { useState, useMemo, useEffect } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Plus, DownloadCloud, FolderOpen, Archive, ArchiveRestore, Trash2 } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { DocumentRow } from "@/components/tender/DocumentRow";
import { RequestDownloadPanel } from "@/components/tender/RequestDownloadPanel";
import { ChecklistItem } from "@/components/project/ChecklistItem";
import { AddChecklistItemForm } from "@/components/project/AddChecklistItemForm";
import { FilePreview } from "@/components/project/FilePreview";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Sheet } from "@/components/common/Sheet";
import { Button } from "@/components/common/Button";
import { fmtINR, formatDate, formatDateTime, timeRemaining, urgency } from "@/lib/format";
import { useProject, useChecklist, folderNames, addChecklistItem, getAttachedFile, archiveProject, deleteProject, updateProject } from "@/lib/projects";
import { useTenderDocuments } from "@/hooks/useTenderDocuments";
import { useLinkedTender } from "@/hooks/useLinkedTender";
import { useTenderDocActions } from "@/hooks/useTenderDocActions";
import { syncTenderDocuments, downloadAllForTender } from "@/lib/documents";
import { useToast } from "@/components/feedback/ToastProvider";
import { useThemeColors, urgencyColor, hexToRgba } from "@/constants/colors";

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = useProject(id);
  const checklist = useChecklist(id);
  const [showAdd, setShowAdd] = useState(false);
  const [previewItem, setPreviewItem] = useState<any>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toast = useToast();
  const colors = useThemeColors();

  // Live tender behind this project (null if unlinked / not loaded yet): its
  // deadline, pre-bid, corrigenda and documents override the creation-time
  // snapshot so changes show up here automatically.
  const liveTender = useLinkedTender(project);
  const linkedId = liveTender?.id ?? project?.source_tender_db_id ?? null;
  const sourceTender = liveTender
    || (linkedId
      ? { id: linkedId, tender_id: project?.source_tender_id, title: project?.title }
      : null);
  const { data: docsPage } = useTenderDocuments(linkedId);
  const { syncButton, reDownloadBanner } = useTenderDocActions(liveTender, docsPage?.items || []);

  useEffect(() => {
    if (sourceTender && docsPage?.items?.length) syncTenderDocuments(sourceTender, docsPage.items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceTender?.id, docsPage]);

  const folders = project ? folderNames(project.id) : [];
  const grouped = useMemo(() => {
    if (!project) return [];
    const map = new Map<string, any[]>(folders.map((f) => [f, []]));
    checklist.forEach((item: any) => {
      if (!map.has(item.subfolder)) map.set(item.subfolder, []);
      map.get(item.subfolder)!.push(item);
    });
    return [...map.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, checklist, folders.join(",")]);

  if (!project) {
    return (
      <View className="flex-1 bg-bg">
        <ScreenHeader title="Project" back />
        <EmptyState icon={FolderOpen} title="Project not found" />
      </View>
    );
  }

  const done = checklist.filter((i: any) => i.status === "Completed").length;
  const total = checklist.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const deadline = liveTender?.closing_date || project.deadline;
  const prebid = liveTender?.pre_bid_meeting_date || project.prebid;
  const { totalDays, label, expired } = timeRemaining(deadline);
  const u = urgency(totalDays);
  const color = urgencyColor(u.key, colors);
  const documents = docsPage?.items || [];

  const handleDownloadAll = async () => {
    if (!sourceTender) return;
    setDownloadingAll(true);
    try {
      const { ok, failed, total } = await downloadAllForTender(sourceTender);
      if (!total) toast?.push({ title: "Nothing to download", body: "No downloadable files for this tender yet.", type: "info" });
      else if (failed) toast?.push({ title: `Downloaded ${ok} of ${total}`, body: `${failed} failed.`, type: "error" });
      else toast?.push({ title: `Downloaded ${ok} file${ok === 1 ? "" : "s"}` });
    } catch (e: any) {
      toast?.push({ title: "Download failed", body: e?.message, type: "error" });
    } finally {
      setDownloadingAll(false);
    }
  };

  const archived = project.status === "Archived";
  const handleUnarchive = () => {
    updateProject(project.id, { status: "Active" });
    toast?.push({ title: "Project restored to Active" });
  };
  const handleArchive = () => {
    archiveProject(project.id);
    setConfirmArchive(false);
    toast?.push({ title: "Project archived" });
    router.replace("/projects" as any);
  };

  const handleDelete = () => {
    setConfirmDelete(false);
    router.replace("/projects" as any);
    deleteProject(project.id);
    toast?.push({ title: "Project deleted" });
  };

  const archiveButton = (
    <>
    {syncButton}
    <Pressable className="p-1.5" onPress={() => (archived ? handleUnarchive() : setConfirmArchive(true))}>
      {archived ? <ArchiveRestore size={18} color={colors.accent} /> : <Archive size={18} color={colors.textMuted} />}
    </Pressable>
    {archived && (
      <Pressable className="p-1.5" onPress={() => setConfirmDelete(true)}>
        <Trash2 size={18} color={colors.danger} />
      </Pressable>
    )}
    </>
  );

  const detailCells: { label: string; value: any }[] = [
    { label: "Client", value: liveTender?.organization || project.client_name },
    { label: "Project value", value: fmtINR(liveTender?.tender_value || project.project_value) },
    { label: "EMD", value: fmtINR(liveTender?.emd || project.emd) },
    { label: "Deadline", value: formatDate(deadline) },
    { label: "Status", value: project.status },
    { label: "Documents ready", value: `${done} / ${total}` },
    ...(liveTender ? [
      { label: "Corrigenda", value: String(liveTender.corrigendum_count ?? 0) },
      { label: "Pre-bid meeting", value: formatDateTime(prebid) },
    ] : []),
  ];
  const detailRows: { label: string; value: any }[][] = [];
  for (let i = 0; i < detailCells.length; i += 2) detailRows.push(detailCells.slice(i, i + 2));

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Project" back actions={archiveButton} />
      <ScrollView contentContainerClassName="p-4">
        <Text className="font-mono text-xs text-accent">{project.source_tender_id || `P-${project.id}`}</Text>
        <Text className="mt-1.5 mb-2 text-lg font-bold leading-snug text-text">{project.title}</Text>
        <View className="flex-row items-center gap-3 mb-3">
          <View className="flex-1 h-2 rounded-full overflow-hidden bg-surface-2">
            <View className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
          </View>
          <Text className="font-mono text-sm font-bold text-text">{pct}%</Text>
        </View>
        <View className="flex-row gap-2 mb-4">
          <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: expired ? colors.surface2 : hexToRgba(color, 0.16) }}>
            <Text className="text-xs font-semibold" style={{ color: expired ? colors.textMuted : color }}>
              Due {expired ? "past" : label}
            </Text>
          </View>
          {prebid && (
            <View className="px-2.5 py-1 rounded-full bg-surface-2">
              <Text className="text-[14px] font-medium text-text-muted">Pre-bid {formatDate(prebid)}</Text>
            </View>
          )}
        </View>

        {/* The row owns the divider, so it sits at one height across both
            columns even when one cell wraps to more lines than the other. */}
        <View className="bg-surface-0 border border-border rounded-[14px] px-3 py-0.5 mb-4">
          {detailRows.map((pair, rowIndex) => (
            <View
              key={pair[0].label}
              className={`flex-row${rowIndex === detailRows.length - 1 ? "" : " border-b border-border"}`}
            >
              {pair.map((cell, i) => (
                <View key={cell.label} className={`flex-1 py-2.5 ${i === 0 ? "pr-2" : "pl-2"}`}>
                  <Text className="text-[14px] text-text-muted">{cell.label}</Text>
                  <Text className="mt-1 text-sm font-medium text-text">{cell.value == null || cell.value === "" ? "—" : cell.value}</Text>
                </View>
              ))}
              {pair.length === 1 && <View className="flex-1" />}
            </View>
          ))}
        </View>
        {project.description && (
          <View className="bg-surface-0 border border-border rounded-[14px] p-3 mb-4">
            <Text className="mb-1.5 text-[14px] font-semibold text-text-muted">Work description</Text>
            <Text className="text-sm text-text">{project.description}</Text>
          </View>
        )}

        {sourceTender && (
          <>
            {reDownloadBanner}
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
                {documents.map((doc: any) => <DocumentRow key={doc.id} tenderId={sourceTender.id} doc={doc} />)}
              </View>
            ) : (
              <View className="mb-4"><RequestDownloadPanel tender={sourceTender} /></View>
            )}
          </>
        )}

        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-[17px] font-semibold text-text">Document checklist</Text>
          <Pressable className="px-2.5 py-1.5 rounded-lg bg-accent-bg flex-row items-center gap-1" onPress={() => setShowAdd((v) => !v)}>
            <Plus size={14} color={colors.accent} />
            <Text className="text-[14px] font-semibold text-accent">Add item</Text>
          </Pressable>
        </View>
        {showAdd && (
          <AddChecklistItemForm
            folders={folders}
            onCancel={() => setShowAdd(false)}
            onAdd={(data) => { addChecklistItem(project.id, data); setShowAdd(false); }}
          />
        )}

        {grouped.map(([folder, items]) => (
          <View key={folder} className="mb-4">
            <View className="flex-row items-center gap-2 mb-2">
              <Text className="text-[14px] font-semibold text-text-muted">
                🗂️ {folder} <Text className="font-medium">{items.filter((i: any) => i.status === "Completed").length}/{items.length}</Text>
              </Text>
            </View>
            {items.length === 0 ? (
              <Text className="text-[14px] italic text-text-muted">No items in this section yet</Text>
            ) : items.map((item: any) => (
              <ChecklistItem key={item.id} item={item} onPreview={() => setPreviewItem(item)} />
            ))}
          </View>
        ))}
      </ScrollView>

      {previewItem && (
        <FilePreview file={getAttachedFile(previewItem.id)} onClose={() => setPreviewItem(null)} />
      )}

      <Sheet
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title="Archive this project?"
        footer={(
          <>
            <Button variant="secondary" className="flex-1" onPress={() => setConfirmArchive(false)}>Cancel</Button>
            <Button variant="danger" className="flex-1" onPress={handleArchive}>Archive</Button>
          </>
        )}
      >
        <Text className="text-[14px] text-text-muted">
          "{project.title}" will move to the Archived tab in Projects. You can restore it from there at any time.
        </Text>
      </Sheet>

      <Sheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this project?"
        footer={(
          <>
            <Button variant="secondary" className="flex-1" onPress={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" className="flex-1" onPress={handleDelete}>Delete</Button>
          </>
        )}
      >
        <Text className="text-[14px] text-text-muted">
          "{project.title}" and its checklist will be removed from your account on every device. This can't be undone.
        </Text>
      </Sheet>
    </View>
  );
}
