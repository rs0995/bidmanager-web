export { requestNotificationPermission } from "./notifications.js";
import { addAlert } from "./alerts.js";
import { getBookmarks } from "./store.js";
import { timeRemaining } from "./format.js";
import { getRaw, setRaw } from "./kv.js";

// Closing-date reminders for bookmarked tenders (the "Closing reminders"
// section of the Push notifications screen): fires once per tender per
// selected day-threshold (1/2/3/5 days before closing_date), but only
// delivers the actual notification while the local clock is within the
// user-facing 10:00-21:00 window -- a check that runs earlier (e.g. right
// after opening the app at 7am) still records the day as "seen" is NOT
// marked fired yet, so it's picked up and delivered on the next in-window
// run instead of being silently dropped. Checks only bookmarked tenders
// (not project tenders), per the wording of the feature.
//
// This is still only as reliable as whatever actually runs it: the native
// background-fetch job (backgroundSync.js) when the OS grants it time, or
// the app-foreground fallback otherwise -- there is no push server behind
// this, see plugins/withoutPushEntitlement.js.
export const DAY_THRESHOLDS = [1, 2, 3, 5];
const FIRED_KEY = "bm.closingRemindersFired";
const WINDOW_START_HOUR = 10;
const WINDOW_END_HOUR = 21; // exclusive -- i.e. up to 20:59

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function readFired() {
  try { return JSON.parse(getRaw(FIRED_KEY)) || {}; } catch { return {}; }
}
// Pruned to today's entries only -- thresholds are evaluated fresh every
// day, so nothing from a previous day needs to be remembered.
function writeFired(map) {
  setRaw(FIRED_KEY, JSON.stringify(map));
}

function inDeliveryWindow(now = new Date()) {
  const h = now.getHours();
  return h >= WINDOW_START_HOUR && h < WINDOW_END_HOUR;
}

// Resolves the bookmarked portal tender ids to current tender rows ({ id:
// tender }) so the check has closing dates to compare -- passed in by the
// caller (needs an authenticated api client), keeping this module free of
// React Query dependencies. Fired keys use the tender id, not the row id.
export async function runClosingReminderCheck(resolveTenders, days, now = new Date()) {
  const thresholds = (Array.isArray(days) ? days : []).filter((d) => DAY_THRESHOLDS.includes(d));
  if (thresholds.length === 0) return;
  const ids = getBookmarks();
  if (ids.size === 0) return;
  let tenders;
  try { tenders = (await resolveTenders([...ids])) || {}; } catch { return; }

  const today = todayKey();
  const firedAll = readFired();
  const fired = firedAll[today] || {};
  let changed = false;
  const canDeliver = inDeliveryWindow(now);

  for (const key of ids) {
    const tender = tenders[key];
    if (!tender?.closing_date) continue;
    const { totalDays, expired } = timeRemaining(tender.closing_date);
    if (expired || totalDays == null) continue;
    for (const day of thresholds) {
      if (totalDays !== day) continue;
      const firedKey = `${key}:${day}`;
      if (fired[firedKey]) continue;
      if (!canDeliver) continue; // seen but not yet in the delivery window -- try again later today
      fired[firedKey] = true;
      changed = true;
      const message = totalDays === 0
        ? `"${tender.title}" closes today.`
        : `"${tender.title}" closes in ${day} day${day === 1 ? "" : "s"}.`;
      addAlert({ kind: "closing", message, tenderId: tender.id, tenderKey: key });
    }
  }
  if (changed) {
    firedAll[today] = fired;
    // Keep only today's bucket -- yesterday's thresholds are irrelevant now.
    writeFired({ [today]: firedAll[today] });
  }
}
