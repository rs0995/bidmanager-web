import * as Keychain from 'react-native-keychain';
import { getSettings, setSettings } from './store';

// App lock with Face ID / Touch ID (or the device passcode as a fallback), using a
// keychain item that iOS will only hand back after biometric authentication. No extra
// native module: react-native-keychain already does the prompt.

const SERVICE = 'com.raku.s0995.bidwise.applock';

/** True when the device can authenticate the user (biometrics or a passcode). */
export async function isAppLockAvailable(): Promise<boolean> {
  try {
    if (await Keychain.getSupportedBiometryType()) return true;
    return await Keychain.isPasscodeAuthAvailable();
  } catch {
    return false;
  }
}

/** Shows Face ID / Touch ID / passcode. Resolves true when the user passed. */
export async function unlock(reason = 'Unlock bidwise'): Promise<boolean> {
  try {
    const found = await Keychain.getGenericPassword({
      service: SERVICE,
      authenticationPrompt: { title: reason, cancel: 'Cancel' },
    });
    return Boolean(found);
  } catch {
    return false;
  }
}

/** Turns the lock on after one successful check, so a broken setup can't lock you out. */
export async function enableAppLock() {
  if (!(await isAppLockAvailable()))
    throw new Error('Set up Face ID or a passcode on this iPhone first.');
  await Keychain.setGenericPassword('lock', '1', {
    service: SERVICE,
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
    accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  });
  if (!(await unlock('Turn on app lock'))) {
    await Keychain.resetGenericPassword({ service: SERVICE }).catch(() => {});
    throw new Error('App lock wasn’t turned on.');
  }
  setSettings({ appLockEnabled: true });
}

/** Turning the lock off needs the same check, so a borrowed phone can't just switch it off. */
export async function disableAppLock() {
  if (!(await unlock('Turn off app lock')))
    throw new Error('App lock is still on.');
  await Keychain.resetGenericPassword({ service: SERVICE }).catch(() => {});
  setSettings({ appLockEnabled: false });
}

export const isAppLockEnabled = () => getSettings().appLockEnabled;
