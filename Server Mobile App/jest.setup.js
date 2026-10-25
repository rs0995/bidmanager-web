/* eslint-env jest */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest'),
);
jest.mock('lucide-react-native', () => {
  const { View } = require('react-native');
  return new Proxy({}, { get: () => View });
});
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@react-native-clipboard/clipboard', () =>
  require('@react-native-clipboard/clipboard/jest/clipboard-mock.js'),
);
// Keychain starts with an admin key saved, so the app opens connected.
jest.mock('react-native-keychain', () => {
  const store = { 'com.raku.bidmanager-server.adminKey': 'test-key' };
  return {
    ACCESSIBLE: { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'x' },
    getGenericPassword: async ({ service }) =>
      store[service] ? { username: 'k', password: store[service] } : false,
    setGenericPassword: async (_u, password, { service }) => {
      store[service] = password;
      return true;
    },
    resetGenericPassword: async ({ service }) => {
      delete store[service];
      return true;
    },
  };
});
// Never touch the network in tests: every request goes to the fake server.
global.fetch = jest.fn(url => require('./test-support/fakeServer').fakeFetch(String(url)));
