import "../global.css";
import { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { Stack, router } from "expo-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { bootstrapApp } from "@/lib/bootstrap";
import { queryClient, setAuthErrorHandler } from "@/lib/queryClient";
import { isSignedIn } from "@/lib/auth";
import { pullBookmarks } from "@/lib/sync";
import { resumePendingDownloadJobs } from "@/lib/documents";
import { resumePendingOrgRequests } from "@/lib/orgRequests";
import { isAppLockEnabled, verifyAppLock } from "@/lib/appLock";
import { interopIcon } from "@/lib/nativeIcons";

const FingerprintIcon = interopIcon(Fingerprint);

// Root layout — the RN equivalent of the web app RequireAuth + AppLockGate
// wrapper around AppShell. Order of gates: boot (async storage hydration)
// -> signed-in -> app-lock -> the real route tree.
export default function RootLayout() {
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    bootstrapApp().finally(() => setBooted(true));
  }, []);

  if (!booted) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthGate />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function AuthGate() {
  const [signedIn, setSignedIn] = useState(isSignedIn());

  useEffect(() => {
    setAuthErrorHandler(() => {
      setSignedIn(false);
      router.replace("/sign-in");
    });
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    pullBookmarks().catch(() => {});
    resumePendingDownloadJobs();
    resumePendingOrgRequests();
  }, [signedIn]);

  if (!signedIn) {
    return (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="sign-in" />
      </Stack>
    );
  }

  return <AppLockGate />;
}

function AppLockGate() {
  const enabled = isAppLockEnabled();
  const [unlocked, setUnlocked] = useState(!enabled);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (enabled && !unlocked) attempt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attempt = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await verifyAppLock();
    setBusy(false);
    if (ok) setUnlocked(true); else setFailed(true);
  };

  if (!unlocked) {
    return (
      <View className="flex-1 items-center justify-center gap-4 px-8 bg-bg">
        <FingerprintIcon size={40} className="text-accent" />
        <Text className="text-text text-sm font-semibold">BidManager is locked</Text>
        {failed && <Text className="text-danger text-xs">Verification failed or was cancelled.</Text>}
        <Pressable onPress={attempt} disabled={busy} className="bg-accent rounded-[11px] px-4 py-3">
          <Text className="text-white text-sm font-semibold">{busy ? "Verifying…" : "Unlock"}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="tenders/[id]" />
      <Stack.Screen name="tenders/org/[name]" />
      <Stack.Screen name="projects/[id]" />
      <Stack.Screen name="downloads" />
      <Stack.Screen name="bookmarks" />
    </Stack>
  );
}
