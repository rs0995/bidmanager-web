import { View, Text } from "react-native";
import { Check, Activity, Eye, Circle } from "lucide-react-native";
import { useThemeColors, hexToRgba } from "@/constants/colors";

type Tone = "ok" | "muted" | "danger" | "info" | "warn";

// Same status -> style mapping as the desktop Client UI's StatusBadge
// (Client UI/src/components/ui/shared.tsx): the status is the portal's raw
// "Tender Stage" text, so unknown stages fall back to a neutral pill.
export function statusTone(status: string): { tone: Tone; Icon: any } {
  const s = String(status || "").trim();
  if (/^active$/i.test(s)) return { tone: "ok", Icon: Circle };
  if (/^(aoc|concluded)$/i.test(s)) return { tone: "muted", Icon: Check };
  if (/^(cancelled|canceled|withdrawn|terminated)$/i.test(s)) return { tone: "danger", Icon: Check };
  if (/evaluation|technical/i.test(s)) return { tone: "info", Icon: Activity };
  if (/financial bid/i.test(s)) return { tone: "warn", Icon: Eye };
  return { tone: "muted", Icon: Circle };
}

export function StatusPill({ status, large = false }: { status: string; large?: boolean }) {
  const colors = useThemeColors();
  const { tone, Icon } = statusTone(status);
  const color =
    tone === "ok" ? colors.ok
    : tone === "danger" ? colors.danger
    : tone === "info" ? colors.accent
    : tone === "warn" ? colors.warn
    : colors.textMuted;
  const bg = tone === "muted" ? colors.surface2 : hexToRgba(color, 0.16);
  return (
    <View
      className={large ? "px-2.5 py-1 rounded-full flex-row items-center gap-1.5" : "px-2 py-0.5 rounded-full flex-row items-center gap-1"}
      style={{ backgroundColor: bg }}
    >
      <Icon size={large ? 12 : 11} color={color} />
      <Text className={large ? "text-xs font-semibold" : "font-mono text-xs font-semibold"} style={{ color }} numberOfLines={1}>
        {status}
      </Text>
    </View>
  );
}
