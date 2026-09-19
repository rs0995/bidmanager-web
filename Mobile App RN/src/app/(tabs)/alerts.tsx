import { View, Text, Pressable, ScrollView } from "react-native";
import { router } from "expo-router";
import { Clock, TriangleAlert, CheckCircle2, Info, Activity, Calendar, Zap, ChevronRight } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { EmptyState } from "@/components/feedback/EmptyState";
import { useAlerts, markRead, markAllRead } from "@/lib/alerts";
import { useThemeColors, hexToRgba } from "@/constants/colors";
import { cn } from "@/lib/cn";

const ICON_KEYS: Record<string, { icon: any; bg: "accentBg" | "dangerBg"; color: "ok" | "accent" | "danger" | "warn" }> = {
  status: { icon: Activity, bg: "accentBg", color: "ok" },
  prebid: { icon: Calendar, bg: "accentBg", color: "accent" },
  new: { icon: Zap, bg: "accentBg", color: "accent" },
  deadline: { icon: Clock, bg: "dangerBg", color: "danger" },
  warning: { icon: TriangleAlert, bg: "dangerBg", color: "warn" },
  success: { icon: CheckCircle2, bg: "accentBg", color: "ok" },
  sync: { icon: Info, bg: "accentBg", color: "accent" },
};

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default function AlertsScreen() {
  const alerts = useAlerts();
  const colors = useThemeColors();
  const hasUnread = alerts.some((a: any) => !a.read);

  const openAlert = (a: any) => {
    markRead(a.id);
    if (a.tenderId) router.push(`/tenders/${a.tenderId}` as any);
    // Bulk "N new tenders" alerts carry the ids the server reported as new —
    // open a screen with exactly those. Alerts created before that field
    // existed have no ids and fall through to the org's tender list.
    else if (a.newTenderIds?.length) router.push(`/new-tenders/${a.id}` as any);
    else if (a.orgName) router.push(`/tenders/org/${encodeURIComponent(a.orgName)}?sort_by=published_date&sort_order=desc` as any);
  };

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader
        title="Alerts"
        actions={hasUnread ? (
          <Pressable className="p-1.5" onPress={markAllRead}>
            <Text className="text-xs font-semibold text-accent">Mark all read</Text>
          </Pressable>
        ) : undefined}
      />
      <ScrollView contentContainerClassName="p-4">
        {alerts.length === 0 ? (
          <EmptyState icon={Info} title="No alerts yet" body="Sync, bookmark deadlines, and checklist progress will show up here." />
        ) : (
          <View className="bg-surface-0 border border-border rounded-[14px] p-1">
            {alerts.map((a: any, i: number) => {
              const meta = ICON_KEYS[a.kind] || ICON_KEYS.sync;
              const Icon = meta.icon;
              const navigable = Boolean(a.tenderId || a.orgName);
              const bgColor = meta.bg === "dangerBg" ? colors.dangerBg : colors.accentBg;
              const iconColor = colors[meta.color];
              const isLast = i === alerts.length - 1;
              return (
                <Pressable
                  key={a.id}
                  className={cn("flex-row items-center gap-3 p-3", !isLast && "border-b border-border")}
                  style={!a.read ? { backgroundColor: hexToRgba(colors.accent, 0.07) } : undefined}
                  onPress={() => openAlert(a)}
                >
                  <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: bgColor }}>
                    <Icon size={15} color={iconColor} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm text-text leading-snug">{a.message}</Text>
                    <Text className="mt-0.5 text-[14px] text-text-muted">{relativeTime(a.at)}</Text>
                  </View>
                  {!a.read && <View className="w-2 h-2 rounded-full bg-accent" />}
                  {navigable && <ChevronRight size={16} color={colors.textMuted} />}
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
