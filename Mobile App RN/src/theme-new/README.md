# theme-new — new BidManager theme (not active by default)

This folder is a self-contained, drop-in replacement for the app's current
theme. Nothing outside this folder was edited to build it (see "Additive-only
touches" below for the two shared config files that got new, currently-unused
entries). The app still renders with the original theme until the switch
below is made.

## What's here
- `global.css` — new palette CSS vars (ported from `Mobile App/src/globals.css`), same variable names as `src/global.css`.
- `colors.js` — JS mirror of the same palette, same shape/exports as `src/constants/colors.js`.
- `fonts.js` — `NEW_THEME_FONTS` map for `expo-font`'s `useFonts()`, plus `applyNewThemeDefaultFont()` (sets the app-wide default body font).

## Additive-only touches already made
- `tailwind.config.js` — added `ok-bg`/`warn-bg` color tokens and `*-new` font-family tokens (`sans-new`, `heading-new`, `mono-new`, ...). The old theme references none of these, so this has no visual effect until they're used.
- `package.json` — added `@expo-google-fonts/ibm-plex-sans`, `@expo-google-fonts/ibm-plex-mono`, `@expo-google-fonts/bricolage-grotesque`.

## Radius audit (Phase 3)
Mobile App RN's existing components already use radii extremely close to the new theme's conventions (buttons `rounded-[11px]`, inputs `rounded-[10px]`, cards `rounded-[14px]` vs. the web's 16px, pills `rounded-full`) — no component changes needed for radius parity.

## Colors: fully automatic once activated
Every component reads colors through the `bg`/`surface-0..3`/`text`/`accent`/... Tailwind tokens or `useThemeColors()` — never a hardcoded hex — so switching the two files below repaints the entire app with zero component edits.

## Fonts: one real RN limitation
CSS lets `body { font-family }` cascade to everything; React Native's `<Text>` does not inherit `fontFamily` from a global stylesheet. `applyNewThemeDefaultFont()` works around this for **body text** app-wide (sets `Text`/`TextInput` `defaultProps.style`), which covers the vast majority of the UI. But the web theme also uses two other fonts in specific spots that can't be defaulted globally — those need an explicit `font-heading-new` / `font-mono-new` (or `-medium`/`-semibold`/`-bold`) className added at the call site if/when you want full parity there:

- **Bricolage Grotesque** (`font-heading-new`): screen/section title text (`ScreenHeader`), KPI numbers on the Overview dashboard tiles, the pipeline-value figure.
- **IBM Plex Mono** (`font-mono-new`): tender ID, organisation tender-count, deadline-row "who" label, filter-chip counts, checklist progress %, More-screen value text.

These are cosmetic accents, not required for the theme to look right — ship without them first, add per-spot only if wanted.

## Activation status
**Currently ACTIVE.** The three single-point edits that flip the app to this
theme (`metro.config.js`, `tsconfig.json`, `src/app/_layout.tsx`) — and the
exact steps to revert them — are tracked in
`../THEME_ACTIVATION_CHANGES.md`, not duplicated here, so there's one place
to check for the current status and one place to update if anything changes.
