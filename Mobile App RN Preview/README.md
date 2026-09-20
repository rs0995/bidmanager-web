# BidManager mobile preview

A separate React Native / Expo iOS frontend. The original `Mobile App RN` app is unchanged. No Electron application or backend integration is included.

## First pass

- Overview dashboard: pipeline value, saved opportunities, deadlines and bid progress.
- Tenders: search, category / portal filters, bookmarks and a tender detail sheet.
- Projects: project cards, local submission checklists and stage selection.
- Lightweight Alerts and More screens preserve the original navigation. Sample document previews are available through tender details.

All tender records are fictional demonstration fixtures. Dates are anchored to 19 September 2026. Bookmarks, project changes and preferences are saved only to this preview's local storage. The app has a separate bundle identifier and storage key; it does not access the original app's account, database or services.

## Run

```sh
npm install
npm start
```

Open with an Expo SDK 57-compatible client on iPhone. For a native iOS build on a Mac with Xcode:

```sh
npm run ios
```

Browser preview (renders the same React Native components in a narrow mobile layout):

```sh
npm run web
```

## Checks

```sh
npm run typecheck
npm run build:web
npx expo export --platform ios --output-dir dist-ios
```

An iOS JavaScript export is not a signed iPhone build. Native simulator/device validation requires macOS/Xcode or an EAS build. `eas.json` supplies separate simulator and device profiles; this preview is intentionally not linked to the production EAS project.

## Design

Light, cool-neutral surfaces with a muted teal accent. Bricolage Grotesque headings preserve the original app's typographic identity; IBM Plex Sans handles supporting text. Rounded native sheets, safe-area-aware tabs, and short thumb-friendly flows keep the design mobile-first. Motion is limited to native sheet transitions and press feedback.

Palette: background `#F4F7F8`, surface `#FFFFFF`, ink `#192D35`, muted text `#687C83`, accent `#126E68`, urgent text `#A64532`.

## Later

Connect authentication, live tender feeds, synchronisation, original document downloads and notifications. Split the first-pass screens into feature modules as those workflows are added. No production integrations or account credentials are present.
