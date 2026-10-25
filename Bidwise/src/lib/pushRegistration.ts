import { push, type PushPermission } from '../platform/push';
import { api } from './api';
import { isSignedIn } from './auth';
import { getRaw, removeRaw, setRaw } from './kv';
import { onAlertsChange, unreadCount, unreadOrgs } from './alerts';
import { getSettings } from './store';

// Push notifications, app side. The server sends them (new tenders under bookmarked
// organisations, changes to bookmarked tenders, closing reminders, finished downloads,
// CAPTCHAs); this registers the phone's APNs token for Bidwise, keeps the icon badge in
// step with unread alerts, and asks for permission when it makes sense.

const TOKEN_KEY = 'bw.pushToken';
const SENT_AT_KEY = 'bw.pushTokenSentAt';
const ASKED_KEY = 'bw.pushAsked';
export const PUSH_KEYS = [TOKEN_KEY, SENT_AT_KEY, ASKED_KEY];

/** Re-send an unchanged token this often, so the server's last-seen stays fresh. */
const RESEND_MS = 7 * 24 * 3_600_000;
/** Badge updates to the server are batched this long. */
const BADGE_EVERY_MS = 5_000;

/** A Debug build gets a sandbox token from APNs; Release / TestFlight a production one. */
const ENVIRONMENT: 'production' | 'sandbox' = __DEV__
  ? 'sandbox'
  : 'production';

async function sendToken(token: string, force = false) {
  if (!isSignedIn()) return;
  const sentAt = Number(getRaw(SENT_AT_KEY) || 0);
  if (!force && getRaw(TOKEN_KEY) === token && Date.now() - sentAt < RESEND_MS)
    return;
  await api.pushToken({
    token,
    platform: 'ios',
    app: 'bidwise',
    environment: ENVIRONMENT,
  });
  setRaw(TOKEN_KEY, token);
  setRaw(SENT_AT_KEY, String(Date.now()));
}

/** If notifications are allowed, (re)register this phone's token with the server. */
export async function syncPushToken() {
  if (!push.available || !isSignedIn()) return;
  if ((await push.getPermission()) !== 'granted') return;
  push.register(); // the token comes back through onToken (wired in initPush)
}

export const getPushPermission = (): Promise<PushPermission> =>
  push.getPermission();

/** Shows the iOS prompt (only the first time; afterwards iOS answers silently). */
export async function requestPushPermission(): Promise<boolean> {
  setRaw(ASKED_KEY, '1');
  const granted = await push.requestPermission();
  if (granted) push.register();
  return granted;
}

/**
 * Asks once, after the first sync, when alerts are already switched on (for example
 * the same account's choices from BM Pro) but this phone has never been asked.
 */
export async function maybeAskForPush() {
  if (!push.available || !isSignedIn() || getRaw(ASKED_KEY)) return;
  const s = getSettings();
  const wanted =
    s.notifyOrgAlertsOn || s.notifyTenderAlertsOn || s.reminderDays.length > 0;
  if (!wanted || (await push.getPermission()) !== 'undetermined') return;
  await requestPushPermission();
}

/**
 * Sign out: stop pushes to this phone. Uses the session key being signed out (`key`), so
 * it must finish before that key is revoked on the server.
 */
export async function unregisterPush(key: string) {
  const token = getRaw(TOKEN_KEY);
  removeRaw(TOKEN_KEY);
  removeRaw(SENT_AT_KEY);
  push.setBadge(0);
  if (token && key) await api.pushTokenDelete(token, key).catch(() => {});
}

let badgeTimer: ReturnType<typeof setTimeout> | null = null;
let lastBadge = '';

/** The badge is the number of unread alerts: a grouped organisation alert counts once. */
function syncBadge() {
  push.setBadge(unreadCount());
  if (badgeTimer) return;
  badgeTimer = setTimeout(() => {
    badgeTimer = null;
    const count = unreadCount();
    const orgs = unreadOrgs();
    const key = `${count}|${orgs.join('')}`;
    if (key === lastBadge || !isSignedIn() || !getRaw(TOKEN_KEY)) return;
    lastBadge = key;
    api.badge(count, orgs).catch(() => {});
  }, BADGE_EVERY_MS);
}

let started = false;

/**
 * Once at launch (live mode): send the token whenever APNs hands one over, follow the
 * unread count for the badge, and re-register if notifications are allowed.
 */
export function initPush(onForegroundPush?: () => void) {
  if (started || !push.available) return;
  started = true;
  push.onToken(token => {
    sendToken(token).catch(() => {});
  });
  if (onForegroundPush) push.onReceived(() => onForegroundPush());
  onAlertsChange(syncBadge);
  syncBadge();
  syncPushToken().catch(() => {});
}

/** Tests only. */
export function __resetPush() {
  started = false;
  lastBadge = '';
  if (badgeTimer) clearTimeout(badgeTimer);
  badgeTimer = null;
}
