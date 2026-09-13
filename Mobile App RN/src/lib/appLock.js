import * as LocalAuthentication from "expo-local-authentication";
import { getSettings, setSettings } from "./store.js";

// Device-local convenience lock on top of the already-authenticated session
// (NOT a second server-side auth factor) — matches the web app "App lock
// (Face ID)" toggle. Uses the native biometric prompt (Face ID / Touch ID)
// purely to gate re-entry into an already-signed-in app; nothing here is
// sent to or verified by the backend. Unlike the web app WebAuthn version,
// expo-local-authentication has no concept of a registered credential to
// store — hasHardwareAsync + isEnrolledAsync stand in for "is this even
// possible on this device", and every unlock just re-prompts biometrics.
export async function isAppLockAvailable() {
  try {
    const [hasHardware, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hasHardware && isEnrolled;
  } catch {
    return false;
  }
}

export async function enableAppLock() {
  const available = await isAppLockAvailable();
  if (!available) throw new Error("Face ID / Touch ID is not set up on this device.");
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Confirm to enable App Lock",
  });
  if (!result.success) throw new Error("Could not enable App Lock.");
  setSettings({ appLockEnabled: true });
}

export function disableAppLock() {
  setSettings({ appLockEnabled: false });
}

export function isAppLockEnabled() {
  return Boolean(getSettings().appLockEnabled);
}

export async function verifyAppLock() {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock BidManager",
    });
    return result.success;
  } catch {
    return false;
  }
}
