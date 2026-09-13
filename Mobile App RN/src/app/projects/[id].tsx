import { useState, useMemo, useEffect } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Plus, DownloadCloud, FolderOpen, Archive, ArchiveRestore } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { FieldRow } from "@/components/tender/FieldRow";
import { DocumentRow } from "@/components/tender/DocumentRow";
import { RequestDownloadPanel } from "@/components/tender/RequestDownloadPanel";
import { ChecklistItem } from "@/components/project/ChecklistItem";
import { AddChecklistItemForm } from "@/components/project/AddChecklistItemForm";
import { FilePreview } from "@/components/project/FilePreview";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Sheet } from "@/components/common/Sheet";
import { Button } from "@/components/common/Button";
import { fmtINR, formatDate, timeRemaining, urgency } from "@/lib/format";
import { useProject, useChecklist, folderNames, addChecklistItem, getAttachedFile, archiveProject, updateProject } from "@/lib/projects";
import { useTenderDocuments } from "@/hooks/useTenderDocuments";
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
  const toast = useToast();
  const colors = useThemeColors();

  const sourceTender = project?.source_tender_db_id
    ? { id: project.source_tender_db_id, tender_id: project.source_tender_id, title: project.title }
    : null;
  const { data: docsPage } = useTenderDocuments(project?.source_tender_db_id);

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
  const { totalDays, label, expired } = timeRemaining(project.deadline);
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

  const archiveButton = (
    <Pressable className="p-1.5" onPress={() => (archived ? handleUnarchive() : setConfirmArchive(true))}>
      {archived ? <ArchiveRestore size={18} color={colors.accent} /> : <Archive size={18} color={colors.textMuted} />}
    </Pressable>
  );

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
          {project.prebid && (
            <View className="px-2.5 py-1 rounded-full bg-surface-2">
              <Text className="text-xs font-medium text-text-muted">Pre-bid {formatDate(project.prebid)}</Text>
            </View>
          )}
        </View>

        <View className="bg-surface-0 border border-border rounded-[14px] p-3 mb-4 flex-row flex-wrap">
          <View className="w-1/2 pr-2"><FieldRow stacked label="Client" value={project.client_name} /></View>
          <View className="w-1/2 pl-2"><FieldRow stacked label="Project value" value={fmtINR(project.project_value)} /></View>
          <View className="w-1/2 pr-2"><FieldRow stacked label="EMD" value={fmtINR(project.emd)} /></View>
          <View className="w-1/2 pl-2"><FieldRow stacked label="Deadline" value={formatDate(project.deadline)} /></View>
          <View className="w-1/2 pr-2"><FieldRow stacked label="Status" value={project.status} /></View>
          <View className="w-1/2 pl-2"><FieldRow stacked label="Documents ready" value={`${done} / ${total}`} /></View>
        </View>
        {project.description && (
          <View className="bg-surface-0 border border-border rounded-[14px] p-3 mb-4">
            <Text className="mb-1.5 text-xs font-semibold text-text-muted">Work description</Text>
            <Text className="text-sm text-text">{project.description}</Text>
          </View>
        )}

        {sourceTender && (
          <>
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
          <Text className="text-sm font-semibold text-text">Document checklist</Text>
          <Pressable className="px-2.5 py-1.5 rounded-lg bg-accent-bg flex-row items-center gap-1" onPress={() => setShowAdd((v) => !v)}>
            <Plus size={12} color={colors.accent} />
            <Text className="text-xs font-semibold text-accent">Add item</Text>
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
              <Text className="text-xs font-semibold text-text-muted">
                🗂️ {folder} <Text className="font-medium">{items.filter((i: any) => i.status === "Completed").length}/{items.length}</Text>
              </Text>
            </View>
            {items.length === 0 ? (
              <Text className="text-xs italic text-text-muted">No items in this section yet</Text>
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
        <Text className="text-sm text-text-muted">
          "{project.title}" will move to the Archived tab in Projects. You can restore it from there at any time.
        </Text>
      </Sheet>
    </View>
  );
}
