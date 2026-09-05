# BidManager Mobile

A mobile-first web client for BidManager, built for testing on real phones.
Matches the feature set of the "BidManager Field" reference prototype:
**Overview**, **Tenders** (portal scope, organisations, search/filter,
bookmark, documents), **Projects** (local checklist with folders + file
attachments), **Alerts** (local deadline reminders + sync changes), and
**More** (sync, connection status, export, account).

It talks to the same backend as `Client UI/` over the `/client/*` surface.
The backend URL is hardcoded (no user-facing "Server URL" setting) — see
`lib/http.js`. Projects/checklist are local-first on the phone (no
`/client/*` endpoint exists for them, same as the desktop app), synced
cross-device only through the same `/client/sync` blob that already carries
bookmarks; file attachments never leave the device.

Standalone project — its own `package.json`, no imports from `Client UI/` or
`Server UI/`. Patterns (API wrapper, design tokens, formatting logic) are
ported down and trimmed, not shared at runtime.

## Run it (LAN testing on a phone)

```bash
cd "Mobile App"
npm install
npm run dev
```

Vite prints a **Network** URL, e.g. `http://192.168.1.20:5173`. Make sure
your phone is on the **same Wi-Fi** as the machine running `npm run dev`,
then open that URL in the phone's browser.

The dev server proxies every `/client/*` request to the real backend
(`https://161.118.170.233.sslip.io`, see `lib/http.js`'s `BACKEND_URL`), so
the phone's browser only ever talks to the dev server — no CORS issues, no
backend changes needed.

If the phone can't reach the dev server:
- Confirm both devices are on the same network (some guest/corporate Wi-Fi
  blocks device-to-device traffic — a phone hotspot is a good fallback).
- Allow Node/Vite through the Windows Firewall on **private** networks if
  prompted.

Sign in (or register) with a real `/client` account — the same accounts used
by the desktop Client UI.

## Building for production

```bash
npm run build   # outputs to dist/
```

The dev proxy only exists in `npm run dev`. A production deploy needs one of:

1. **Same-origin (recommended)** — serve `dist/` behind the same reverse
   proxy (Caddy on the OCI VM) that serves the API, e.g. under `/m/*` or a
   `m.` subdomain that also forwards `/client/*` to the backend. No CORS
   changes needed.
2. **Different origin** — add the app's hosted origin to
   `BIDMANAGER_CORS_ORIGINS` in `deploy/oci/.env`, then redeploy the backend
   (requests are always relative `/client/*` paths, so this is the only
   backend-side change needed).

## Add to Home Screen

The app ships a `manifest.webmanifest` + Apple meta tags for an app-like
icon/splash on the home screen. Installing a PWA generally requires a
**secure context (HTTPS)** — plain `http://<lan-ip>` dev testing works fine
in a normal browser tab, but for the "Add to Home Screen" flow use the
production HTTPS deploy (or a dev tunnel).

`public/icon.svg` is a placeholder logo — export it to `icon-192.png`,
`icon-512.png`, `icon-maskable-512.png`, and `apple-touch-icon.png` (any
image tool / online SVG-to-PNG converter) before shipping, since the
manifest references the PNG files.

## Feature notes / limitations

- **App lock** (More screen) uses the device's platform biometric (Face ID /
  Touch ID / Windows Hello) via WebAuthn purely as a local re-entry gate on
  top of the existing signed-in session — it is not a second server-side
  auth factor, and the row only appears where the browser reports platform
  authenticator support.
- **Deadline reminders** (Alerts screen) are best-effort and foreground-only:
  there's no service worker/push server, so nothing fires while the app/tab
  is closed. The Alerts list itself is always populated from real local
  events regardless of whether notifications are enabled.
- **File attachments** (Projects → checklist) are session-local: the actual
  file only lives in memory on the device that attached it. Attachment
  *metadata* (name/size/type) syncs via `/client/sync` so other devices see
  that something was attached, but re-attaching is needed to preview it
  elsewhere.
- **Export CSV** and **Checklist templates** rows are real and a stub
  ("coming soon" — no backend endpoint) respectively, matching the reference
  prototype's own scope notes.

## Project layout

```
src/
  lib/        transport (http.js, api.js), auth, local store (bookmarks,
              theme, settings), cross-device sync (bookmarks + projects/
              checklist), local projects/checklist store, local alerts feed,
              deadline-check + app-lock + CSV-export helpers, formatting
  hooks/      React Query hooks per screen's data needs
  components/ shell (tab bar, header, auth/app-lock gates), feedback
              (toasts, empty/error/skeleton states), common primitives,
              tender + project + dashboard screen-specific components
  screens/    one file per route (Overview, Tenders, Tender detail,
              Organisation tenders, Projects, Project detail, Alerts, More,
              Sign in)
  router.jsx  route table (react-router v6)
  App.jsx     top-level RouterProvider
  main.jsx    entry point
```
