# Bidwise

Bare React Native 0.86.3 app (TypeScript, **no Expo**). It is the enhanced BM Pro with the "bidwise" design. The design reference is `reference/bidwise-preview.html`, and the notes are in `reference/DESIGN.md`.

## Rules
- **iOS first.** Android is scaffolded but not built or tested. Don't spend effort on it unless asked.
- No Expo in any form, and no hand-written Swift or Kotlin. All native access goes through `src/platform/`.
- This folder is self-contained. Code from other folders is **copied in**, never imported. Never edit `Mobile App EH/`, `Mobile App RN/` or root files from work on this app.
- The Overview tab **is Mobile App EH's dashboard**: `DashboardScreen` + `components/dashboard/*`, kept as-is. Everything else follows the bidwise reference.
- Every screen must work in Solid and Liquid glass, in Light and Dark, and with all 5 accents. No hard-coded colours; use `useTheme()` tokens.
- UI text is client-friendly: say "update", never "scrape".
- Only build, bump the version or upload when asked. TestFlight goes only through `~/.testflight/testflight.sh` on the Mac.

## Identity
Display name "Bidwise". iOS bundle ID `com.raku.s0995.bidwise`.

## Commands
- `npm run typecheck`, `npm run lint`, `npm test`
- `npm run dev`: browser preview in an iPhone frame, with a theme panel.
- Fonts (Inter, Space Grotesk, IBM Plex Mono) are in `assets/fonts` and linked with `npx react-native-asset`.

## Data modes
- `App mode="live"` (the phone, `index.js`) talks to `https://161.118.170.233.sslip.io/client/*`.
- `App mode="demo"` (browser preview and tests) runs on `src/fixtures/`. The server refuses browser requests (CORS), so the preview always uses demo.
- Screens never import data directly. They use the context hooks (`useBookmarks`, `useProjects`, `useSession`, `useCaptcha`, `useNotifySettings`, `useAlerts`) and `useTenderSource()` / `useActions()` from `src/data/`. Live versions of the contexts are in `src/live/LiveProviders.tsx`.
- The `/client/sync` blob is shared with BM Pro and the desktop Client UI:
  - Projects and checklist rows must keep their exact shared fields (`src/lib/sharedProjects.ts`).
  - Bidwise-only data (Docs for Preparation) stays local.
  - Storage keys use the `bw.` prefix.
- The live API layer is ported from BM Pro on the Mac (`~/bidmanager-web/Mobile App RN/src/lib`, newer than the Windows copy).

## Status
- Phase 1 (all screens on sample data) is done.
- Phase 2:
  - Done: 2A (keychain session, API client, real sign-in and sign-out), 2B (live tenders, organisations, stats, tender details, archive), 2C (bookmarks, projects and checklist through the shared sync blob), 2D (document download / open in QuickLook / ZIP contents, Request documents, Check for updates, re-download of broken files, live Downloads, CSV export).
  - Done: 2E (in-app Alerts from /client/changes, status/corrigendum snapshot, closing reminders, Documents pending, downloads finished, checklist complete; app lock with Face ID through react-native-keychain).
  - Not done, by decision (2026-10-16): push notifications (the server's APNS_TOPIC is BM Pro's bundle id, so it can't push to Bidwise without a server change) and local notifications (Notifee). Both are to be picked up later.
- Browser preview: live-only native modules are aliased to `web/shims/native.ts`.
- BM Pro fixes R1–R5 were carried over on 2026-10-16:
  - Notification preferences carry `updatedAt`; the newer copy wins, and a fresh install sends none.
  - Attachments are copied to `Documents/attachments/<itemId>/<name>` with `device: "phone"`.
  - The checkbox toggles Pending/Completed.
  - The desktop's `checklist_folders` is preserved.
  - New projects get **no** starter checklist; the message reads "“<title>” added to Projects."
  - Keep these in step with BM Pro on the Mac.
- The Mac copy is at `~/bidmanager-web/Bidwise`. It is copied with tar (not git), excluding `node_modules`, `ios/Pods` and `ios/build`. Then run `npm ci` and `pod install` there.
- `ios/Bidwise.xcodeproj/project.pbxproj` and `ios/Podfile.lock` are the Pods-integrated versions. Never copy a non-integrated `project.pbxproj` over the Mac's, or the build fails with "Unable to find module dependency 'React_RCTAppDelegate'".
- The minimum iOS version is 15.5 (`react-native-zip-archive` needs it).
- App icon: `ios/Bidwise/Images.xcassets/AppIcon.appiconset/AppIcon-1024.png`, a single universal 1024 px image, opaque with square corners (iOS rounds them): the bidwise mark, two slanted white-to-ice-blue slabs on a near-black tile with a warm orange glow from below. The in-app version is `BrandMark` in `src/components/ui/Wordmark.tsx` (same geometry, colours in `BRAND` in `src/theme/tokens.ts`).

## Server API changes
Before working on accounts, organisations, tab visibility (section permissions) or portal tender search, read `../Server UI/server/API_CHANGES.md`. It lists the live and ready server routes and this app's to-do (section 3). Don't edit `Server UI/server/` from here; ask the server session for any API change.
