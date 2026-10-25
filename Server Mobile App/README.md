# BM Server (Server Mobile App)

Bare React Native app for administering the BidManager server from a phone.
See [AGENTS.md](AGENTS.md) for rules, design and the phase plan.

```sh
npm install
npm run dev        # browser preview at http://localhost:5174
npm run dev:phone  # same, reachable from a phone on the LAN
npm test           # render every screen on fixtures
npm run typecheck
```

Native builds (iOS first): `cd ios && bundle exec pod install`, then build `BidManagerAdmin`
in Xcode. Android is scaffolded but not built yet.

## Admin key pre-fill (local only)

`src/lib/adminKey.local.ts` is git-ignored and must exist for the app to build. On a
fresh clone create it with:

```ts
export const DEFAULT_ADMIN_KEY = '';
```

Put the server's `ADMIN_API_KEY` in it to have the Connect screen pre-filled. The key is
compiled into the app, so only install such a build on your own devices.
