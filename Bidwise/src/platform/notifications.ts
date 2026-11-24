// Phase 2G: implement local notifications with @notifee/react-native (no remote push).
export interface NotificationAdapter {
  requestPermission(): Promise<boolean>;
  notify(input: { id: string; title: string; body: string }): Promise<void>;
  cancel(id: string): Promise<void>;
}

const notReady = () =>
  Promise.reject(new Error('notifications is not wired yet (Phase 2G)'));

export const notifications: NotificationAdapter = {
  requestPermission: notReady,
  notify: notReady,
  cancel: notReady,
};
