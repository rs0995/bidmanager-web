import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { FileText, File as FileIcon, PackageOpen } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { getDocument, listZipEntries } from "@/lib/documents";
import { formatBytes } from "@/lib/format";
import { useThemeColors } from "@/constants/colors";

export default function DocumentArchiveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const doc = getDocument(Number(id));
  const colors = useThemeColors();

  const [entries, setEntries] = useState<{ name: string; uri: string; size: number | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listZipEntries(doc)
      .then((list) => { if (!cancelled) setEntries(list); })
      .catch((e) => { if (!cancelled) setError(e?.message || String(e)); });
    return () => { cancelled = true; };
  }, [id]);

  const openEntry = async (entry: { name: string; uri: string }) => {
    if (/\.pdf$/i.test(entry.name)) {
      router.push({
        pathname: "/documents/[id]/view",
        params: { id, uri: encodeURIComponent(entry.uri), name: encodeURIComponent(entry.name) },
      });
      return;
    }
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(entry.uri);
  };

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title={doc?.file_name || "Archive"} back />
      {error ? (
        <EmptyState icon={PackageOpen} title="Could not open archive" body={error} />
      ) : entries === null ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : entries.length === 0 ? (
        <EmptyState icon={PackageOpen} title="Archive is empty" />
      ) : (
        <ScrollView contentContainerClassName="p-4">
          <View className="bg-surface-0 border border-border rounded-[14px] p-1">
            {entries.map((entry) => {
              const isPdf = /\.pdf$/i.test(entry.name);
              const Icon = isPdf ? FileText : FileIcon;
              return (
                <Pressable
                  key={entry.uri}
                  className="flex-row items-center gap-3 p-3 border-b border-border"
                  onPress={() => openEntry(entry)}
                >
                  <Icon size={18} color={colors.textMuted} />
                  <View className="flex-1">
                    <Text className="text-sm text-text" numberOfLines={1}>{entry.name}</Text>
                    <Text className="text-[14px] text-text-muted">{formatBytes(entry.size)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
