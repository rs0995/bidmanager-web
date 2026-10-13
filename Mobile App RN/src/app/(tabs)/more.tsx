import { useState, useEffect } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { router } from "expo-router";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Sun, Moon, Monitor, LogOut, RefreshCw, Wifi, WifiOff, Download, FileSpreadsheet, ShieldQuestion, Fingerprint, Bell, Trash2, Archive } from "lucide-react-native";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { Field, Input } from "@/components/common/Field";
import { Button } from "@/components/common/Button";
import { SegmentedControl } from "@/components/common/SegmentedControl";
import { Sheet } from "@/components/common/Sheet";
import { Toggle } from "@/components/common/Toggle";
import { SpinningIcon } from "@/components/common/SpinningIcon";
import { useToast } from "@/components/feedback/ToastProvider";
import { useTheme } from "@/hooks/useTheme";
import { api } from "@/lib/api";
import { getUser, clearSession } from "@/lib/auth";
import { useSettings, rehydrateStore } from "@/lib/store";
import { syncNow, pullBookmarks, rehydrateSync } from "@/lib/sync";
import { exportTendersCsv } from "@/lib/exportCsv";
import { isAppLockAvailable, isAppLockEnabled, enableAppLock, disableAppLock } from "@/lib/appLock";
import { useActiveDownloads, rehydrateDocuments } from "@/lib/documents";
import { unregisterDevicePushToken } from "@/lib/pushToken";
import { rehydrateProjects } from "@/lib/projects";
import { rehydrateAlerts } from "@/lib/alerts";
import { rehydrateOrgRequests } from "@/lib/orgRequests";
import { rehydrateTenderUpdates } from "@/lib/tenderUpdates";
import { clearLocalCache } from "@/lib/localCache";
import { useThemeColors } from "@/constants/colors";
import { useCaptchaPending } from "@/hooks/useCaptchaPending";

