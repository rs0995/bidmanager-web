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
      },
    },
  },
  plugins: [],
};
