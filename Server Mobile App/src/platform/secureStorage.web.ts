import type { SecureStorage } from './secureStorage';

// Browser preview only: there is no keychain, so the key lives in this browser's
// localStorage (same as the desktop Server UI keeps it).
const PREFIX = 'bm.admin.secure.';

export const secureStorage: SecureStorage = {
  async get(key) {
    try {
      return window.localStorage.getItem(PREFIX + key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    window.localStorage.setItem(PREFIX + key, value);
  },
  async remove(key) {
    window.localStorage.removeItem(PREFIX + key);
  },
};
