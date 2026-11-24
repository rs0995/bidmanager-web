# Server UI

`BidManagerControl.jsx` is the operator console; `server/` is the FastAPI backend deployed to OCI.

## Rules
- Before editing any file here, copy it to `restore/<YYYY-MM-DD>/` (same relative path) and log the change in that folder's `CHANGES.txt`. After an approved change, add a 1-2 line note to `CHANGELOG_PENDING.txt`.
- **`CHANGES.txt` and `CHANGELOG_PENDING.txt` are append-only.** Several sessions log into the same day's folder, so never create or rewrite them: no `cat >`, no whole-file write, no rebuilding the file. Append (`cat >>` / `printf >>`), or edit by adding a new section at the end. Start each entry with a `----` line and the time. If the file is missing, appending creates it. Copy a backup into `restore/<date>/` with `cp -n` only, so the day's original is never replaced.
- Only one session edits `server/` at a time. Deploys only go through `deploy/oci/deploy-backend.sh` from the Windows PC (a full rebuild, never `--no-build`), and only when the user asks.

## Server API changes
`server/API_CHANGES.md` is the handoff for app sessions: accounts and organisations, section permissions, portal tender search, checklist file sharing, and each app's to-do (the console's is in section 4, "Server UI console"). Whoever changes `server/` keeps it current.
