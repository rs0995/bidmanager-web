# Client application process flow

## Product boundary

The operator/server application remains responsible for scraping portals, CAPTCHA handling, downloading source documents, normalizing records, and publishing client-safe tender data. The Client UI is responsible for viewing that published data and for the user's private bid-management work.

```text
Tender portals
    |
    v
Operator / scraper server
    |
    | published snapshot or read-only tender APIs (only on explicit Sync)
    v
Client IndexedDB
    |
    +--> Dashboard and tender browser
    +--> Bookmarks, projects, templates, checklists
    +--> Desktop project folders and document attachments
```

## Startup flow

1. React starts without checking or launching a backend.
2. The local data adapter opens the `bidmanager-client` IndexedDB database.
3. Dashboard, tenders, projects, templates, and settings read from that local database.
4. Electron exposes a narrow filesystem bridge for choosing folders, copying attachments, renaming files, opening paths, and creating the standard project subfolders.
5. The application remains fully usable offline.

## Sync flow

1. The user saves or tests an editable backend URL and client API key in Settings. The production Cloud Run URL is the default.
2. The client calls only authenticated `/client/*` endpoints and downloads every tender page into its offline cache.
3. Incoming tender and website records replace the locally cached published dataset.
4. Local bookmark state is merged back onto matching tender IDs.
5. Projects, checklist items, local templates, documents, and settings are never sent to the server.
6. The last successful sync time is saved locally.

This first version does not auto-sync. That avoids an unexpected network dependency and keeps the offline behavior clear. A later version can add scheduled sync with an explicit opt-in and authentication.

## Local save and recovery flow

- Structured app data: IndexedDB.
- UI preferences: browser local storage through Zustand.
- Project documents: normal filesystem folders chosen by the user (desktop only).
- Tender list sharing: CSV export from the Tenders page.

The browser build can manage structured data, but browser security prevents arbitrary local folder management. Native file/folder actions are therefore desktop-only.

## Delivery plan

### Phase 1 — desktop foundation (implemented)

- Copy the current UI into an isolated `Client UI` application.
- Remove all scraping, CAPTCHA, operator logs, website administration, and backend startup behavior.
- Add local persistence and one-way cloud data sync.
- Retain desktop file/folder workflows through a restricted Electron bridge.

### Phase 2 — server publishing contract

- Keep the versioned `/client/*` contract backward compatible as the Client UI evolves.
- Add authentication, tenant/user scoping, pagination or incremental cursors, and published-data version metadata.
- Keep scraper/admin endpoints inaccessible to client credentials.

### Phase 3 — production desktop hardening

- Define conflict rules using stable tender UUIDs instead of database row IDs.
- Add encrypted credential storage, signed builds, migration tests, and installer smoke tests.
- Decide whether documents are local-only or downloaded through short-lived signed URLs.

### Phase 4 — web and mobile

- Reuse the React UI and local data adapter for the web app.
- Add responsive layouts for narrow screens.
- Package mobile with Capacitor or React Native after deciding how attachments and offline file access should behave.
- If multi-device synchronization is required, add an authenticated user-data API; do not overload the scraper API for private project data.
