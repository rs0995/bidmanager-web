// Phase 2A: implement with react-native-keychain (iOS Keychain / Android Keystore).
export interface SecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const notReady = () =>
  Promise.reject(new Error('secureStorage is not wired yet (Phase 2A)'));

export const secureStorage: SecureStorage = {
  get: notReady,
  set: notReady,
  remove: notReady,
};
