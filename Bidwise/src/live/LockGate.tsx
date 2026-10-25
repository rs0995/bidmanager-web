import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { LockKeyhole } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, ScreenBackground, Wordmark } from '../components/ui';
import { useSignedIn } from '../lib/auth';
import { unlock } from '../lib/appLock';
import { useSettings } from '../lib/store';
import { fonts, useTheme } from '../theme';

/**
 * Covers the app with a lock screen on launch and whenever it comes back from the
 * background, until Face ID / passcode passes. Only when app lock is on and signed in.
 */
export function LockGate({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const signedIn = useSignedIn();
  const { appLockEnabled } = useSettings();
  const active = signedIn && appLockEnabled;
  const [locked, setLocked] = useState(active);
  const prompting = useRef(false);

  const tryUnlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    const ok = await unlock();
    prompting.current = false;
    if (ok) setLocked(false);
  }, []);

  // Lock again after the app has been in the background (not for the Face ID sheet
  // itself, which only makes the app "inactive").
  useEffect(() => {
    if (!active) {
      setLocked(false);
      return;
    }
    const sub = AppState.addEventListener('change', next => {
      if (next === 'background') setLocked(true);
    });
    return () => sub.remove();
  }, [active]);

  useEffect(() => {
    if (active && locked && AppState.currentState === 'active') tryUnlock();
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active' && active && locked) tryUnlock();
    });
    return () => sub.remove();
  }, [active, locked, tryUnlock]);

  return (
    <View style={styles.fill}>
      {children}
      {active && locked ? (
        <View
          accessibilityViewIsModal
          style={[
            StyleSheet.absoluteFill,
            styles.cover,
            { backgroundColor: t.colors.bg, paddingBottom: insets.bottom + 40 },
          ]}
        >
          <ScreenBackground />
          <Wordmark size="lg" />
          <View style={[styles.badge, { backgroundColor: t.colors.accentWash }]}>
            <LockKeyhole size={26} color={t.colors.accent} />
          </View>
          <Text style={[styles.title, { color: t.colors.ink }]}>bidwise is locked</Text>
          <Text style={[styles.sub, { color: t.colors.muted }]}>
            Use Face ID or your passcode to continue.
          </Text>
          <View style={styles.button}>
            <Button label="Unlock" block onPress={tryUnlock} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  cover: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 40,
  },
  title: { fontFamily: fonts.displaySemibold, fontSize: 22, marginTop: 18 },
  sub: { fontFamily: fonts.regular, fontSize: 13.5, marginTop: 6, textAlign: 'center' },
  button: { alignSelf: 'stretch', marginTop: 28 },
});
