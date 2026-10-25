/* eslint-env jest */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest'),
);
jest.mock('@react-native-community/blur', () => {
  const { View } = require('react-native');
  return { BlurView: View };
});
jest.mock('lucide-react-native', () => {
  const { View } = require('react-native');
  return new Proxy({}, { get: () => View });
});
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);
// Native modules used only in live mode; tests run the app in demo mode.
// Face ID outcome for app-lock tests (global so the hoisted mock can read it).
globalThis.__faceIdPass = true;
jest.mock('react-native-keychain', () => {
  const store = new Map();
  return {
    ACCESSIBLE: {
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AfterFirstUnlockThisDeviceOnly',
      WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'WhenPasscodeSetThisDeviceOnly',
    },
    ACCESS_CONTROL: { BIOMETRY_ANY_OR_DEVICE_PASSCODE: 'BiometryAnyOrDevicePasscode' },
    getSupportedBiometryType: jest.fn(async () => 'FaceID'),
    isPasscodeAuthAvailable: jest.fn(async () => true),
    getGenericPassword: jest.fn(async opts => {
      const { service, authenticationPrompt } = opts || {};
      if (authenticationPrompt && !globalThis.__faceIdPass) return false;
      return store.has(service) ? { username: 'u', password: store.get(service) } : false;
    }),
    setGenericPassword: jest.fn(async (_u, password, { service }) => {
      store.set(service, password);
      return true;
    }),
    resetGenericPassword: jest.fn(async ({ service }) => store.delete(service)),
  };
});
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(async () => [
    { uri: 'file:///tmp/picked.pdf', name: 'picked.pdf', size: 1024, type: 'application/pdf' },
  ]),
  keepLocalCopy: jest.fn(async ({ files }) =>
    files.map(f => ({ status: 'success', sourceUri: f.uri, localUri: `file:///docs/${f.fileName}` })),
  ),
  isErrorWithCode: () => false,
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
}));
jest.mock('react-native-blob-util', () => ({}));
jest.mock('react-native-zip-archive', () => ({}));
