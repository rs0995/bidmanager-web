# BidManager on OCI Always Free

Runs the maintained `Server UI/server` backend on one OCI Compute VM with Chromium/Selenium
and automatic HTTPS via Caddy. This is a **compute-only move off Google Cloud Run**:

- **Database:** the existing external **Neon Postgres** is kept as-is. No Postgres runs on
  the VM. Set `DATABASE_URL` in `.env` to the same value Cloud Run used.
- **Documents:** **Google Drive** is kept as-is. Cloud Run authenticated to Drive with its
  attached service account (ADC); a VM cannot, so a **JSON key for that same service
  account** is mounted at `./drive-sa.json`. No document migration, all `gdrive://`
  references keep working.
- **Secrets:** `ADMIN_API_KEY`, `BIDMANAGER_CLIENT_API_KEY`, and
  `BIDMANAGER_DOWNLOAD_TOKEN_SECRET` are carried over verbatim from GCP Secret Manager so
  issued admin keys, client tokens, and signed download URLs stay valid.

## What the owner must provide

1. An OCI Always Free compute instance in `bidmanager-vcn` on a **public subnet**:
   Ubuntu 24.04, `VM.Standard.A1.Flex`, 4 OCPU / 24 GB, ~100 GB boot volume, with a
   **reserved public IPv4**. (An AMD micro instance is too small for a headless browser.)
2. A domain/subdomain whose `A` record points to that IP. No domain yet → use
   `<public-ip>.sslip.io` as `BIDMANAGER_DOMAIN` for now.
3. OCI security-list / NSG ingress: TCP 22 from the admin IP only; TCP 80 and 443 from
   `0.0.0.0/0`. Do **not** open 5432. Also open 80/443 in the VM's own `iptables` (OCI
   Ubuntu images ship a restrictive default).
4. `deploy/oci/drive-sa.json` — a JSON key for the Drive service account already shared as
   Editor on the Drive root folder. `chmod 600`.
5. Values for `.env` (see `.env.example`): `BIDMANAGER_DOMAIN`, `OCI_REGION`,
   `OCI_INSTANCE_ID`, `DATABASE_URL` (Neon), `GOOGLE_DRIVE_FOLDER_ID`, and the three
   carried-over secrets.
6. A cutover time. Pause the Cloud Run scheduler (or scale both services to 0) during the
   switch so two schedulers do not race on the shared Neon lease.

## VM preparation

Install Docker Engine and the Compose plugin from Docker's official Ubuntu repository, then
clone/copy this repository to the VM. From the repository root:

```bash
cd deploy/oci
cp .env.example .env
nano .env                       # fill everything in
# place drive-sa.json here (scp from your machine), then:
chmod 600 .env drive-sa.json
docker compose config           # sanity-check interpolation
docker compose up -d --build    # native arm64 build on the Ampere VM
docker compose ps
curl https://<BIDMANAGER_DOMAIN>/health
```

Caddy obtains and renews the TLS certificate automatically once DNS resolves and ports
80/443 are reachable.

## Database

Nothing to migrate — the backend connects to the same Neon database Cloud Run used. Verify
with `GET /admin/health` → `providers.database.engine == "postgres"` and the host shown is
Neon.

Neon keeps its own backups; additionally schedule an off-VM `pg_dump` (e.g. to OCI Object
Storage) before production cutover.

## Documents

Nothing to migrate — files stay in Google Drive. `GET /admin/health` should report
`providers.storage.provider == "google-drive"` and `durableStorage: true`. The
`bidmanager-data` volume is scratch space for in-flight downloads only.

If Drive auth fails, check that `drive-sa.json` is the key for the account that owns/was
shared the folder, and that `GOOGLE_DRIVE_FOLDER_ID` matches.

## Build the Client UI / admin console for OCI

Update the API URL and repackage:

- `Server UI/BidManagerControl.jsx` — set `PRODUCTION_API_BASE` to
  `https://<BIDMANAGER_DOMAIN>` and append the old Cloud Run URL to
  `LEGACY_PRODUCTION_API_BASES` so saved operator profiles auto-repoint on next launch.
- `Client UI/.env.production` — `VITE_API_BASE_URL=https://<BIDMANAGER_DOMAIN>`, then run
  the existing Client UI packaging command.

Existing installs that saved the Cloud Run URL must change **Settings → Backend URL** once,
unless a previously-used custom domain is CNAME'd to the VM.

## Operations

```bash
docker compose logs -f backend
docker compose restart backend
git pull && docker compose up -d --build   # apply code updates
```

- `sudo systemctl enable docker` so the stack returns after a reboot (services already use
  `restart: unless-stopped`).
- Do not delete Docker volumes during upgrades.
- The Always Free VM is not a backup — keep `.env` + `drive-sa.json` in a password manager
  and run scheduled off-VM database dumps.
