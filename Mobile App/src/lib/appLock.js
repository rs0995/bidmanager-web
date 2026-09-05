import { getSettings, setSettings } from './store.js';

// Device-local convenience lock on top of the already-authenticated session
// (NOT a second server-side auth factor) — matches the reference artifact's
// "App lock (Face ID)" toggle. Uses the WebAuthn platform authenticator
// (Face ID / Touch ID / Windows Hello class hardware) purely to gate
// re-entry into an already-signed-in app; the credential is never sent to
// or verified by the backend.
const CREDENTIAL_ID_KEY = 'bm.appLockCredentialId';

export async function isAppLockAvailable() {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function randomChallenge() {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function enableAppLock() {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { name: 'BidManager Mobile' },
      user: { id: randomChallenge(), name: 'device-lock', displayName: 'Device lock' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000,
    },
  });
  if (!credential) throw new Error('Could not register device lock.');
  localStorage.setItem(CREDENTIAL_ID_KEY, credential.id);
  setSettings({ appLockEnabled: true });
}

export function disableAppLock() {
  localStorage.removeItem(CREDENTIAL_ID_KEY);
  setSettings({ appLockEnabled: false });
}

export function isAppLockEnabled() {
  return Boolean(getSettings().appLockEnabled);
}

export async function verifyAppLock() {
  const credentialId = localStorage.getItem(CREDENTIAL_ID_KEY);
  if (!credentialId) return false;
  try {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: randomChallenge(),
        allowCredentials: [{ id: Uint8Array.from(atob(credentialId.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)), type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return Boolean(credential);
  } catch {
    return false;
  }
}
