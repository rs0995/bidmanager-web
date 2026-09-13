import { View, Text, Pressable, Image } from "react-native";
import * as Sharing from "expo-sharing";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/common/Button";
import { useThemeColors } from "@/constants/colors";

type FileAsset = { name: string; size?: number; mimeType?: string; uri: string };

// Full-screen overlay for an attached checklist file — the RN counterpart of
// the web app object-URL preview. Renders images directly; anything else
// (PDFs included, since inline PDF rendering needs react-native-webview,
// an extra native dependency not otherwise needed) gets an honest "no
// inline preview" placeholder with a button to open it in another app via
// the OS share sheet, rather than a fake render.
export function FilePreview({ file, onClose }: { file: FileAsset | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();

  if (!file) return null;

  const isImage = /^image\//.test(file.mimeType || "") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name);

  return (
    <View className="absolute inset-0 z-50 flex-1 bg-bg">
      <View
        className="flex-row items-center justify-between px-4 py-3 bg-surface-0 border-b border-border"
        style={{ paddingTop: insets.top + 12 }}
      >
        <Text className="text-sm font-medium text-text flex-1" numberOfLines={1}>{file.name}</Text>
        <Pressable onPress={onClose} className="p-1.5">
          <X size={18} color={colors.textMuted} />
        </Pressable>
      </View>
      <View className="flex-1 items-center justify-center p-4">
        {isImage ? (
          <Image source={{ uri: file.uri }} className="w-full h-full" resizeMode="contain" />
        ) : (
          <View className="bg-surface-0 border border-border rounded-[14px] p-6 items-center max-w-xs gap-3">
            <Text className="text-sm font-medium text-text text-center mb-1">{file.name}</Text>
            <Text className="text-xs text-text-muted text-center">
              No inline preview for this file type.
            </Text>
            <Button variant="secondary" onPress={() => Sharing.shareAsync(file.uri)}>
              Open in another app
            </Button>
          </View>
        )}
      </View>
    </View>
  );
}
