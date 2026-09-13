import { createContext, useContext, useState, useCallback } from "react";
import { View, Text, Pressable } from "react-native";
import { CheckCircle2, TriangleAlert, Info, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/constants/colors";

type Toast = {
  id: string;
  type?: "error" | "info" | "success";
  title: string;
  body?: string;
  sticky?: boolean;
  duration?: number;
  action?: { label: string; onClick?: () => void };
};

type ToastCtxValue = { push: (t: Omit<Toast, "id">) => void } | null;
const ToastCtx = createContext<ToastCtxValue>(null);
export const useToast = () => useContext(ToastCtx);

// Mounted once near the root (see src/app/_layout.tsx), as a sibling of the
// route tree rather than inside it, so toasts persist correctly across
// navigation the way the web app position:fixed overlay did.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, ...t }]);
    if (!t.sticky) {
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), t.duration || 3200);
    }
  }, []);
  const dismiss = useCallback((id: string) => setToasts((prev) => prev.filter((x) => x.id !== id)), []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <View
        pointerEvents="box-none"
        className="absolute left-0 right-0 flex flex-col gap-2 px-4"
        style={{ bottom: 64 + insets.bottom }}
      >
        {toasts.map((t) => {
          const Icon = t.type === "error" ? TriangleAlert : t.type === "info" ? Info : CheckCircle2;
          const color = t.type === "error" ? colors.danger : t.type === "info" ? colors.accent : colors.ok;
          return (
            <View
              key={t.id}
              className="flex-row items-start gap-3 p-3 bg-surface-0 border border-border rounded-[14px]"
            >
              <Icon size={18} color={color} style={{ marginTop: 1 }} />
              <View className="flex-1">
                <Text className="text-sm font-semibold text-text">{t.title}</Text>
                {t.body && <Text className="text-xs text-text-muted mt-0.5">{t.body}</Text>}
                {t.action && (
                  <Pressable
                    className="mt-1.5"
                    onPress={() => { t.action?.onClick?.(); dismiss(t.id); }}
                  >
                    <Text className="text-xs font-semibold text-accent">{t.action.label}</Text>
                  </Pressable>
                )}
              </View>
              <Pressable onPress={() => dismiss(t.id)} className="p-1">
                <X size={14} color={colors.textMuted} />
              </Pressable>
            </View>
          );
        })}
      </View>
    </ToastCtx.Provider>
  );
}
