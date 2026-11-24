# BidManager Client UI

This folder is an isolated, cloud-fed client derived from the existing frontend. It contains no scraper, CAPTCHA, job queue, portal configuration, or bundled Python backend.

## Current desktop application

The desktop client can:

- browse active and archived tenders;
- bookmark tenders and turn them into local projects;
- manage projects, checklists, templates, attachments, and folders;
- export tender lists as CSV;
- download published tender data from the configured BidManager cloud server.

User-owned workspace data and the cloud tender cache are stored locally in IndexedDB. In Electron, that database lives inside the operating system's application-data directory managed by Electron. Project documents remain ordinary files in the parent folder selected in Settings.

## Run and build

```powershell
npm install
npm run dev
npm run desktop:dev
npm run build
npm run desktop:dist
```

`npm run dev` runs the browser version. `npm run desktop:dev` launches the desktop shell. `npm run desktop:dist` creates a Windows NSIS installer in `dist-electron`.

## Data source and server behavior

The client can use previously synchronized data while offline. On an empty installation, tender data is available only after configuring the backend URL and client API key in Settings and pressing **Sync Tenders**.

The production Cloud Run URL is prefilled but remains editable. The key is stored only in
the client's IndexedDB and is sent in the `x-client-key` header. Sync uses only:

- `GET /client/health`
- `GET /client/tenders` with server-side pagination and sorting
- `GET /client/stats`

There is no `/v1/*` or `/admin/*` fallback. Server interaction is deliberately one-way.
Sync downloads published tender records and derives source summaries locally. It does not
upload projects, bookmarks, templates, checklist edits, settings, or files, and it never
calls scraping endpoints. Locally stored bookmarks are retained by tender ID.

See [PROCESS_FLOW.md](./PROCESS_FLOW.md) for the implementation plan and end-to-end flow.
