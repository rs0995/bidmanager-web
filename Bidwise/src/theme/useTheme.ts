import { useThemeContext } from './ThemeProvider';

export function useTheme() {
  return useThemeContext().theme;
}

export function useThemePrefs() {
  const { prefs, setPrefs } = useThemeContext();
  return { prefs, setPrefs };
}
