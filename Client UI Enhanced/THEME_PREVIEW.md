# Client UI — iOS theme migration

This folder is a copy of `../Client UI` (same code, same features, same button
placement). The only work added here so far is an **empty visual preview** of
the app re-skinned with the **Mobile App's light "iOS" theme** (the look from
the phone screenshot).

## View the preview

```powershell
npm install        # or reuse ../Client UI/node_modules (a junction already exists)
npm run dev
```

Then open **http://localhost:3000/?preview=ios**

Without the `?preview=ios` flag the real (unchanged) Client UI app boots as normal.

## What was added

| File | Purpose |
| --- | --- |
| `src/IosThemePreview.jsx` | Standalone, non-wired preview. Mirrors the existing shell + every screen's layout and **button placement** (Sync Now top-right on Dashboard / Online Tenders, New Template top-right on Templates, the Files toolbar order, the Settings connection badge, sidebar item order, the header Download / Bell / Theme cluster). Mock data only, kept thin so it reads as an "empty" shell. Light / Dark toggle in the top-right; light is the screenshot default. |
| `src/globals.ios.css` | The real theme, as a **drop-in replacement** for `globals.css` — identical class names (`.card`, `.btn-primary`, `.input-field`, `.data-table`, …). Palette ported verbatim from `../Mobile App/src/globals.css`. Not wired yet. |
| `src/main.jsx` | Adds the `?preview=ios` branch; the normal boot path is untouched. |

## Theme delta (vs `../Client UI`)

Colours / radii / shadows / typography only — no layout or behaviour changes:

- Palette sampled from the Mobile App screenshots: warm-paper ground
  (`--bg #f3f1ec`), white cards, near-black warm text (`--text #1f1e1c`),
  **indigo accent `--accent #4f46e5` (no blue)**, lavender accent surface
  (`--accent-bg #ebe9fb`), warm semantic colours (`--ok #3f9b6d`,
  `--warn #9a6b1f` on tan, star `#e0a13c`). Dark tokens are a warm-neutral
  counterpart for the toggle.
- Cards: `14px` radius + soft shadow (the defining move).
- Buttons: `11px` radius, `600` weight, taller min-height.
- Inputs: `10px` radius, taller.
- Font: **DM Sans** throughout.

## Next step (not done yet)

Once the preview direction is approved, migrate the whole app with a one-line swap:

```diff
# src/main.jsx
-import './globals.css';
+import './globals.ios.css';
```

…then walk the screens for any spots that hard-code the old palette / radii
inline rather than using the shared classes.
