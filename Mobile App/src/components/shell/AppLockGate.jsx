import React, { useState, useEffect } from 'react';
import { Fingerprint } from 'lucide-react';
import { Button } from '../common/Button.jsx';
import { isAppLockEnabled, verifyAppLock } from '../../lib/appLock.js';

// Device-local re-entry gate (see lib/appLock.js) — sits between RequireAuth
// and the app's routes so a locked device shows an "Unlock" screen before
// any tender/project data renders, without touching the server session.
export function AppLockGate({ children }) {
  const enabled = isAppLockEnabled();
  const [unlocked, setUnlocked] = useState(!enabled);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (enabled && !unlocked) attempt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attempt = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await verifyAppLock();
    setBusy(false);
    if (ok) setUnlocked(true); else setFailed(true);
  };

  if (unlocked) return children;

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-8 text-center pt-safe pb-safe" style={{ background: 'var(--bg)' }}>
      <Fingerprint size={40} style={{ color: 'var(--accent)' }} />
      <p className="m-0 text-sm font-semibold">BidManager is locked</p>
      {failed && <p className="m-0 text-xs" style={{ color: 'var(--danger)' }}>Verification failed or was cancelled.</p>}
      <Button onClick={attempt} disabled={busy}>{busy ? 'Verifying…' : 'Unlock'}</Button>
    </div>
  );
}
