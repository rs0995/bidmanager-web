import { View, Text, ScrollView } from "react-native";
import { Loader2, CheckCircle2, TriangleAlert, DownloadCloud } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { SpinningIcon } from "@/components/common/SpinningIcon";
import { useAllDownloads } from "@/lib/documents";
import { useThemeColors } from "@/constants/colors";

const META: Record<string, { icon: any; spin?: boolean; label: string; color: "accent" | "ok" | "danger" }> = {
  requested: { icon: Loader2, spin: true, label: "Requested…", color: "accent" },
  downloading: { icon: Loader2, spin: true, label: "Downloading…", color: "accent" },
  downloaded: { icon: CheckCircle2, label: "Ready", color: "ok" },
  failed: { icon: TriangleAlert, label: "Failed", color: "danger" },
};

function relativeTime(iso?: string) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default function DownloadsScreen() {
  const rows = useAllDownloads();
  const colors = useThemeColors();

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Downloads" back />
      <ScrollView contentContainerClassName="p-4">
        {rows.length === 0 ? (
          <EmptyState icon={DownloadCloud} title="No downloads yet" body="Request or download tender documents and they will show up here." />
        ) : (
          <View className="bg-surface-0 border border-border rounded-[14px] p-1">
            {rows.map((d: any) => {
              const meta = META[d.client_status] || META.requested;
              const Icon = meta.icon;
              const color = colors[meta.color];
              return (
                <View key={d.id} className="flex-row items-start gap-3 p-3 border-b border-border">
                  <SpinningIcon spinning={Boolean(meta.spin)}>
                    <Icon size={16} color={color} style={{ marginTop: 2 }} />
                  </SpinningIcon>
                  <View className="flex-1">
                    <Text className="text-sm text-text" numberOfLines={1}>{d.tender_title || d.tender_id || "Untitled tender"}</Text>
                    <Text className="text-xs text-text-muted" numberOfLines={1}>{d.file_name || "All documents"}</Text>
                    {d.client_status === "failed" && d.error && (
                      <Text className="text-xs text-danger" numberOfLines={1}>{d.error}</Text>
                    )}
                  </View>
                  <View className="items-end">
                    <Text className="text-xs font-medium" style={{ color }}>{meta.label}</Text>
                    <Text className="text-[10px] text-text-muted">
                      {relativeTime(d.downloaded_at || d.requested_at || d.updated_at)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
