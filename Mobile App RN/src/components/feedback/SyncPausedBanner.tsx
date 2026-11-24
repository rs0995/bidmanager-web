import { useState } from "react";
import { View, Text } from "react-native";
import { Button } from "@/components/common/Button";
import { useToast } from "@/components/feedback/ToastProvider";
import { useSyncPaused } from "@/lib/syncPause";
import { resumeSync } from "@/lib/resumeSync";

export function SyncPausedBanner() {
  const paused = useSyncPaused();
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  if (!paused) return null;

  const handleSync = async () => {
    setSyncing(true);
    try {
      await resumeSync();
      toast?.push({ title: "Sync complete" });
    } catch (e: any) {
      toast?.push({ title: "Sync failed", body: e?.message, type: "error" });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <View className="bg-surface-0 border border-border rounded-[14px] p-3 mb-3 gap-2">
      <Text className="text-sm font-semibold text-text">Cache cleared</Text>
      <Text className="text-[14px] text-text-muted">
        Nothing is loaded or synced until you sync. Your account data is untouched.
      </Text>
      <Button onPress={handleSync} disabled={syncing}>{syncing ? "Syncing…" : "Sync tenders"}</Button>
    </View>
  );
}
