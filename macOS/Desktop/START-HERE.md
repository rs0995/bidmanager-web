# BidManager Executive

This folder contains the desktop redesign copied from Client UI.

Open a terminal in this folder and run:

```sh
npm ci
npm run desktop:dev
```

For a renderer build:

```sh
npm run build
```

To package on a Mac:

```sh
npm run desktop:mac
```

Mac distribution still requires your signing and notarization setup. The existing Windows packaging command is `npm run desktop:dist`.

The default theme is Executive Light. Use the top-toolbar theme button to switch to Graphite Dark. Appearance settings retain density, scale, and accent customization.

This edition uses an independent Electron profile named BidManager Executive. Sign in with your existing account to use connected functionality. Existing local-only files and projects are not automatically migrated from the original desktop profile.

See DESIGN.md for the visual direction, scope, and verification limitations.
