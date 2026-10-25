import { NativeEventEmitter, NativeModules } from 'react-native';

// The native push module (ios/BidwisePush). Absent in the browser preview and in tests,
// where every call quietly does nothing.

export type PushPermission = 'granted' | 'denied' | 'undetermined';

/** A notification's custom fields plus `thread` (tender, org, closing, download, captcha). */
export type PushPayload = {
  thread?: string;
  title?: string;
  body?: string;
  tenderId?: number | string;
  orgName?: string;
  captchaId?: string;
};

type Native = {
  requestPermission(): Promise<boolean>;
  getPermissionStatus(): Promise<PushPermission>;
  register(): void;
  getToken(): Promise<string | null>;
  getInitialOpen(): Promise<PushPayload | null>;
  setBadge(count: number): void;
  notify(
    title: string,
    body: string,
    payload: PushPayload,
    badge: number,
  ): void;
};

const native = NativeModules.BidwisePush as Native | undefined;
const emitter = native
  ? new NativeEventEmitter(NativeModules.BidwisePush)
  : null;

type Off = () => void;
const listen = <T>(event: string, fn: (body: T) => void): Off => {
  if (!emitter) return () => {};
  const sub = emitter.addListener(event, fn as (body: unknown) => void);
  return () => sub.remove();
};

export const push = {
  available: Boolean(native),
  requestPermission: async () => (native ? native.requestPermission() : false),
  getPermission: async (): Promise<PushPermission> =>
    native ? native.getPermissionStatus() : 'undetermined',
  /** Asks APNs for the device token; it arrives through onToken. */
  register: () => native?.register(),
  getToken: async () => (native ? native.getToken() : null),
  /** The tap that launched the app (once), if any. */
  getInitialOpen: async () => (native ? native.getInitialOpen() : null),
  setBadge: (count: number) => native?.setBadge(count),
  /**
   * Shows a notification from this device right away (lock screen, banner, sound,
   * badge), as a server push would. `payload.thread` routes its tap.
   */
  notify: (title: string, body: string, payload: PushPayload, badge: number) =>
    native?.notify(title, body, payload, badge),
  onToken: (fn: (token: string) => void) =>
    listen<{ token: string }>('token', e => fn(e.token)),
  onRegistrationError: (fn: (message: string) => void) =>
    listen<{ message: string }>('registrationError', e => fn(e.message)),
  /** A notification arrived while the app was open (it is shown as a banner too). */
  onReceived: (fn: (p: PushPayload) => void) => listen('received', fn),
  /** The user tapped a notification while the app was running. */
  onOpened: (fn: (p: PushPayload) => void) => listen('opened', fn),
};
