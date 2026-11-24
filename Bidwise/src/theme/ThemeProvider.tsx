import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildTheme, DEFAULT_PREFS, Theme, ThemePrefs } from './tokens';

const STORAGE_KEY = 'bidwise.themePrefs';

type ThemeContextValue = {
  theme: Theme;
  prefs: ThemePrefs;
  setPrefs: (patch: Partial<ThemePrefs>) => void;
  /** True once the saved prefs have been read (the first screen waits, so no flash). */
  loaded: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [prefs, setPrefsState] = useState<ThemePrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => {
        if (!raw || cancelled) return;
        try {
          setPrefsState({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
        } catch {
          // ignore corrupt value, keep defaults
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const setPrefs = useCallback((patch: Partial<ThemePrefs>) => {
    setPrefsState(prev => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const scheme =
    prefs.mode === 'system'
      ? system === 'dark'
        ? 'dark'
        : 'light'
      : prefs.mode;
  const theme = useMemo(() => buildTheme(scheme, prefs), [scheme, prefs]);
  const value = useMemo(
    () => ({ theme, prefs, setPrefs, loaded }),
    [theme, prefs, setPrefs, loaded],
  );

  // Browser preview only (`npm run dev`): lets web/panel.ts flip theme options live.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const g = globalThis as { __bwTheme?: unknown };
    g.__bwTheme = { get: () => prefs, set: setPrefs };
    return () => {
      delete g.__bwTheme;
    };
  }, [prefs, setPrefs]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
