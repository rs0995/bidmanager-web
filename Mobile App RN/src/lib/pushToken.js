import * as Notifications from "expo-notifications";
import { api } from "./api.js";
import { getRaw, setRaw } from "./kv.js";
import { getSettings } from "./store.js";
import { requestNotificationPermission } from "./notifications.js";

// Raw APNs device token registration -- NOT getExpoPushTokenAsync(). The
// server (apns_push.py) talks to Apple's push gateway directly rather than
// through Expo's push relay, so it needs the device's own token.
//
// This is what makes a notification arrive even when the app has been
// force-quit or the device is in Low Power Mode: the OS wakes briefly for
// the push itself, unlike BackgroundFetch (see backgroundSync.js), which
// genuinely cannot run in either of those states.
const LAST_REGISTERED_KEY = "bm.lastRegisteredPushToken";

// Best-effort: called once at boot (if permission was already granted) and
// again right after permission is freshly granted (notification-settings.tsx)
// -- registering again with the same token is a harmless no-op server-side
// (UPSERT on the token), so no need to dedupe beyond "only call the native
// API once permission is actually granted".
export async function registerDevicePushToken() {
  try {
    const { granted } = await Notifications.getPermissionsAsync();
    if (!granted) return; // never prompt from here -- only ensurePermission() (an explicit settings toggle) does that
    // A device that already granted permission before this build (time-sensitive
    // wasn't requested yet) never gets re-prompted on its own -- re-request here,
    // once per boot, for anyone with at least one alert type already on, so the
    // upgrade reaches existing opt-ins without the user having to retoggle a
    // setting. iOS applies this silently (no new system prompt) since the base
    // grant already exists.
    const settings = getSettings();
    if (settings.notifyOrgAlertsOn || settings.notifyTenderAlertsOn || (settings.reminderDays || []).length > 0) {
      await requestNotificationPermission();
    }
    const { data } = await Notifications.getDevicePushTokenAsync();
    if (!data) return;
    if (getRaw(LAST_REGISTERED_KEY) === data) return; // already told the server about this one
    await api.registerPushToken(data, "ios");
    setRaw(LAST_REGISTERED_KEY, data);
  } catch {
    // best-effort -- next app open / permission-grant tries again
  }
}

// Called on sign-out so a stale token doesn't linger under the old account
// (see client_api.py's UPSERT-on-token: the row would otherwise still
// belong to this user until someone else's device reuses the same token,
// which may never happen on iOS).
export async function unregisterDevicePushToken() {
  try {
    const token = getRaw(LAST_REGISTERED_KEY);
    if (!token) return;
    await api.unregisterPushToken(token);
    setRaw(LAST_REGISTERED_KEY, "");
  } catch {
    // best-effort
  }
}

// Used when saved preferences arrive from the server (e.g. after a reinstall):
// asks for notification permission if it hasn't been decided yet, then
// registers this device so server push reaches it again.
export async function ensurePushRegistration() {
  try {
    const granted = await requestNotificationPermission();
    if (granted) await registerDevicePushToken();
  } catch {
    // best-effort
  }
}
