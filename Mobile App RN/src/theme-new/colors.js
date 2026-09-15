import { useColorScheme } from "nativewind";

// Plain-JS mirror of the CSS variables in theme-new/global.css — same shape
// and same call sites (useThemeColors(), urgencyColor(), hexToRgba()) as the
// original src/constants/colors.js, so activating this theme (see
// theme-new/README.md) is a drop-in swap that touches no component.
export const COLORS = {
  light: {
    bg: "#f2f1ec", surface0: "#ffffff", surface1: "#f6f5f1", surface2: "#ecebe4", surface3: "#d3d0c4",
    border: "#e2e0d7", text: "#1b1d24", textMuted: "#797d8c",
    accent: "#3a3fd4", accentBg: "#ececfb", accentHover: "#2b2fae",
    rowSelectedBg: "rgba(58,63,212,0.06)",
    danger: "#c8324b", dangerBg: "#f8e3e6",
    ok: "#12805c", okBg: "#dcefe4", warn: "#b46a06", warnBg: "#f2e3ce",
  },
  dark: {
    bg: "#0e0f13", surface0: "#191b22", surface1: "#1f222b", surface2: "#14161c", surface3: "#363a46",
    border: "#2b2e38", text: "#f0eff4", textMuted: "#878a98",
    accent: "#8a8dfb", accentBg: "#23253a", accentHover: "#a7a9ff",
    rowSelectedBg: "rgba(138,141,251,0.10)",
    danger: "#e8697f", dangerBg: "#2c1720",
    ok: "#4bbf95", okBg: "rgba(75,191,149,0.14)", warn: "#d99a4a", warnBg: "rgba(217,154,74,0.14)",
  },
};

export function useThemeColors() {
  const { colorScheme: scheme } = useColorScheme();
  return COLORS[scheme === "dark" ? "dark" : "light"];
}

export function urgencyColor(key, colors) {
  if (key === "crit") return colors.danger;
  if (key === "soon") return colors.warn;
  if (key === "ok") return colors.ok;
  return colors.textMuted;
}

// Approximates the web app color-mix(in srgb, X 16%, transparent) usage
// (e.g. tinted status pills) — RN has no color-mix, but blending a color at
// a fixed opacity against a fully transparent backdrop is just that color
// at that alpha, so this only needs to handle a "#rrggbb" input.
export function hexToRgba(hex, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
