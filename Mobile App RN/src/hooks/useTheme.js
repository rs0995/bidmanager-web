import { useEffect } from "react";
import { useColorScheme } from "nativewind";
import { useSettings, setSettings } from "../lib/store.js";

// NativeWind useColorScheme() doubles as both a read (colorScheme) and a
// write (setColorScheme) API, so this just keeps it in sync with the
// persisted "theme" setting instead of manually toggling DOM classes the
// way the web app did.
export function useTheme() {
  const { theme } = useSettings();
  const { setColorScheme } = useColorScheme();

  useEffect(() => {
    setColorScheme(theme === "system" ? "system" : theme === "light" ? "light" : "dark");
  }, [theme, setColorScheme]);

  return { theme, setTheme: (t) => setSettings({ theme: t }) };
}
