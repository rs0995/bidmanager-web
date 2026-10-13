import "../theme-new/global.css";
import { useEffect, useState, useRef } from "react";
import { View, Text, Pressable, ActivityIndicator, LogBox, AppState } from "react-native";
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
import { resumePendingTenderUpdates } from "@/lib/tenderUpdates";
import { resumePendingTenderStatus } from "@/lib/tenderStatus";
import { runNotificationEngine } from "@/lib/backgroundSync";
import { registerDevicePushToken } from "@/lib/pushToken";
import { fetchWebsites, WEBSITES_QUERY_KEY } from "@/hooks/useWebsites";
import { isAppLockEnabled, verifyAppLock } from "@/lib/appLock";
import { interopIcon } from "@/lib/nativeIcons";
import { ToastProvider } from "@/components/feedback/ToastProvider";

const FingerprintIcon = interopIcon(Fingerprint);

// Known-benign RN/react-native-screens native-stack transition warning --
// fires from the navigation library's own internal Animated bridge usage,
// not from any Animated.Value in this app's own code (verified: every
// animation here uses Reanimated's useSharedValue, not the legacy Animated
// API). No app-side listener leak to fix; ignored so it stops surfacing as a
// LogBox banner in dev builds.
LogBox.ignoreLogs(["Sending `onAnimatedValueUpdate` with no listeners registered"]);

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
    resumePendingTenderUpdates();
    resumePendingTenderStatus();
    registerDevicePushToken();
    // Warms the SiteScope portal-picker query well before the user ever
    // taps the Tenders tab, instead of only starting the paginated
    // /client/organizations fetch once they land there (see useWebsites.js).
    queryClient.prefetchQuery({ queryKey: WEBSITES_QUERY_KEY, queryFn: fetchWebsites, staleTime: 5 * 60_000 }).catch(() => {});
  }, [signedIn]);

  // Foreground fallback for the notification engine (backgroundSync.js):
  // covers both the very first run after sign-in and every time the app is
  // reopened, which is what actually delivers org/tender/closing-reminder
  // checks on days the OS never granted the background-fetch job any time.
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    if (!signedIn) return;
    runNotificationEngine().catch(() => {});
    const sub = AppState.addEventListener("change", (next) => {
      if (appState.current.match(/inactive|background/) && next === "active") {
        runNotificationEngine().catch(() => {});
      }
      appState.current = next;
    });
    return () => sub.remove();
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
