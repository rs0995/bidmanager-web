import * as Keychain from 'react-native-keychain';

// iOS Keychain (Android Keystore) for the sign-in token. Each key is its own
// keychain "service" so values can be read, replaced and removed independently.
export interface SecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const service = (key: string) => `com.raku.s0995.bidwise.${key}`;

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
