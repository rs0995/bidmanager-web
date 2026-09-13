import { useEffect } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { router } from "expo-router";
import { Clock, TriangleAlert, CheckCircle2, Info, Activity, Calendar, Zap, ChevronRight } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Toggle } from "@/components/common/Toggle";
import { EmptyState } from "@/components/feedback/EmptyState";
import { useAlerts, markRead, markAllRead } from "@/lib/alerts";
import { useSettings, setSettings } from "@/lib/store";
import { requestNotificationPermission, startDeadlineChecks, stopDeadlineChecks } from "@/lib/deadlineCheck";
import { api } from "@/lib/api";
import { useToast } from "@/components/feedback/ToastProvider";
import { useThemeColors, hexToRgba } from "@/constants/colors";

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
  const { deadlineRemindersOn } = useSettings();
  const toast = useToast();
  const colors = useThemeColors();
  const hasUnread = alerts.some((a: any) => !a.read);

  const openAlert = (a: any) => {
    markRead(a.id);
    if (a.tenderId) router.push(`/tenders/${a.tenderId}` as any);
    else if (a.orgName) router.push(`/tenders/org/${encodeURIComponent(a.orgName)}?sort_by=published_date&sort_order=desc` as any);
  };

  useEffect(() => {
    if (deadlineRemindersOn) {
      startDeadlineChecks((id: any) => api.tender(id));
    } else {
      stopDeadlineChecks();
    }
    return stopDeadlineChecks;
  }, [deadlineRemindersOn]);

  const toggleReminders = async (next: boolean) => {
    if (next) {
      const granted = await requestNotificationPermission();
      setSettings({ deadlineRemindersOn: true });
      if (!granted) {
        toast?.push({ title: "Reminders on", body: "Notifications permission was not granted — you will still see alerts in this list while the app is open.", type: "info" });
      }
    } else {
      setSettings({ deadlineRemindersOn: false });
    }
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
        <Text className="mb-3 text-xs text-text-muted">
          Local deadline reminders & what changed on the last sync
        </Text>
        <View className="bg-surface-0 border border-border rounded-[14px] p-3.5 flex-row items-center justify-between gap-3 mb-4">
          <View className="flex-1">
            <Text className="text-sm font-semibold text-text">Deadline reminders</Text>
            <Text className="mt-0.5 text-xs text-text-muted">
              On-device notifications at 72h, 24h & 3h before close (while the app is open)
            </Text>
          </View>
          <Toggle checked={Boolean(deadlineRemindersOn)} onChange={toggleReminders} />
        </View>

        {alerts.length === 0 ? (
          <EmptyState icon={Info} title="No alerts yet" body="Sync, bookmark deadlines, and checklist progress will show up here." />
        ) : (
          <View className="bg-surface-0 border border-border rounded-[14px] p-1">
            {alerts.map((a: any) => {
              const meta = ICON_KEYS[a.kind] || ICON_KEYS.sync;
              const Icon = meta.icon;
              const navigable = Boolean(a.tenderId || a.orgName);
              const bgColor = meta.bg === "dangerBg" ? colors.dangerBg : colors.accentBg;
              const iconColor = colors[meta.color];
              return (
                <Pressable
                  key={a.id}
                  className="flex-row items-center gap-3 p-3 border-b border-border"
                  style={!a.read ? { backgroundColor: hexToRgba(colors.accent, 0.07) } : undefined}
                  onPress={() => openAlert(a)}
                >
                  <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: bgColor }}>
                    <Icon size={15} color={iconColor} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm text-text leading-snug">{a.message}</Text>
                    <Text className="mt-0.5 text-xs text-text-muted">{relativeTime(a.at)}</Text>
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
