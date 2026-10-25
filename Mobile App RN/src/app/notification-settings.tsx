import { useEffect, useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { Building2, FileText, Clock, RefreshCw, CheckCircle2, TriangleAlert, Info } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Toggle } from "@/components/common/Toggle";
import { useToast } from "@/components/feedback/ToastProvider";
import { useSettings, setSettings } from "@/lib/store";
import { schedulePush } from "@/lib/sync";
import { requestNotificationPermission } from "@/lib/notifications";
import { registerDevicePushToken } from "@/lib/pushToken";
import { DAY_THRESHOLDS } from "@/lib/closingReminders";
import { getBackgroundFetchStatus, getLastEngineRunAt, runNotificationEngine } from "@/lib/backgroundSync";
import BackgroundFetch from "react-native-background-fetch";
import { useThemeColors } from "@/constants/colors";

function Row({ icon: Icon, title, body, checked, onChange }: {
  icon: any; title: string; body: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center gap-3 py-3 px-3">
      <View className="w-[26px] h-[26px] rounded-lg items-center justify-center bg-accent-bg">
        <Icon size={15} color={colors.accent} />
      </View>
      <View className="flex-1">
        <Text className="text-sm text-text">{title}</Text>
        <Text className="mt-0.5 text-[14px] text-text-muted">{body}</Text>
      </View>
      <Toggle checked={checked} onChange={onChange} />
    </View>
  );
}

const DAY_LABEL: Record<number, string> = { 1: "1 day before", 2: "2 days before", 3: "3 days before", 5: "5 days before" };

function relativeTime(ms: number | null) {
  if (!ms) return "never";
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ms).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const STATUS_META: Record<number, { label: string; tone: "ok" | "warn" | "danger" }> = {
  [BackgroundFetch.STATUS_AVAILABLE]: { label: "Allowed", tone: "ok" },
  [BackgroundFetch.STATUS_DENIED]: { label: "Turned off for this app", tone: "danger" },
  [BackgroundFetch.STATUS_RESTRICTED]: { label: "Restricted on this device", tone: "danger" },
};

export default function NotificationSettingsScreen() {
  const settings = useSettings();
  const toast = useToast();
  const colors = useThemeColors();
  const reminderDays: number[] = settings.reminderDays || [];
  const [osStatus, setOsStatus] = useState<number | null>(null);
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);

  const refreshStatus = useCallback(() => {
    getBackgroundFetchStatus().then(setOsStatus);
    setLastRunAt(getLastEngineRunAt());
  }, []);
  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  const checkNow = async () => {
    setChecking(true);
    try {
      await runNotificationEngine();
      toast?.push({ title: "Checked", body: "Ran the same check the background job would." });
    } catch (e: any) {
      toast?.push({ title: "Check failed", body: e?.message, type: "error" });
    } finally {
      setChecking(false);
      refreshStatus();
    }
  };

  const ensurePermission = async () => {
    const granted = await requestNotificationPermission();
    if (granted) {
      registerDevicePushToken();
    } else {
      toast?.push({
        title: "Notifications permission not granted",
        body: "This option is on, but it will stay silent until notifications are allowed for this app.",
        type: "info",
      });
    }
  };

  const toggleOrgAlerts = async (next: boolean) => {
    setSettings({ notifyOrgAlertsOn: next, notificationPrefsUpdatedAt: Date.now() }); schedulePush();
    if (next) await ensurePermission();
  };
  const toggleTenderAlerts = async (next: boolean) => {
    setSettings({ notifyTenderAlertsOn: next, notificationPrefsUpdatedAt: Date.now() }); schedulePush();
    if (next) await ensurePermission();
  };
  const toggleDay = async (day: number, next: boolean) => {
    const nextDays = next ? [...reminderDays, day] : reminderDays.filter((d) => d !== day);
    setSettings({ reminderDays: nextDays, notificationPrefsUpdatedAt: Date.now() }); schedulePush();
    if (next) await ensurePermission();
  };

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="Push notifications" back />
      <ScrollView contentContainerClassName="p-4">
        <View className="bg-surface-0 border border-border rounded-[14px] p-3 mb-3">
          <View className="flex-row items-center gap-2 mb-1">
            {osStatus === BackgroundFetch.STATUS_AVAILABLE ? (
              <CheckCircle2 size={15} color={colors.ok} />
            ) : osStatus == null ? (
              <Info size={15} color={colors.textMuted} />
            ) : (
              <TriangleAlert size={15} color={colors.danger} />
            )}
            <Text className="text-sm font-medium text-text">
              Background refresh: {osStatus == null ? "Checking…" : (STATUS_META[osStatus]?.label || "Unknown")}
            </Text>
          </View>
          <Text className="text-[14px] text-text-muted">
            Last checked {relativeTime(lastRunAt)}.{" "}
            {osStatus === BackgroundFetch.STATUS_DENIED || osStatus === BackgroundFetch.STATUS_RESTRICTED
              ? "Turn this on in iOS Settings → General → Background App Refresh (both the global switch and this app's) for notifications to arrive without opening the app."
              : "iOS decides exactly when to run this in the background and can take a day or more after install before it settles into a regular pattern — that's normal, not a bug. It also stops entirely if you swipe the app away from the app switcher."}
          </Text>
          <Pressable
            className="mt-2 flex-row items-center gap-1.5 self-start px-2.5 py-1.5 rounded-lg bg-accent-bg"
            onPress={checkNow}
            disabled={checking}
          >
            <RefreshCw size={13} color={colors.accent} />
            <Text className="text-[14px] font-semibold text-accent">{checking ? "Checking…" : "Check now"}</Text>
          </Pressable>
        </View>

        <View className="bg-surface-0 border border-border rounded-[14px] mb-3 divide-y divide-border">
          <Row
            icon={Building2}
            title="Bookmarked organisations"
            body="Notify when new tenders are added under an organisation you've bookmarked."
            checked={Boolean(settings.notifyOrgAlertsOn)}
            onChange={toggleOrgAlerts}
          />
          <Row
            icon={FileText}
            title="Bookmarked tenders"
            body="Notify on status changes, new corrigenda or pre-bid updates for tenders you've bookmarked."
            checked={Boolean(settings.notifyTenderAlertsOn)}
            onChange={toggleTenderAlerts}
          />
        </View>

        <Text className="mb-2 text-[14px] font-semibold uppercase tracking-wide text-text-muted">Closing reminders</Text>
        <View className="bg-surface-0 border border-border rounded-[14px] mb-2 divide-y divide-border">
          {DAY_THRESHOLDS.map((day) => (
            <Row
              key={day}
              icon={Clock}
              title={DAY_LABEL[day]}
              body={`Remind me when a bookmarked tender is closing ${day} day${day === 1 ? "" : "s"} from now.`}
              checked={reminderDays.includes(day)}
              onChange={(next) => toggleDay(day, next)}
            />
          ))}
        </View>
        <Text className="text-[14px] text-text-muted">
          Closing reminders are checked roughly every hour between 10:00 and 21:00, even when the app is closed. If the app
          hasn't been able to run in the background, it catches up the next time you open it. All options above can be
          turned on together.
        </Text>
      </ScrollView>
    </View>
  );
}
