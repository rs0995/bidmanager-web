# BM Server — Server Mobile App

Phone admin console for the BidManager server. It mirrors the desktop **Server UI**
(`../Server UI/BidManagerControl.jsx`) and talks to the same FastAPI backend
(`../Server UI/server/api_server.py`) with the `x-admin-key` header.

## Hard rules
- **Self-contained folder.** Everything this app needs lives in this folder. Files from
  elsewhere in the repo are *copied* in, never edited in place. Do not modify
  `Mobile App EH/`, `Server UI/`, or any root file from work on this app.
- **Bare React Native 0.86 + TypeScript.** No Expo in any form (no `expo-*`, EAS, prebuild).
- **No hand-written native code** (Swift / Obj-C / Kotlin) beyond the RN template files.
  Native features come from community libraries that support RN 0.86 + New Architecture.
- **All native access goes through `src/platform/*`** (secureStorage, clipboard…). Screens
  never import a native library directly.
- iOS first. Android is scaffolded but not built yet.

## Identity
- iOS bundle ID `com.raku.s0995.bidmanager-server`, Android `com.raku.s0995.bidmanageradmin`.
- Display name "BM Server"; RN module name `BidManagerAdmin`.

## Design (matches the desktop Server UI)
- One fixed look copied from `c` in `../Server UI/BidManagerControl.jsx`: paper ground
  (#E9EDF1), white cards with 1px rule borders, **square corners**, indigo (#23408E) as the
  only accent. Seal / amber / stamp are for state only (ok / warn / error).
- **No dark mode and no colour options**: the desktop has none, so neither does this app.
- Fonts as on the desktop: IBM Plex Sans (UI), IBM Plex Sans Condensed Bold (titles),
  IBM Plex Mono (labels, numbers, IDs, log lines).
- Desktop chrome: white masthead "BidManager CONTROL" + environment + connection pill; red
  captcha bar; panel header with a boxed mono section code (SRV, JOB…) and condensed title
  over a rule. Read-only vitals use the dotted register row (`KeyValue`); editable fields
  use `SettingRow` (amber dot = unsaved). Logs are the one inverted (dark) surface.
- Styling: `StyleSheet` + `useTheme()` tokens from `src/theme`. No hard-coded colours in screens.
- Use the kit in `src/components/ui` (Txt, Screen, Card/Section, ListRow, KeyValue, Button,
  StatusPill, StatStrip, MeterBar, FilterChips, SegmentedControl, Toggle, Checkbox,
  TextField, SearchField, SettingRow, WeekdayPicker, Sheet, ConfirmSheet, EmptyState, Toast).

## Scope (8 sections)
Bottom tabs: Server, Scraper, Users, Jobs, More. Under More: Captchas, Archive, Logs,
Settings (More carries the waiting-captcha badge; the red captcha bar shows on every screen).
Saved jobs (Scraper tab) are separate `JobCard`s: name/type, "N Orgs · Every 4h · M Tu W Th F Sa",
last/next run, and an action row (Run once, Pause/Resume, red icon-only delete). Tapping a card opens
`JobDetail` (scope checklist; untick + save removes items). The editor puts Schedule above the scope
and uses `DateTimePicker` (calendar + time list, synced with the typed IST field) and a number + unit
interval like the desktop. Saving goes through `src/lib/savedJobs.ts` (`jobToInput`,
`saveJobKeepingPause`): the server needs a future time, and a PUT would otherwise resume a paused
job. User detail shows the account, and each synced-data part opens `UserSyncList`.
Organisations (server 2026-10-23, see Server UI/restore/2026-10-23/CHANGES.txt): the Users tab has a
People / Organisations switch; `OrgDetail` manages name, join code, join requests, members (role,
sections, remove keep/wipe), add member and dissolve. User detail has an Access card (per-section
toggles; org admins always have every section). Shared pieces live in `src/components/OrgPieces.tsx`.
Joining or leaving an org signs the user out, so never exercise these actions against production
just to test; the fake server covers them.
Settings = the **Job queue** card only. Files and Database are intentionally not included.
Restart is not offered: the server returns 501 for it.

## Phases
- **Phase 0** scaffold, **Phase 1** every screen, **Phase 2** logic — all done (2026-10-14).
- Data layer: `src/lib/api.ts` (port of the desktop's `apiFetch`/`createApi`; 30 s timeout,
  `x-admin-key`, server `detail` as the error), typed shapes in `src/lib/types.ts`, react-query
  hooks in `src/lib/queries.ts` (keys `[base, name, …]`, polling only while focused;
  `useAction` for mutations), live logs in `src/lib/logs.ts`.
- Session (`src/state/session.tsx`): profile in AsyncStorage, admin key in the keychain
  (`src/platform/secureStorage`), health every 15 s, captcha queue every 8 s. No key → Connect.
- Server facts worth knowing: snake_case `*_at` fields are epoch **seconds**, camelCase
  `startedAt/receivedAt/expiresAt` are **ms**; `/v1` lists are bare arrays; scheduler paused /
  drain state is read from `/admin/config`; job progress is only 0 or 100; one pending captcha
  at a time; log lines have no level/source (classified client-side like the desktop).
- Tests run against `test-support/fakeServer.ts` (mocked fetch, real response shapes).

## Browser preview
`npm run dev` → http://localhost:5174 (react-native-web + Vite, config in `web/`). A 430×932
iPhone frame with simulated status bar. Each screen has a preview URL (/jobs, /users,
/captchas, /logs, /settings, /users/1…). For Phase 2,
the Vite dev server proxies API calls (`/__bm_proxy`, target in `x-bm-target`) because
browsers enforce CORS and the server only allows the desktop's origin. Native builds call the
server directly.

## Checks
`npm run typecheck`, `npm test` (renders every screen on fixtures), `npm run lint`.

## Server API changes
Before working on accounts, organisations, tab visibility (section permissions) or portal tender search or checklist file sharing, read `../Server UI/server/API_CHANGES.md`. It lists the live and ready server routes and this app's to-do (section 4). Don't edit `Server UI/server/` from here; ask the server session for any API change.

Status against API_CHANGES.md (2026-10-24): §1 organisations and section permissions are done in this app
(Users → People/Organisations, OrgDetail, user Access card). §2 portal search needs only the
operator switch here: `portal_search` is the fifth section, **off by default** (missing = default
via `SECTION_DEFAULTS` / `sectionOn` in `src/components/OrgPieces.tsx`), shown as a "Portal
search" pill on Users and labelled in Jobs. There's no Captcha row: captcha is never gated.
