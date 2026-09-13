import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Paperclip, Check, X } from "lucide-react-native";
import { cn } from "@/lib/cn";
import { attachFile, removeAttachment, getAttachedFile, deleteChecklistItem } from "@/lib/projects";
import { Sheet } from "@/components/common/Sheet";
import { Button } from "@/components/common/Button";
import { useThemeColors } from "@/constants/colors";

export function ChecklistItem({ item, onPreview }: { item: any; onPreview: (item: any) => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const colors = useThemeColors();
  const hasFile = Boolean(item.attachment);
  const done = item.status === "Completed";
  const attachedThisSession = hasFile && Boolean(getAttachedFile(item.id));

  const pick = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (asset) attachFile(item.id, asset);
  };

  return (
    <Pressable
      className={cn("bg-surface-0 border border-border rounded-[14px] p-3 mb-2 flex-row gap-3 items-start")}
      style={hasFile ? { backgroundColor: colors.surface1 } : undefined}
      onPress={() => { if (attachedThisSession) onPreview(item); }}
    >
      <View
        className="w-[18px] h-[18px] rounded-md border items-center justify-center mt-0.5"
        style={{ backgroundColor: done ? colors.ok : "transparent", borderColor: done ? colors.ok : colors.border }}
      >
        {done && <Check size={12} color="#fff" />}
      </View>
      <View className="flex-1">
        <Text className="text-sm font-medium text-text">{item.req_file_name}</Text>
        {item.description && <Text className="mt-0.5 text-xs text-text-muted">{item.description}</Text>}
        {hasFile && (
          <View className="flex-row items-center gap-2 mt-1 flex-wrap">
            <Paperclip size={11} color={colors.accent} />
            <Text className="text-xs font-medium text-accent" numberOfLines={1} style={{ maxWidth: 150 }}>
              {item.attachment.name}
            </Text>
            <Text className="text-xs text-text-muted">
              {attachedThisSession ? "tap to preview" : "attached on another session/device"}
            </Text>
            <Pressable onPress={() => removeAttachment(item.id)}>
              <Text className="text-xs font-semibold text-danger">Remove</Text>
            </Pressable>
          </View>
        )}
      </View>
      <Pressable
        className="px-2.5 py-1.5 rounded-lg"
        style={{ backgroundColor: hasFile ? colors.accentBg : colors.accentBg }}
        onPress={pick}
      >
        <Text className="text-xs font-semibold" style={{ color: hasFile ? colors.ok : colors.accent }}>
          {hasFile ? "Attached" : "Attach"}
        </Text>
      </Pressable>
      <Pressable className="p-1" onPress={() => setConfirmDelete(true)} accessibilityLabel="Delete item">
        <X size={16} color={colors.danger} />
      </Pressable>

      <Sheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete checklist item?"
        footer={(
          <>
            <Button variant="secondary" className="flex-1" onPress={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" className="flex-1" onPress={() => { deleteChecklistItem(item.id); setConfirmDelete(false); }}>Delete</Button>
          </>
        )}
      >
        <Text className="text-sm text-text-muted">
          "{item.req_file_name}" and its attachment (if any) will be removed from this device and the next sync. This cannot be undone.
        </Text>
      </Sheet>
    </Pressable>
  );
}
