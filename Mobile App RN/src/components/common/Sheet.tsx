import { Modal, View, Text, Pressable, ScrollView } from "react-native";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/constants/colors";

type SheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

// RN has no CSS position:fixed overlay — Modal(transparent, slide) is the
// native equivalent of the web app bottom-sheet-over-backdrop pattern.
export function Sheet({ open, onClose, title, children, footer }: SheetProps) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose} />
      <View
        className="absolute left-0 right-0 bottom-0 max-h-[85%] rounded-t-2xl bg-bg border-t border-border"
        style={{ paddingBottom: insets.bottom }}
      >
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
          <Text className="text-sm font-semibold text-text">{title}</Text>
          <Pressable onPress={onClose} className="p-1">
            <X size={18} color={colors.textMuted} />
          </Pressable>
        </View>
        <ScrollView className="p-4" contentContainerClassName="gap-3">{children}</ScrollView>
        {footer && (
          <View className="p-4 flex-row gap-2 border-t border-border">
            {footer}
          </View>
        )}
      </View>
    </Modal>
  );
}
