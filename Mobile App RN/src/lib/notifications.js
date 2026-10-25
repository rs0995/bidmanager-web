import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";

// Local-only notification plumbing (no push server -- see
// plugins/withoutPushEntitlement.js). This module owns everything the OS
// needs to actually surface a scheduled local notification as a banner with
// sound and to keep the app icon badge in sync, which scheduleNotificationAsync
// alone does not guarantee: without an explicit handler, Expo/RN suppresses
// the banner for notifications fired while the app is in the foreground.
let handlerConfigured = false;

export function configureNotifications() {
  if (handlerConfigured) return;
  handlerConfigured = true;

  Notifications.setNotificationHandler({
    // The in-app alert feed (alerts.js) already covers anything that
    // arrives while the user is actively looking at the app -- a sound on
    // top of that is just noise, not new information, whether the
    // notification came from APNs or (for kinds the server doesn't push
    // yet) the local path. Still shown in the banner/list/badge, just
    // silently.
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: AppState.currentState !== "active",
      shouldSetBadge: true,
    }),
  });

  if (Platform.OS === "android") {
    Notifications.setNotificationChannelAsync("alerts", {
      name: "Alerts",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      showBadge: true,
      vibrationPattern: [0, 150, 100, 150],
    }).catch(() => {});
  }
}

const ALERT_KIND_TITLES = {
  status: "Status update",
  prebid: "New corrigendum",
  new: "New tender",
  deadline: "Deadline approaching",
  closing: "Closing soon",
  download: "Download complete",
  warning: "Warning",
  success: "Checklist complete",
  sync: "Sync update",
};

export async function requestNotificationPermission() {
  const existing = await Notifications.getPermissionsAsync();
  // Still re-request even if already granted: iOS lets an app add the
  // time-sensitive interruption level to an already-decided grant without
  // re-prompting the user, but only if the app actually asks for it. Without
  // this, a push sent with "interruption-level": "time-sensitive" (see
  // apns_push.py) silently gets treated as a normal notification -- quietly
  // dropped into Notification Center instead of breaking through Focus/Sleep
  // modes onto the lock screen, which is what made earlier pushes invisible
  // until the phone was unlocked.
  const result = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true, allowTimeSensitive: true },
  });
  return existing.granted || result.granted;
}

export async function notificationsPermitted() {
  try {
    const { granted } = await Notifications.getPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}

// Fires a banner+sound local notification for one alert-feed entry. Callers
// (alerts.js) decide whether the user has this on via settings; this only
// checks OS-level permission so a revoked permission can't throw.
export async function notifyAlert({ kind, message }) {
  try {
    if (!(await notificationsPermitted())) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: ALERT_KIND_TITLES[kind] || "Bid Manager",
        body: message,
        sound: "default",
      },
      trigger: null,
    });
  } catch {
    // best-effort
  }
}

export async function setBadgeCount(count) {
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch {
    // best-effort -- badge API is unavailable on some Android OEM launchers
  }
}
