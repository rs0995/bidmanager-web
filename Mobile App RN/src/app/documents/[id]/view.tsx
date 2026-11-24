import { useMemo } from "react";
import { View, Pressable } from "react-native";
import { WebView } from "react-native-webview";
import { useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { Share2, FileWarning } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { getDocument, getLocalFile } from "@/lib/documents";
import { useThemeColors } from "@/constants/colors";

// Renders a PDF from local storage. Two modes:
// - `id` only: looks up a top-level downloaded document (getDocument/getLocalFile).
// - `id` + `uri` (+ optional `name`): views an arbitrary local file directly,
//   used for PDF entries found inside an extracted ZIP (archive.tsx pushes
//   here with the entry's own file:// uri, since it has no document row).
export default function DocumentViewScreen() {
  const { id, uri: uriParam, name } = useLocalSearchParams<{ id: string; uri?: string; name?: string }>();

  const { fileUri, title } = useMemo(() => {
    if (uriParam) {
      return { fileUri: decodeURIComponent(uriParam), title: name ? decodeURIComponent(name) : "Document" };
    }
    const doc = getDocument(Number(id));
    const file = doc ? getLocalFile(doc) : null;
    return { fileUri: file?.uri ?? null, title: doc?.file_name || "Document" };
  }, [id, uriParam, name]);

  const colors = useThemeColors();

  const handleShare = async () => {
    if (!fileUri) return;
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(fileUri);
  };

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader
        title={title}
        back
        actions={
          fileUri ? (
            <Pressable onPress={handleShare} className="p-1.5" accessibilityLabel="Share">
              <Share2 size={20} color={colors.text} />
            </Pressable>
          ) : undefined
        }
      />
      {fileUri ? (
        <WebView source={{ uri: fileUri }} style={{ flex: 1 }} originWhitelist={["*"]} />
      ) : (
        <EmptyState icon={FileWarning} title="Document not found" body="It may have been removed by Clear Cache — try downloading it again." />
      )}
    </View>
  );
}
