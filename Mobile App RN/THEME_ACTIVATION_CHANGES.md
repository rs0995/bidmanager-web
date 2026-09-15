# Theme activation log

Status: **new theme ACTIVE** (activated via the steps below). All new-theme
source lives in `src/theme-new/` (see `src/theme-new/README.md` for what's in
there and why). The four edits below are the *only* changes made outside
that folder to flip the app over — everything else (old `src/global.css`,
`src/constants/colors.js`, every component) is untouched, so reverting is
just undoing these four edits.

## To revert to the old theme
Apply the four "OLD →" values below, then restart Metro with a cache clear
(`expo start -c`) since `metro.config.js`'s CSS input path is read at bundler
startup.

---

### 1. `metro.config.js`
```diff
- module.exports = withNativeWind(config, { input: "./src/global.css" });
+ module.exports = withNativeWind(config, { input: "./src/theme-new/global.css" });
```

### 2. `tsconfig.json`
Added one path entry ahead of the `@/*` wildcard (redirects every
`@/constants/colors` import — i.e. every `useThemeColors()` call site — to
the new theme's colors file without editing any of those call sites):
```diff
    "paths": {
+     "@/constants/colors": [
+       "./src/theme-new/colors"
+     ],
      "@/*": [
        "./src/*"
      ],
```
To revert: delete the added `"@/constants/colors"` entry.

### 3. `src/app/_layout.tsx`
There was no `useFonts()` call before (the old theme uses only system
fonts) — this adds one, gated behind the same loading screen as
`bootstrapApp()`:
```diff
+ import { useFonts } from "expo-font";
  import { bootstrapApp } from "@/lib/bootstrap";
+ import { NEW_THEME_FONTS, applyNewThemeDefaultFont } from "@/theme-new/fonts";
  ...
  export default function RootLayout() {
    const [booted, setBooted] = useState(false);
+   const [fontsLoaded] = useFonts(NEW_THEME_FONTS);

    useEffect(() => {
      bootstrapApp().finally(() => setBooted(true));
    }, []);

+   useEffect(() => {
+     if (fontsLoaded) applyNewThemeDefaultFont();
+   }, [fontsLoaded]);

-   if (!booted) {
+   if (!booted || !fontsLoaded) {
```
To revert: remove the two new imports, the `fontsLoaded` state, the new
`useEffect`, and change `!booted || !fontsLoaded` back to `!booted`.

### 4. `src/app/_layout.tsx` — the CSS import itself (root cause of the first
broken attempt)
`metro.config.js`'s `input` option only tells NativeWind which file to
*compile*; nothing actually loads that compiled stylesheet into the app
unless it's also `import`ed somewhere. Edit #1 above changed `input`, but the
literal import at the top of this file still pointed at the old path — so
none of the new theme's compiled styles (or its dark-mode flag) were ever
registered, which is why the app briefly lost all styling and threw a
"darkMode: class" error during activation testing.
```diff
- import "../global.css";
+ import "../theme-new/global.css";
```
To revert: change it back to `"../global.css"`.

---

## Also added (additive-only, harmless either way — no need to revert these)
- `tailwind.config.js` — `ok-bg`/`warn-bg` color tokens and `*-new`
  font-family tokens (`sans-new`, `heading-new`, `mono-new`, ...). The old
  theme never references these class names.
- `package.json` — `@expo-google-fonts/ibm-plex-sans`,
  `@expo-google-fonts/ibm-plex-mono`, `@expo-google-fonts/bricolage-grotesque`.
  Only used by `src/theme-new/fonts.js`; safe to leave installed even after
  reverting the three edits above (or remove with `npm uninstall` if you want
  a fully clean revert).

## Also changed — default theme mode (independent of the above)
`src/lib/store.js`: `SETTINGS_DEFAULTS.theme` changed from `"dark"` to
`"light"`, so a fresh install opens in light mode. This is a general
settings default, not new-theme-specific — it applies whichever theme
(old or new) is active — so it is **not** part of the revert list above.
Note it only affects installs with no persisted setting yet; a device that
already has a stored `theme` value (from before this change, or from
toggling it in the app) keeps its own choice until changed in More →
Appearance, or after "Clear local cache".

## Known cosmetic gap (not covered by this switch)
Bricolage Grotesque (screen titles, KPI numbers) and IBM Plex Mono accents
(tender IDs, org counts, etc.) aren't wired into any component yet — RN
doesn't cascade `fontFamily` the way CSS does, so those need an explicit
`font-heading-new` / `font-mono-new` className added per spot. Full list in
`src/theme-new/README.md`. The rest of the app (colors, radii, body font) is
fully switched by the three edits above.
