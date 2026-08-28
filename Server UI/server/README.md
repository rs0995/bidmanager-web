# BidManager server backend (source of truth)

> Current architecture: this directory is the single maintained backend for the admin UI,
> Client UI, desktop app, API/worker deployment, Postgres, and Drive. The root `backend/`
> tree is disabled.

## Client-safe API

Each Client UI install signs in as its own account (`POST /client/auth/register` /
`POST /client/auth/login`), gets a per-device token, and sends it as `x-client-key` on
every subsequent call. All data routes require a valid, non-suspended account and return
no database paths, Drive IDs, storage credentials, scraper controls, configuration, job
controls, or mutation operations beyond what's listed below.

- `POST /client/auth/register`, `POST /client/auth/login`, `POST /client/auth/logout`
- `GET /client/health`
- `GET /client/tenders`
- `GET /client/tenders/{id}`
- `GET /client/tenders/{id}/documents`
- `GET /client/search`
- `GET /client/stats`
- `POST /client/tenders/{id}/download-request` — signs an existing file for download
- `POST /client/tenders/{id}/request-download` — enqueues the same scrape/download job
  the admin console uses for a single tender, for tenders with no documents yet
- `GET /client/tenders/{id}/download-status` — polls the job started above

Listing and search provide server-side pagination, filtering, and whitelisted sorting.
`download-request` does not run a scraper or write to the database; it creates a
short-lived signed URL for an existing file and streams it without exposing Drive access.
`request-download`/`download-status` are the only client routes that trigger real work —
they reuse the existing durable job queue (`background_jobs`, action
`download_single_tender`), including its captcha handling.