function relativeTime(iso?: string) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)}h ago`;
}

function MoreRow({ icon: Icon, label, value, onPress, disabled, spin, last, badge }: {
  icon: any; label: string; value?: string; onPress?: () => void; disabled?: boolean; spin?: boolean; last?: boolean; badge?: boolean;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      className={`flex-row items-center gap-3 py-3 px-3${last ? "" : " border-b border-border"}`}
      style={{ opacity: disabled ? 0.5 : 1 }}
      onPress={onPress}
      disabled={disabled}
    >
      <View className="w-[26px] h-[26px] rounded-lg items-center justify-center bg-accent-bg">
        <SpinningIcon spinning={Boolean(spin)}>
          <Icon size={15} color={colors.accent} />
        </SpinningIcon>
      </View>
      <Text className="flex-1 text-sm text-text">{label}</Text>
      {badge && <View className="w-[8px] h-[8px] rounded-full bg-danger" />}
      {value && <Text className="font-mono text-[14px] text-text-muted">{value}</Text>}
    </Pressable>
  );
}

export default function MoreScreen() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const user = getUser();
  const { lastSyncAt } = useSettings();
  const colors = useThemeColors();
  const [pwOpen, setPwOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ current_password: "", new_password: "" });
  const [lockAvailable, setLockAvailable] = useState(false);
  const activeDownloads = useActiveDownloads();
  const [lockEnabled, setLockEnabled] = useState(isAppLockEnabled());
  const [confirmClearCache, setConfirmClearCache] = useState(false);

  useEffect(() => { isAppLockAvailable().then(setLockAvailable); }, []);

  const health = useQuery({ queryKey: ["health-check"], queryFn: api.health, enabled: false, retry: 0 });

  const sync = useMutation({
    mutationFn: syncNow,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["tenders"] }); queryClient.invalidateQueries({ queryKey: ["stats"] }); toast?.push({ title: "Synced" }); },
    onError: (e: any) => toast?.push({ title: "Sync failed", body: e?.message, type: "error" }),
  });

  const exportCsv = useMutation({
    mutationFn: () => exportTendersCsv({ archived: false }),
    onSuccess: (count) => toast?.push({ title: "Exported", body: `${count} tenders exported as CSV.` }),
    onError: (e: any) => toast?.push({ title: "Export failed", body: e?.message, type: "error" }),
  });

  const changePassword = useMutation({
    mutationFn: () => api.changePassword(pwForm),
    onSuccess: () => { toast?.push({ title: "Password changed" }); setPwOpen(false); setPwForm({ current_password: "", new_password: "" }); },
    onError: (e: any) => toast?.push({ title: "Could not change password", body: e?.message, type: "error" }),
  });

  const signOut = useMutation({
    mutationFn: async () => {
      await unregisterDevicePushToken();
      await api.logout().catch(() => {});
    },
    onSettled: () => { clearSession(); queryClient.clear(); router.replace("/sign-in"); },
  });

  // RN has no page-reload primitive (unlike the web app window.location.reload()),
  // so this re-primes every module in-memory cache directly from the now-cleared
  // kv.js mirror, then re-syncs bookmarks/projects from the server -- the same
  // end state a reload achieved on the web app, without the reload.
  const handleClearCache = async () => {
    clearLocalCache();
    rehydrateStore();
    rehydrateAlerts();
    rehydrateProjects();
    rehydrateOrgRequests();
    rehydrateTenderUpdates();
    rehydrateDocuments();
    rehydrateSync();
    // Fetched organisations, tenders and documents live in the query cache,
    // not in the kv store cleared above.
    queryClient.clear();
    setConfirmClearCache(false);
    await pullBookmarks().catch(() => {});
    toast?.push({ title: "Cache cleared" });
  };

  const toggleAppLock = async (next: boolean) => {
    try {
      if (next) { await enableAppLock(); setLockEnabled(true); toast?.push({ title: "App lock enabled" }); }
      else { disableAppLock(); setLockEnabled(false); toast?.push({ title: "App lock disabled" }); }
    } catch (e: any) {
      toast?.push({ title: "Could not set up app lock", body: e?.message, type: "error" });
    }
  };

  const captchaPending = useCaptchaPending();
  const hasCaptchaPending = Boolean(captchaPending.data);

  return (
    <View className="flex-1 bg-bg">
      <ScreenHeader title="More" />
      <ScrollView contentContainerClassName="p-4">
        <Text className="mb-3 text-[14px] text-text-muted">Sync, connection & workspace</Text>

        <View className="bg-surface-0 border border-border rounded-[14px] mb-3">
          <MoreRow icon={RefreshCw} label="Sync tenders" value={sync.isPending ? "Syncing…" : relativeTime(lastSyncAt)} onPress={() => sync.mutate()} disabled={sync.isPending} spin={sync.isPending} />
          <MoreRow
            icon={health.data?.status === "ok" ? Wifi : WifiOff}
            label="Connection"
            value={health.isFetching ? "Checking…" : health.data?.status === "ok" ? "reachable" : health.isFetched ? "unreachable" : "tap to check"}
            onPress={() => health.refetch()}
          />
          <MoreRow icon={Archive} label="Archive" value="›" onPress={() => router.push("/archive" as any)} />
          <MoreRow icon={Download} label="Downloads" value={activeDownloads.length ? `${activeDownloads.length} in progress` : "›"} onPress={() => router.push("/downloads")} last />
        </View>

        <View className="bg-surface-0 border border-border rounded-[14px] mb-3">
          <MoreRow icon={FileSpreadsheet} label="Export tenders (CSV)" value={exportCsv.isPending ? "Exporting…" : "›"} onPress={() => exportCsv.mutate()} disabled={exportCsv.isPending} spin={exportCsv.isPending} />
          <MoreRow icon={ShieldQuestion} label="Captcha" value="›" onPress={() => router.push("/captcha" as any)} badge={hasCaptchaPending} />
          {lockAvailable && (
            <View className="flex-row items-center gap-3 py-3 px-3 border-b border-border">
              {/* always followed by Push notifications below -- border-b intentionally kept */}
              <View className="w-[26px] h-[26px] rounded-lg items-center justify-center bg-accent-bg">
                <Fingerprint size={15} color={colors.accent} />
              </View>
              <Text className="flex-1 text-sm text-text">App lock</Text>
              <Toggle checked={lockEnabled} onChange={toggleAppLock} />
            </View>
          )}
          <MoreRow icon={Bell} label="Push notifications" value="›" onPress={() => router.push("/notification-settings" as any)} last />
        </View>

        <View className="bg-surface-0 border border-border rounded-[14px] p-3 mb-3">
          <Text className="text-sm font-medium text-text">{user?.display_name || user?.email || "Signed in"}</Text>
          {user?.email && <Text className="text-[14px] mt-0.5 text-text-muted">{user.email}</Text>}
          <View className="flex-row gap-2 mt-2">
            <Button variant="secondary" className="flex-1" onPress={() => setPwOpen(true)}>Change password</Button>
            <Button variant="danger" className="flex-1" onPress={() => signOut.mutate()} disabled={signOut.isPending}>
              <View className="flex-row items-center gap-1.5">
                <LogOut size={14} color={colors.danger} />
                <Text className="text-danger text-sm font-semibold">Sign out</Text>
              </View>
            </Button>
          </View>
        </View>

        <View className="bg-surface-0 border border-border rounded-[14px] mb-3">
          <MoreRow icon={Trash2} label="Clear local cache" value="›" onPress={() => setConfirmClearCache(true)} last />
        </View>

        <View className="mb-2">
          <Text className="mb-2 text-[14px] font-semibold uppercase tracking-wide text-text-muted">Appearance</Text>
          <SegmentedControl
            value={theme}
            onChange={setTheme}
            options={[
              { value: "dark", label: "Dark", icon: Moon },
              { value: "light", label: "Light", icon: Sun },
              { value: "system", label: "System", icon: Monitor },
            ]}
          />
        </View>

        <Text className="text-[14px] mt-4 text-text-muted">
          Bookmarks and projects sync to your account. Attached documents and app-lock stay on this device only.
        </Text>
      </ScrollView>

      <Sheet
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        title="Change password"
        footer={<Button className="flex-1" onPress={() => changePassword.mutate()} disabled={changePassword.isPending}>Save</Button>}
      >
        <View className="flex flex-col gap-3">
          <Field label="Current password">
            <Input secureTextEntry value={pwForm.current_password} onChangeText={(v) => setPwForm((p) => ({ ...p, current_password: v }))} />
          </Field>
          <Field label="New password">
            <Input secureTextEntry value={pwForm.new_password} onChangeText={(v) => setPwForm((p) => ({ ...p, new_password: v }))} />
          </Field>
        </View>
      </Sheet>

      <Sheet
        open={confirmClearCache}
        onClose={() => setConfirmClearCache(false)}
        title="Clear local cache?"
        footer={(
          <>
            <Button variant="secondary" className="flex-1" onPress={() => setConfirmClearCache(false)}>Cancel</Button>
            <Button variant="danger" className="flex-1" onPress={handleClearCache}>Clear cache</Button>
          </>
        )}
      >
        <Text className="text-[14px] text-text-muted">
          Removes downloaded files, alerts, and the organisations and tenders fetched to this device. Nothing is deleted from your account — bookmarks and projects are re-synced from the cloud right after.
        </Text>
      </Sheet>
    </View>
  );
}
