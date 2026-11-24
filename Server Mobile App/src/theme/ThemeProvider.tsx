import React, { createContext, useContext, useMemo } from 'react';
import { buildTheme, Theme } from './tokens';

// One fixed look, matching the desktop Server UI (which has no dark mode or accent options).
const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useMemo(() => buildTheme(), []);
  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside ThemeProvider');
  return theme;
}
