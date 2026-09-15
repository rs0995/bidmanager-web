import "../theme-new/global.css";
import { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { Stack, router } from "expo-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";

import { bootstrapApp } from "@/lib/bootstrap";
import { useTheme } from "@/hooks/useTheme";
import { NEW_THEME_FONTS, applyNewThemeDefaultFont } from "@/theme-new/fonts";
import { queryClient, setAuthErrorHandler } from "@/lib/queryClient";
import { useSignedIn } from "@/lib/auth";
import { pullBookmarks } from "@/lib/sync";
import { resumePendingDownloadJobs } from "@/lib/documents";
import { resumePendingOrgRequests } from "@/lib/orgRequests";
import { fetchWebsites, WEBSITES_QUERY_KEY } from "@/hooks/useWebsites";
import { isAppLockEnabled, verifyAppLock } from "@/lib/appLock";
import { interopIcon } from "@/lib/nativeIcons";
import { ToastProvider } from "@/components/feedback/ToastProvider";

const FingerprintIcon = interopIcon(Fingerprint);

// Root layout — the RN equivalent of the web app RequireAuth + AppLockGate
// wrapper around AppShell. Order of gates: boot (async storage hydration)
// -> signed-in -> app-lock -> the real route tree.
export default function RootLayout() {
  const [booted, setBooted] = useState(false);
  const [fontsLoaded] = useFonts(NEW_THEME_FONTS);
  // Syncs the persisted theme preference into NativeWind's colorScheme as
  // soon as the app mounts — without this, the saved preference only took
  // effect once the user visited More (the only other place this hook was
  // called), leaving everything rendered before that on the OS default.
  useTheme();

  useEffect(() => {
    bootstrapApp().finally(() => setBooted(true));
  }, []);

  useEffect(() => {
    if (fontsLoaded) applyNewThemeDefaultFont();
  }, [fontsLoaded]);

  if (!booted || !fontsLoaded) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthGate />
        </ToastProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function AuthGate() {
  // useSignedIn() is the observable form of isSignedIn() (see lib/auth.js) --
  // it re-renders this gate when setSession()/clearSession() runs anywhere
  // (SignInScreen on success, queryClient.js on a 401/403), which a plain
  // isSignedIn() read at mount time would miss entirely.
  const signedIn = useSignedIn();

  useEffect(() => {
    setAuthErrorHandler(() => {
      router.replace("/sign-in");
    });
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    pullBookmarks().catch(() => {});
    resumePendingDownloadJobs();
    resumePendingOrgRequests();
    // Warms the SiteScope portal-picker query well before the user ever
    // taps the Tenders tab, instead of only starting the paginated
    // /client/organizations fetch once they land there (see useWebsites.js).
    queryClient.prefetchQuery({ queryKey: WEBSITES_QUERY_KEY, queryFn: fetchWebsites, staleTime: 5 * 60_000 }).catch(() => {});
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
