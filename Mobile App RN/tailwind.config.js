/** @type {import(\"tailwindcss\").Config} */
module.exports = {
  darkMode: "class",
  content: ["./src/app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: {
          0: "var(--surface-0)",
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
        },
        border: "var(--border)",
        text: "var(--text)",
        "text-muted": "var(--text-muted)",
        accent: "var(--accent)",
        "accent-bg": "var(--accent-bg)",
        "accent-hover": "var(--accent-hover)",
        "row-selected-bg": "var(--row-selected-bg)",
        danger: "var(--danger)",
        "danger-bg": "var(--danger-bg)",
        ok: "var(--ok)",
        warn: "var(--warn)",
        // Additive-only: only theme-new/global.css defines these two vars.
        // The old theme (src/global.css) never defines them, so these
        // tokens simply resolve to nothing/transparent until theme-new is
        // activated — no visual effect on the current theme.
        "ok-bg": "var(--ok-bg)",
        "warn-bg": "var(--warn-bg)",
      },
      // Additive-only font families for theme-new (see src/theme-new/fonts.js).
      // The old theme never references these class names, so adding them
      // here has no visual effect until they're actually used.
      fontFamily: {
        "sans-new": ["IBMPlexSans_400Regular"],
        "sans-new-medium": ["IBMPlexSans_500Medium"],
        "sans-new-semibold": ["IBMPlexSans_600SemiBold"],
        "sans-new-bold": ["IBMPlexSans_700Bold"],
        "heading-new": ["BricolageGrotesque_600SemiBold"],
        "heading-new-bold": ["BricolageGrotesque_700Bold"],
        "mono-new": ["IBMPlexMono_400Regular"],
        "mono-new-medium": ["IBMPlexMono_500Medium"],
        "mono-new-semibold": ["IBMPlexMono_600SemiBold"],
      },
    },
  },
  plugins: [],
};
