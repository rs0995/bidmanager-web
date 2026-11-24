import * as Keychain from 'react-native-keychain';

// Admin key storage: iOS Keychain / Android Keystore. Each key is its own
// keychain "service" so values never overwrite each other.
export interface SecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const service = (key: string) => `com.raku.bidmanager-server.${key}`;

export const secureStorage: SecureStorage = {
  async get(key) {
    const found = await Keychain.getGenericPassword({ service: service(key) });
    return found ? found.password : null;
  },
  async set(key, value) {
    await Keychain.setGenericPassword(key, value, {
      service: service(key),
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },
  async remove(key) {
    await Keychain.resetGenericPassword({ service: service(key) });
  },
};
