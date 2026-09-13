import { View, Text } from "react-native";
import { Button } from "@/components/common/Button";
import { ProgressRing } from "@/components/common/ProgressRing";
import { useRequestDownload } from "@/hooks/useDownload";
import { useToast } from "@/components/feedback/ToastProvider";

export function RequestDownloadPanel({ tender }: { tender: any }) {
  const { start, starting, status, error } = useRequestDownload(tender);
  const toast = useToast();

  const handleStart = async () => {
    try {
      await start();
    } catch (e: any) {
      toast?.push({ title: "Could not start download", body: e?.message, type: "error" });
    }
  };

  if (status === "failed") {
    return (
      <View className="bg-surface-0 border border-border rounded-[14px] p-4 items-center gap-2">
        <Text className="text-sm text-danger text-center">{error || "Download request failed."}</Text>
        <Button variant="secondary" onPress={handleStart} disabled={starting}>Try again</Button>
      </View>
    );
  }

  if (status === "requested") {
    return (
      <View className="bg-surface-0 border border-border rounded-[14px] p-4 flex-row items-center gap-3">
        <ProgressRing indeterminate size={32} />
        <Text className="flex-1 text-sm text-text-muted">
          Fetching documents from the source portal… this can take a few minutes. You can leave this screen.
        </Text>
      </View>
    );
  }

  return (
    <View className="bg-surface-0 border border-border rounded-[14px] p-4 items-center gap-2">
      <Text className="text-sm text-text-muted text-center">
        No documents downloaded yet for this tender.
      </Text>
      <Button onPress={handleStart} disabled={starting}>{starting ? "Starting…" : "Request download"}</Button>
    </View>
  );
}
