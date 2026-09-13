import { useColorScheme } from "react-native";

// Plain-JS mirror of the CSS variables in src/global.css, for the handful of
// places that need an actual resolved color value rather than a NativeWind
// className — React Navigation options (tabBarActiveTintColor,
// header/tab-bar style), and any third-party component prop NativeWind does
// not intercept via cssInterop. Keep in sync with global.css by hand; there
// are few enough of these call sites that a build-time CSS-var extraction
// step would be more machinery than the problem is worth.
export const COLORS = {
  light: {
    bg: "#f5f6fa", surface0: "#ffffff", surface1: "#f0f2f7", surface2: "#e6e9f0", surface3: "#d8dce6",
    border: "#dfe2ea", text: "#1a1f2e", textMuted: "#6b7a96",
    accent: "#3b6ce7", accentBg: "rgba(59,108,231,0.08)", accentHover: "#2b5cd4",
    rowSelectedBg: "rgba(59,108,231,0.06)",
    danger: "#dc2626", dangerBg: "rgba(220,38,38,0.08)",
    ok: "#059669", warn: "#d97706",
  },
  dark: {
    bg: "#0c0e14", surface0: "#11141c", surface1: "#181c28", surface2: "#222838", surface3: "#2c3448",
    border: "#252d40", text: "#e4e8f1", textMuted: "#6b7a96",
    accent: "#5b8af5", accentBg: "rgba(91,138,245,0.12)", accentHover: "#7aa3ff",
    rowSelectedBg: "rgba(91,138,245,0.08)",
    danger: "#ef5350", dangerBg: "rgba(239,83,80,0.12)",
    ok: "#34d399", warn: "#fbbf24",
  },
};

export function useThemeColors() {
  const scheme = useColorScheme();
  return COLORS[scheme === "dark" ? "dark" : "light"];
}

export function urgencyColor(key, colors) {
  if (key === "crit") return colors.danger;
  if (key === "soon") return colors.warn;
  if (key === "ok") return colors.ok;
  return colors.textMuted;
}
