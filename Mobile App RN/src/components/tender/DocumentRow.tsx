import { useEffect } from "react";
import { View, Text, Pressable } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from "react-native-reanimated";
import { FileText, Download, Loader2, CheckCircle2, TriangleAlert } from "lucide-react-native";
import { formatBytes, formatDate } from "@/lib/format";
import { useDocumentDownload } from "@/hooks/useDownload";
import { useDocumentsForTender } from "@/lib/documents";
import { useToast } from "@/components/feedback/ToastProvider";
import { useThemeColors } from "@/constants/colors";

function SpinningLoader({ color }: { color: string }) {
  const rotation = useSharedValue(0);
  useEffect(() => {
    rotation.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1);
  }, [rotation]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  return (
    <Animated.View style={style}>
      <Loader2 size={18} color={color} />
    </Animated.View>
  );
}

export function DocumentRow({ tenderId, doc }: { tenderId: number; doc: any }) {
  const toast = useToast();
  const colors = useThemeColors();
  const { download, pendingId } = useDocumentDownload(
    (e: any) => toast?.push({ title: "Download failed", body: e?.message, type: "error" }),
  );
  const cacheRows = useDocumentsForTender(tenderId);
  const cached = cacheRows.find((r: any) => r.id === doc.id);
  const status = pendingId === doc.id ? "downloading" : (cached?.client_status || "synced");

  const disabled = doc.downloadable === false || status === "downloading";

  let iconColor = colors.textMuted;
  if (status === "downloaded") iconColor = colors.ok;
  else if (status === "failed") iconColor = colors.danger;

  return (
    <View className="flex-row items-center gap-3 py-2.5 border-b border-border">
      <FileText size={18} color={colors.textMuted} />
      <View className="flex-1">
        <Text className="text-sm text-text" numberOfLines={1}>{doc.name}</Text>
        <Text className="text-xs" style={{ color: status === "failed" ? colors.danger : colors.textMuted }}>
          {status === "failed" && cached?.error
            ? cached.error
            : `${doc.type} · ${formatBytes(doc.size_bytes)} · ${formatDate(doc.downloaded_at)}`}
        </Text>
      </View>
      <Pressable
        className="p-2"
        disabled={disabled}
        onPress={() => download(tenderId, doc)}
        accessibilityLabel={status === "failed" ? "Retry download" : status === "downloaded" ? "Download again" : "Download"}
      >
        {status === "downloading" ? (
          <SpinningLoader color={iconColor} />
        ) : status === "downloaded" ? (
          <CheckCircle2 size={18} color={iconColor} />
        ) : status === "failed" ? (
          <TriangleAlert size={18} color={iconColor} />
        ) : (
          <Download size={18} color={iconColor} />
        )}
      </Pressable>
    </View>
  );
}
