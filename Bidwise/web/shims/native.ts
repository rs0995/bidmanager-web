// Browser preview only: the preview runs in demo mode, so the native modules used by
// live mode (keychain, file picker, downloads, unzip) are never called. These stand-ins
// let it bundle.
const unavailable = () =>
  Promise.reject(new Error('Not available in the browser preview.'));

// react-native-keychain
export const ACCESSIBLE = { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AfterFirstUnlock' };
export const getGenericPassword = async () => false;
export const setGenericPassword = async () => true;
export const resetGenericPassword = async () => true;

// @react-native-documents/picker
export const pick = unavailable;
export const keepLocalCopy = unavailable;
export const isErrorWithCode = () => false;
export const errorCodes = { OPERATION_CANCELED: 'OPERATION_CANCELED' };

// react-native-zip-archive
export const unzip = unavailable;

// react-native-blob-util (default export)
const blobUtil = {
  fs: {
    dirs: { DocumentDir: '/documents', CacheDir: '/cache' },
    exists: async () => false,
    mkdir: unavailable,
    stat: unavailable,
    unlink: unavailable,
    ls: async () => [],
    isDir: async () => false,
    writeFile: unavailable,
  },
  config: () => ({ fetch: unavailable }),
  ios: { openDocument: unavailable, presentOptionsMenu: () => {} },
  android: { actionViewIntent: unavailable },
};
export default blobUtil;
