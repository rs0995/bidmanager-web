# BidManager Executive — desktop redesign

## Recommended direction: Executive Light

Silver navigation (#EDF0F4), white work surfaces (#FFFFFF), ink text (#202C3D), muted text (#5C697A), blue actions (#245FBA), and subtle borders (#DCE2E8). Native system typography uses SF on macOS and Segoe UI on Windows. The light theme is the initial preference for this edition.

The sidebar separates Workspace, Discover, and Library. A location bar keeps the current page visible. The dashboard gives metrics a single continuous surface, and tables use sentence-case headers with more comfortable row spacing. The sign-in screen explains the three main jobs: discovering opportunities, preparing bids, and meeting deadlines.

## Alternative included: Graphite Dark

Graphite canvas (#181C22), raised surfaces (#20252D), light text (#E9EDF5), and blue accents (#8EB8FF). Switch using the sun/moon control in the top toolbar. This uses the same layouts and saved appearance preferences.

## Another direction to consider

A compact analyst edition could place more emphasis on tender tables and a persistent detail pane. This is a future layout option, not an implemented third theme. The copied app retains its existing density and column controls.

## Scope and integrity

Copied the original Client UI source, Electron bridge, and project configuration. Preserved the application workflows and API implementation. Changes are concentrated in src/App.jsx, src/executive.css, the default UI preference, and desktop package metadata. The desktop profile has its own user-data directory; the original application's profile is not migrated automatically.

The existing macOS/Client UI directory is not overwritten. The original Client UI source is not edited. This is a desktop UI iteration; no mobile redesign was made. Environment files, dependencies, and generated installers were not copied into this deliverable. The original default server configuration remains in the copied source.

Mobbin was requested, but its connector returned a paid-plan requirement. No Mobbin screen was retrieved or used as a claimed visual reference.

## Validation

React JSX parsing passed for App.jsx and main.jsx. Electron main-process syntax passed. The normal Vite build could not run because the environment refused the esbuild helper process with spawn EPERM. Runtime visual review, authenticated workflows, and macOS packaging are not verified. Run the build and inspect the app before release.