A suspended account (see Server UI's Users tab) is rejected on its very next call with a
403 and `{"reason": "suspended"}`, not just at its next sign-in — every active token for
that account is revoked immediately on suspension. Every authenticated call is logged to
`client_activity_log` (user, route, tender) for that Users tab to read.

It powers `Server UI/BidManagerControl.jsx` and all other server consumers from one
maintained implementation.

## Server capabilities

- For legacy local data, `app_paths.json` can point at an existing data directory (`tender_manager.db`,
  `Tender_Downloads`, `My_Tender_Projects`, `Checklist_Templates`) via absolute paths, so
  the Files and Database tabs reflect the live system.
- Wider `ADMIN_CONFIG_KEYS` whitelist (covers every field the console's Settings tab has,
  not just the original 11).
- Extra routes: `POST /admin/captchas/{id}/refresh`, `POST /admin/storage/folder`,
  `DELETE /admin/storage`, `POST /admin/storage/signed-url`, `GET /admin/storage/download`,
  `POST /admin/db/vacuum`, `POST /admin/db/backup`.
- Richer `/admin/jobs` (`portal`, `kind`, `tenderId`, `startedAt`) and `/admin/metrics`
  (`requests1h`, `p95`, `p99`, `errorRate`, `cpuPct`, `memPct` via `psutil`).
- CORS defaults include the console's dev/preview ports (5174/4174).
- Default port **8090** (not 8000), so this can run alongside the real backend without a
  port clash.

## Known limitations

- Jobs and CAPTCHA requests are durable database records. Queued jobs resume after a
  process restart. A job that was actively running when its worker disappeared is marked
  failed for operator review instead of being duplicated automatically.
- Scraper execution still uses the bounded worker pool inside the API process. Moving the
  worker claim to Cloud Tasks or Cloud Run Jobs is the next infrastructure step for fully
  independent API and worker scaling.
- Captcha "refresh" re-sends the same cached image; there's no hook to trigger a real
  portal-side reload.
- Server "Restart" is unsupported (`501`). Failed and cancelled jobs can be retried from
  the existing Jobs screen.
- Postgres DB backup is unsupported (`501`, no `pg_dump` available); vacuum works for
  both engines.
- Two processes (this one + the real backend, if both running) writing the same SQLite
  file can occasionally hit "database is locked" under concurrent writes.
- CAPTCHA providers currently return text only, so `captcha_confidence_min` cannot be
  enforced until a provider supplies a calibrated confidence value. Desktop/sound/email
  CAPTCHA alerts also need a notification provider. The Captchas screen remains the
  supported alert surface.
- `poll_interval_ms` is a client-application concern. Viewer clients must read and apply
  it; changing it does not alter the server's own scheduler interval.

## Enforced operational settings

- `max_concurrent_sessions` is applied live by the bounded worker pool, while
  `max_queue_depth`, read-only mode, and drain mode reject new work at admission time.
- `job_ttl_minutes` cancels queued or running jobs that exceed their configured lifetime.
  Completed job history is retained separately for seven days by default; override it
  with `BIDMANAGER_JOB_HISTORY_DAYS` (1-90).
- The scheduler uses a database lease so multiple API instances do not launch the same
  interval together. It respects the scheduler pause, interval, portal toggles, read-only,
  and drain settings.
- Tender fetches can enqueue document downloads automatically. Active single-tender
  downloads are deduplicated by tender ID when configured.
- Request retries/backoff, page-load timeout, browser headless mode, user-agent rotation,
  allowed download extensions, and maximum file size are enforced by scraper code.
- CAPTCHA automatic/manual attempt counts and manual wait time are enforced. If no one
  answers, the durable job either requeues within `retry_attempts` or fails, according to
  `captcha_on_no_answer`.
- Proxy rotation reads comma-separated proxy URLs from `BIDMANAGER_PROXY_URLS`; the
  configured proxy pool must be something other than `none` for it to be active.

## Google Drive storage

Set `GOOGLE_DRIVE_FOLDER_ID` to the root folder managed by BidManager and share that
folder with the Cloud Run service account. Cloud Run uses its attached service account
through Application Default Credentials; a JSON service-account key is not required.
`GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` and `GOOGLE_APPLICATION_CREDENTIALS` remain
available for local development.

Drive paths are resolved one folder at a time beneath the configured root, and listings
follow all Drive API pages. Uploads use the configured `storage_prefix`, then the tender
ID, and update an existing same-name file instead of silently creating another copy.
Duplicate same-name items in one folder are rejected as ambiguous so delete/download
operations cannot target an arbitrary match.

Download links point back to the backend and carry a path-bound, expiring HMAC token;
the admin key is never placed in the URL. Token lifetime follows `signed_url_ttl_min`.
Cloud deployments use `ADMIN_API_KEY` as the signing secret by default. You may set a
separate shared `BIDMANAGER_DOWNLOAD_TOKEN_SECRET`, which is required if download links
must remain valid across instances that do not share an admin key.

Native Google Docs, Sheets, and Slides are not exported by this endpoint. Tender files
uploaded by BidManager are ordinary binary files and can be streamed directly.

## Cloud Run runtime and persistence

Cloud mode ignores `app_paths.json`. SQLite placeholders, browser downloads, project
scratch folders, and templates are placed beneath `BIDMANAGER_RUNTIME_DIR` (default
`/tmp/bidmanager`) and are never treated as durable state. Local mode continues using
the configured desktop folders.

Downloaded files cross a document-storage adapter. With Drive configured, each file is
uploaded before its temporary copy is removed, Neon stores the `gdrive://` reference,
and subsequent full/update decisions check Drive rather than container file existence.
Project folders use `projects/active` or `projects/archived` in Drive with Ready Docs,
Tender Docs, and Working Docs children. Tender-to-project synchronization uses Drive
server-side copies.

Production/staging startup refuses to use ephemeral SQLite: configure `DATABASE_URL`,
`POSTGRES_URL`, or `POSTGRES_CONNECTION_STRING`. Scraping jobs also refuse to download
unless `GOOGLE_DRIVE_FOLDER_ID` is configured. Public health reports
`durableStorage: false` and a degraded state when Drive is missing.

The included `Dockerfile` installs Firefox and pre-caches geckodriver during the image
build. `cloudrun.api.service.yaml` (request-serving, autoscaled) and
`cloudrun.worker.service.yaml` (the always-on scheduler/job worker, single instance) are
the deployment templates; replace their image and Drive folder placeholders, create the
referenced Secret Manager secrets, and deploy both with a Cloud Run service account that
has access to the Drive root folder. There is no Render deployment target — Render's
build never installs a browser, so it cannot run the scraper.

## SQLite to Neon migration

The compatibility layer preserves SQLite-style rows, cursor iteration, `lastrowid`,
`total_changes`, statement-level uniqueness handling, and SQL used by the current app.
SQLite `REAL` columns are created/migrated as PostgreSQL `DOUBLE PRECISION` so epoch job
timestamps do not lose precision.

To perform a one-time data copy, set the Neon connection string and run:

```bat
set DATABASE_URL=postgresql://...
python migrate_sqlite_to_postgres.py --sqlite "C:\path\to\tender_manager.db"
```

The migration includes scraper data, projects, templates, settings, durable jobs,
CAPTCHA requests, and scheduler leases. Existing rows are retained on conflict and
PostgreSQL sequences are advanced after copying. Take a backup of the source SQLite file
and test against staging before migrating production.

## Running locally: storage modes

This same server can run on a local machine (e.g. via `backend_server.py`) instead of
Cloud Run. Two modes are available, both driven by the env vars already described above:

- **Direct to cloud** — set `DATABASE_URL`/`POSTGRES_URL` and `GOOGLE_DRIVE_FOLDER_ID`
  (plus `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS`) before
  starting the local process. Scraping and downloading run on this machine, but every
  write lands directly in the shared Postgres DB and Drive folder, same as Cloud Run.
- **Fully local** (default) — leave those env vars unset. Scraping/downloading writes to
  local SQLite and local disk, exactly like today. `GET /admin/health` reports
  `providers.database.engine` / `providers.storage.provider` so you can see which mode is
  active.

When running fully local, use **Push to Cloud** (a button in the operator console's
Connection settings, or `POST /admin/push-to-cloud` / `POST
/v1/websites/{id}/tenders/push-to-cloud`) to sync locally-scraped tenders and downloaded
files up to the cloud on demand. This requires a *separate* pair of env vars — kept apart
from the ones above so a fully-local instance doesn't start writing to the cloud during
normal scraping, only when you explicitly push:

- `CLOUD_PUSH_DATABASE_URL` — Postgres connection string for the cloud DB.
- `CLOUD_PUSH_DRIVE_FOLDER_ID` — the cloud Drive folder to upload files into (reuses
  `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`/`GOOGLE_APPLICATION_CREDENTIALS` for credentials).

Pushing is incremental: each tender and downloaded file is stamped with
`pushed_to_cloud_at` once pushed, and a tender is re-pushed only if it changed
(`last_changed_at`) since its last push. Tenders are matched into the cloud DB by the
same natural key the scraper itself uses (website + tender ID/URL), not by row ID, so
pushing never collides with tenders the cloud side scraped independently.

## Running it

```bat
cd "Server UI/server"
pip install -r requirements.txt
set BIDMANAGER_ENV=local
set ADMIN_API_KEY=devkey123
python api_server.py               # serves on http://0.0.0.0:8090
```

Then in the console (`http://localhost:5174`), set env to Local, base URL to
`http://127.0.0.1:8090`, and enter the same admin key.

Loopback-only local requests may run without keys for Electron development.
LAN callers are never included in that exception.

## Required staging/production security configuration

Set these through Cloud Run environment variables and Secret Manager:

```text
BIDMANAGER_ENV=staging|production
ADMIN_API_KEY=<admin console secret>
BIDMANAGER_CLIENT_API_KEY=<write key for /v1 mutations from a non-loopback caller>
BIDMANAGER_DOWNLOAD_TOKEN_SECRET=<independent signed-download secret>
```

`BIDMANAGER_CLIENT_API_KEY` is unrelated to end-user accounts — it only satisfies
`_protect_client_mutations`, the guard on state-changing `/v1/*` requests from a
non-loopback caller (alongside `ADMIN_API_KEY`, which also works there). The isolated
`/client/*` routes are authenticated per-account instead: `x-client-key` carries the
per-device token issued by `/client/auth/register` or `/client/auth/login`, not a shared
secret. Admin routes (including the Users tab's moderation endpoints) require
`x-admin-key`; client account tokens never satisfy it.
