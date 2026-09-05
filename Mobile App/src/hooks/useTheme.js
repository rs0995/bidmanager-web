import { useEffect } from 'react';
import { useSettings, setSettings } from '../lib/store.js';

export function useTheme() {
  const { theme } = useSettings();

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.classList.remove('light', 'dark');
    body.classList.remove('light', 'dark');
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    root.classList.add(resolved);
    body.classList.add(resolved);
  }, [theme]);

  return { theme, setTheme: (t) => setSettings({ theme: t }) };
}
