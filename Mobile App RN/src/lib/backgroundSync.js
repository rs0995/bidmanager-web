import BackgroundFetch from "react-native-background-fetch";
import { getSettings } from "./store.js";
import { syncNow } from "./sync.js";
import { runClosingReminderCheck } from "./closingReminders.js";
import { api } from "./api.js";
import { getRaw, setRaw } from "./kv.js";
import { isSyncPaused } from "./syncPause.js";
import { queryClient } from "./queryClient.js";
import { WEBSITES_QUERY_KEY, fetchWebsites } from "../hooks/useWebsites.js";

// Real OS-level background delivery for the "Push notifications" options
// (notification-settings.tsx) -- react-native-background-fetch directly
// wraps iOS BGTaskScheduler / Android WorkManager, not Expo's own
// expo-background-fetch/expo-task-manager wrappers, so this keeps running
// (subject to OS discretion) even when the app isn't open. Both the OS
// callback below and the app-foreground fallback (see _layout.tsx) funnel
// through the one runNotificationEngine() so the logic only lives in one
// place.
let configured = false;

// One pass: pull fresh bookmark/org data (which is what lets sync.js's own
// change-detection raise "new tender"/"status changed" alerts -- already
// gated per-setting in alerts.js) and, if any closing-reminder day is
// selected, check those thresholds too. Safe to call with everything off --
// each half is a no-op when its settings are empty.
const LAST_RUN_KEY = "bm.notificationEngineLastRun";

// Exposed to the Push notifications screen so it can show something concrete
// ("last checked ...") instead of the engine running invisibly -- otherwise
// there is no way to tell background fetch firing from it simply never
// having had a chance to yet (iOS can take days to start, and stops
// entirely once the app is force-quit from the app switcher -- that's an OS
// limitation, not a bug in this code; see react-native-background-fetch's
// own README).
export function getLastEngineRunAt() {
  const raw = getRaw(LAST_RUN_KEY);
  return raw ? Number(raw) : null;
}

export async function runNotificationEngine() {
  if (isSyncPaused()) return;
  setRaw(LAST_RUN_KEY, String(Date.now()));
  // Unconditional, unlike the alert/reminder passes below -- a newly-synced
  // org should show up on the next background cycle regardless of whether
  // notifications are turned on, since this is plain data freshness, not an
  // alert. Refetch (not just invalidate) because nothing is mounted to
  // react to an invalidation while the app is backgrounded.
  try { queryClient.setQueryData(WEBSITES_QUERY_KEY, await fetchWebsites()); } catch { /* best-effort */ }
  const settings = getSettings();
  const wantsOrgOrTenderAlerts = settings.notifyOrgAlertsOn || settings.notifyTenderAlertsOn;
  const wantsClosingReminders = Array.isArray(settings.reminderDays) && settings.reminderDays.length > 0;
  if (!wantsOrgOrTenderAlerts && !wantsClosingReminders) return;

  if (wantsOrgOrTenderAlerts) {
    try { await syncNow(); } catch { /* best-effort -- next run tries again */ }
  }
  if (wantsClosingReminders) {
    try { await runClosingReminderCheck((id) => api.tender(id), settings.reminderDays); } catch { /* best-effort */ }
  }
}

// BackgroundFetch.STATUS_RESTRICTED/DENIED/AVAILABLE, or null if the native
// module hasn't answered yet (e.g. called before configureBackgroundSync()).
export async function getBackgroundFetchStatus() {
  try {
    return await BackgroundFetch.status();
  } catch {
    return null;
  }
}

export function configureBackgroundSync() {
  if (configured) return;
  configured = true;

  BackgroundFetch.configure(
    {
      // OS-discretionary minimum gap; the actual 10:00-21:00 delivery window
      // and "once per tender per day" dedupe are enforced inside
      // closingReminders.js, not here -- the OS does not offer clock-time
      // scheduling, only "no more often than every N minutes".
      minimumFetchInterval: 60,
      stopOnTerminate: false,
      startOnBoot: true,
      enableHeadless: true,
      requiresCharging: false,
      requiresDeviceIdle: false,
      requiresBatteryNotLow: false,
      requiresStorageNotLow: false,
    },
    async (taskId) => {
      try {
        await runNotificationEngine();
      } finally {
        BackgroundFetch.finish(taskId);
      }
    },
    (taskId) => {
      // iOS/Android timed us out before we finished -- must still call
      // finish() or the OS penalizes future scheduling for this app.
      BackgroundFetch.finish(taskId);
    },
  ).catch(() => {
    // Permission denied / unsupported -- runNotificationEngine() still runs
    // via the app-foreground fallback in _layout.tsx, just less often.
  });
}
