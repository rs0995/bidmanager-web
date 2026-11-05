# Server API changes — handoff for app sessions

This document lists server features that the apps (Client UI, Bidwise, the Server UI console and the Server Mobile App) still need to adopt. The server session owns this file and keeps it current.

**Rules for app sessions**
- Never edit `Server UI/server/` from an app session. If you need an API change, ask in the server session.
- Code only. Builds, version bumps, TestFlight and installers happen only when the user asks.
- The base URL is `https://161.118.170.233.sslip.io`.
  - Client routes send `x-client-key: <token>`.
  - Operator routes send `x-admin-key: <key>`.

Status key: **LIVE** = deployed; **READY** = coded and tested on the server, deployed when the user asks.

---

## 1. Accounts, organisations and section permissions (LIVE since 2026-10-23)

### Concepts
- Every account is an **individual** unless it belongs to an **organisation**. All existing accounts are individuals and work exactly as before.
- **An organisation** shares one set of projects, checklists, templates and bookmarks across its members.
  - `/client/sync` is unchanged for apps. For members, the server stores the shared keys (`projects`, `checklist`, `templates`, `templateItems`, `bookmarkTenderIds`, `bookmarks`, `bookmarkedOrgs`, `bookmarkedOrgIds`) in the org's pool. Personal keys (`tenderColumnPrefs`, `notificationPrefs`, …) stay per user.
- The account that creates an org is its **admin**. An org always keeps at least one admin.
- **Sections** are per-user on/off switches. Org admins always have every section. Captcha is never gated.

| Section | Covers | Default |
|---|---|---|
| `active` | active tenders + organisations list | on |
| `archived` | archived tenders | on |
| `bookmarks` | bookmarked tenders + bookmarked organisations | on |
| `projects` | projects, checklists, templates, archived projects, project files | on |
| `portal_search` | search a tender ID on a NIC portal (§2) | **off** |

- **A section that is off:** the server stops sending its data.
  - Tender lists, search, stats and organisations leave out tenders outside the user's sections.
  - Tender detail, documents and download routes return 404 for those tenders.
  - `/client/sync` leaves that section's keys out of GET and ignores them on PUT. Nothing stored is deleted, so switching the section back on brings the data back.
  - **Apps should hide the tab.**
- **What still shows with a section off:** Dashboard, Captcha, Settings, Alerts and Files stay visible.
  - Dashboard numbers cover only what the user can see.
  - Bookmark alerts need the `bookmarks` section.
- **Joining an org** (when the request is approved) discards the user's own projects, bookmarks and checklists, and **signs out all their devices**. Their next login loads the org's data.
- **De-link with `retain: true`** keeps only the org's bookmarked tenders and organisations. **`retain: false`** wipes the account. Either way the user's devices are signed out, and the user becomes an individual with the default sections.
- Devices that are signed out get 401 and must sign in again. Client UI already does this.

- **Project tenders are always bookmarked** (LIVE since 2026-10-26). The server adds every project's `source_tender_id` to `bookmarkTenderIds` (on push and on pull), and ignores a removal of that bookmark while the project exists. Deleting the project frees the bookmark. As bookmarks, these tenders get the 24-hour update jobs and bookmark alerts. **Apps:**
  - when creating a project, bookmark its tender locally too;
  - when un-bookmarking a tender that is in any project (match the canonical `source_tender_id`), block it and show: "Tenders in projects can't be removed from bookmarks. Remove the project first."

### Client routes (`x-client-key`)

| Method & path | Body → response |
|---|---|
| `POST /client/auth/register` | Optional new fields `account_type: "individual" \| "organisation"` and `org_name` (required for an organisation). The response gains `account`. |
| `POST /client/auth/login` | The response gains `account`. |
| `GET /client/me` | → `{user_id, email, display_name, account_type, org: {id, name, role} \| null, permissions: {active, archived, bookmarks, projects, portal_search}, pending_request}`. **Use this to show or hide tabs**, and refresh it on app start and after login. |
| `POST /client/org` | `{name}`: an individual creates an org and becomes admin; their data becomes the org's. → org detail |
| `POST /client/org/join-requests` | `{join_code, note?}` → `{request, warning}`. **Show the warning** (personal data will be discarded on approval). |
| `GET /client/org/join-requests/mine` | → `{request \| null}` |
| `DELETE /client/org/join-requests/mine` | Cancel the user's pending request |

**Org admin only** (403 otherwise):

| Method & path | Body → response |
|---|---|
| `GET /client/org` | → `{id, name, join_code, members: [{user_id, email, display_name, role, permissions, joined_at, last_seen_at, status}], pending_requests: [...]}` |
| `PUT /client/org` | `{name}` (rename) |
| `POST /client/org/join-code/regenerate` | → `{join_code}` |
| `GET /client/org/join-requests` | → `{items: [{id, user_id, email, display_name, note, created_at, …}]}` |
| `POST /client/org/join-requests/{id}/approve` | `{permissions?: {section: bool}}`; sections left out take their defaults |
| `POST /client/org/join-requests/{id}/reject` | Reject a request |
| `PUT /client/org/members/{user_id}/permissions` | `{active?, archived?, bookmarks?, projects?, portal_search?}`; omitted sections are unchanged |
| `PUT /client/org/members/{user_id}/role` | `{role: "admin" \| "member"}`; demoting the last admin returns 409 |
| `POST /client/org/members/{user_id}/delink` | `{retain: bool}`; removing the last admin returns 409 |

### Operator routes (`x-admin-key`)

| Method & path | Body → response |
|---|---|
| `GET /admin/users`, `GET /admin/users/{id}` | Each user also has `account_type`, `org: {id, name, role} \| null` and `permissions`. A member's `sync` view shows the org's data. |
| `PUT /admin/users/{id}/permissions` | `{active?, archived?, bookmarks?, projects?, portal_search?}`, for **any** user, individuals included |
| `GET /admin/orgs` | → `{items: [{id, name, join_code, created_at, member_count, pending_requests}]}` |
| `POST /admin/orgs` | `{name, admin_user_id}`: make an existing user the admin of a new org |
| `GET /admin/orgs/{id}` | Org detail plus a `sync` view of the org's shared data |
| `PUT /admin/orgs/{id}` | `{name}` |
| `DELETE /admin/orgs/{id}?retain=true\|false` | Dissolve the org: every member becomes an individual |
| `POST /admin/orgs/{id}/join-code/regenerate` | Issue a new join code |
| `POST /admin/orgs/{id}/members` | `{user_id, role?, permissions?}`: link a user directly (same effect as an approval) |
| `POST /admin/orgs/{id}/join-requests/{rid}/approve` | `{permissions?}` |
| `POST /admin/orgs/{id}/join-requests/{rid}/reject` | Reject a request |
| `PUT /admin/orgs/{id}/members/{uid}/permissions` | Same body as the client route |
| `PUT /admin/orgs/{id}/members/{uid}/role` | Same body as the client route |
| `POST /admin/orgs/{id}/members/{uid}/delink` | `{retain}` |

---

## 2. Portal tender search (LIVE since 2026-10-24)

### Concepts
- A user picks a **NIC portal** and enters a **tender ID**. The server searches that portal's **Tender Status** page, running a browser and solving the captcha.
- The update is **global**: it changes the shared tender table that every user sees.
  - **Already in the DB** (current or archive): the status/stage is updated, empty title or org fields are filled in, and the tender stays where it is.
  - **Not in the DB:** it is added to the **archive** when its stage is past bidding (Technical/Financial Bid Opening or Evaluation, AOC, Concluded, Cancelled, Retender). Otherwise it goes to the **current** list.
  - **Result stages** (Financial Bid Opening/Evaluation, AOC, Concluded): result documents are also downloaded into the tender's "Results" folder.
- **History is per user**: each user sees their own past searches in the search tab.
- **Access** is the `portal_search` section. It is **off by default** and switched on by the operator (`PUT /admin/users/{id}/permissions`) or an org admin (`PUT /client/org/members/{id}/permissions`). Org admins always have it. Apps show the search tab only when `GET /client/me` → `permissions.portal_search` is true.
- **Captcha:** handled exactly like a tender document download. AI solving is tried first; if it fails, a **manual captcha** (up to 5 tries) goes to **the searching user**: a "CAPTCHA needed" push, then `GET /client/captcha/pending` (context `"Portal search <tender id>"`), answered with `POST /client/captcha/{id}/answer`. Reuse the download flow's captcha UI. While a search is `pending`, poll `/client/captcha/pending` alongside the search and open the Captcha screen when one appears.

### Client routes (`x-client-key`; 403 `{detail: {reason: "section_forbidden", section: "portal_search"}}` without access)

| Method & path | Body → response |
|---|---|
| `GET /client/portal-search/portals` | → `{allowed, items: [{id, name, url}]}`: NIC portals that can be searched. `items` is empty when not allowed. |
| `POST /client/portal-search` | `{website_id, tender_id}` → `{search, job_id, created}`. 400 if the portal can't be searched; 423/429 when the server is busy or read-only. |
| `GET /client/portal-search/{search_id}` | → `{search}`. **Poll this every 2–3 s** until `status` is no longer `"pending"`. |
| `GET /client/portal-search/history?limit=50` | → `{items: [search, …]}`, newest first (max 200). This is the search tab's history list. |
| `DELETE /client/portal-search/history/{search_id}` | Remove one entry |
| `DELETE /client/portal-search/history` | Clear the user's history |

**The `search` object**

```
{ id, website_id, website_name, tender_id, job_id,
  status: "pending" | "found" | "not_found" | "failed",
  job_status: "queued" | "running" | "completed" | "failed" | "cancelled",
  stage,            // portal "Tender Stage", e.g. "AOC" (when found)
  tender_db_id,     // row id, for /client/tenders/{id}
  created,          // true = added by this search, false = existing tender updated
  is_archived,      // true = in the archive list
  error,            // when failed (e.g. captcha failed)
  created_at, finished_at,
  tender }          // full tender object (same as /client/tenders/{id}), or null when the
                    // tender is outside the user's sections
```

**Suggested UI**
- A "Search on portal" tab or screen with a portal picker, a tender ID input and a Search button.
- Under it, the history list showing each tender ID, its portal, a status chip and the stage, with "Added to current", "Added to archive" or "Updated".
- Tapping a found entry opens the tender.
- While a search is pending, poll it and surface the Captcha screen.
- After a search is found, refresh the app's tender caches so the new or updated tender shows up in its list.

### Operator
There are no operator search routes: searches come from users. The operator only grants access: `PUT /admin/users/{id}/permissions {portal_search: true}`, and the user list shows `permissions.portal_search`.

---

## 3. Project checklist files (LIVE since 2026-10-26)

### Concepts
- A file attached to a checklist row is **uploaded to the server**, and every platform of the same account (or every member of the same org) can open it. Today only the row text syncs: the desktop's `linked_file_path` and the phones' `attachment.uri` are device-local.
- The row's file is described by **`server_file`** on the checklist row in `/client/sync`:
  `{id, name, size, type, sha256, uploaded_at, uploaded_by, device}`.
  - **The server owns this field.** A sync push can't set, change or clear it; the server ignores whatever a device sends. Only the upload and delete routes change it.
  - Keep sending rows as usual; you don't need to strip it.
- **One file per row, and the first upload wins.** If another platform already uploaded a file for the row, an upload gets **409** with that file. The losing platform must **download the server's file and replace its own local copy**, so every platform ends up with the same file.
- **To replace a file on purpose:** delete it, then upload the new one.
- **Removing a checklist row** (a sync `removed` delta) also removes its file.
- **Joining an org** discards the user's own files along with their own projects. **Creating an org** keeps them as the org's files.
- **Access:** the `projects` section. Org members share the org's files.
- **Size cap:** the server setting `max_file_size_mb` (default 80 MB) → 413.
- **Where files are stored** (server-side only; the apps never see the path): `project-files/P - <tender id>/<Owner (org N | user N)>/<Project title (project id)>/<name>`.
  - Projects with no tender go under `project-files/P - No tender/…`, beside the tender folders.
  - All projects for one tender, from any user, sit under that tender's `P - <tender id>` folder. Each user, or each org (one folder for all its members), has its own folder inside it.
  - A second file with the same name in a project is stored as `name (2).ext`, but the apps still show and download it under the user's original `name`.
  - Archiving a tender or a project doesn't move files.

### Client routes (`x-client-key`; 403 `section_forbidden` without `projects`)

| Method & path | Body → response |
|---|---|
| `POST /client/project-files` | **multipart**: `checklist_item_id` (the row id), `project_id` (optional), `device` (`"desktop"` / `"phone"`), `file`. → `{file}`. Errors: **404 `{detail:{reason:"row_not_found"}}`** = the row isn't on the server yet (push `/client/sync`, then retry); **409 `{detail:{reason:"file_exists", file}}`** = the first-wins file, so download it and use it; **409 `upload_in_progress`** = retry in a few seconds; 413 = too large; 400 = empty file. |
| `GET /client/project-files?project_id=` | → `{items: [file, …]}` |
| `POST /client/project-files/{id}/download-request` | → `{file, url, expires_at}` (a signed URL valid for about 15 min; it needs no auth header, same as tender documents) |
| `GET <url>` | The file bytes (attachment) |
| `DELETE /client/project-files/{id}` | Removes the file and clears `server_file` |

`file` = `{id, project_id, checklist_item_id, name, size, type, sha256, uploaded_at, uploaded_by, device}`.

### Flow every app should follow
1. **On attach:** save locally as today, push the sync data so the row exists on the server, then upload. **On 409 `file_exists`:** download the returned file, replace the local copy, and show "Another device attached a file to this row first — using that one."
2. **After a pull:** for each row with `server_file` whose file isn't on this device, or whose local file differs (compare `sha256` or the name), show the file name with a **Download** or open action. Download through the signed URL into:
   - the desktop: the project folder or subfolder, and set `linked_file_path`;
   - a phone: `attachments/<itemId>/`, and set the `attachment` uri.
3. **Remove file** → `DELETE`, then clear the local copy.
4. **Existing attachments (one-off backfill):** after updating, upload every locally attached file whose row has no `server_file`. If two platforms attached different files before this change, the first to upload wins and the other gets 409 and follows step 1.

---

## 4. To-do per app

### Client UI (`Client UI/src/`)
- [ ] `lib/api.js`: `getAccount()` → `GET /client/me` (cache it in settings or the store and refresh it after login); org routes; portal search routes (§2).
- [ ] Sign-in screen (`SignInScreen` in `App.jsx`): register as individual or organisation (with org name); a "join an organisation" flow (join code, warning, pending state, cancel).
- [ ] Sidebar (`Sidebar` `mainItems` / `bottomItems`, the `allowed` page list ~L4702, `pages` map, dashboard targets): hide tabs by `permissions`.
  - `active` → Online Tenders' active tab + Organizations
  - `archived` → archived tab
  - `bookmarks` → Bookmarks
  - `projects` → Projects, Templates, Archived Projects
  - `portal_search` → new "Portal Search" page
- [ ] An org admin page (Settings or a new page): members (role and section toggles), join code (copy, regenerate), pending requests (approve with sections, reject), de-link (retain or clear).
- [ ] A "Portal Search" page with search and history (§2), using the existing job/captcha patterns (`fetchTenderStatus` / poller / captcha in `lib/api.js`).
- [ ] Checklist files (§3): `attachFile` (`App.jsx` ~L3542) uploads after the local copy. `pullUserData` (`api.js` ~L1567) keeps `linked_file_path`, but rows with a `server_file` that isn't on disk get a Download action. The checklist table and preview show `server_file.name`. Delete File calls `DELETE`. Add the one-off backfill of existing `linked_file_path` files. Uploads need a multipart `fetch` (`FormData`) from the Electron renderer.
- [ ] Project tenders stay bookmarked (§1): bookmark the tender locally when a project is created; block un-bookmarking a project's tender with the warning "Tenders in projects can't be removed from bookmarks. Remove the project first."
- [x] Bid Agent (§5): chat above the Ready Docs checklist in the project workspace (agent files saved into the project's Working Docs folder), Company Profile page (done on branch `feat/bid-agent`).

### Bidwise (`Bidwise/src/`)
- [ ] `lib/api.ts`: `me()`, org routes, portal search routes.
- [ ] `live/LiveProviders.tsx`: load `me()` into the session after sign-in and on launch, and expose `permissions` through `useSession()`.
- [ ] `TabNavigator` / `RootNavigator` / `MoreScreen`: hide screens by `permissions` (same mapping as Client UI).
- [ ] A new **PortalSearch** screen (search and history), reached from Tenders or More, using `CaptchaScreen` for manual captchas.
- [ ] Sign-in/More: organisation sign-up, join by code, and an org admin screen (optional on mobile; can be phase 2).
- [ ] Checklist files (§3):
  - `attachToItem` (`lib/sharedProjects.ts` ~L224) uploads after the local copy, as a multipart POST through `react-native-blob-util`.
  - `attachmentPath` and `ReadyChecklist` use `server_file`. "On another device" becomes a Download action, using the existing signed-URL `files.download`.
  - `removeAttachment` calls `DELETE`.
  - Add the one-off backfill of existing `attachment` files.
- [ ] Project tenders stay bookmarked (§1): bookmark the tender locally when a project is created; block un-bookmarking a project's tender with the warning "Tenders in projects can't be removed from bookmarks. Remove the project first."
- [x] Bid Agent (§5): chat card above Ready for Bid on tender/project detail; Docs for Preparation uploaded to / listed from Drive (done on branch `feat/bid-agent`).

### BM Pro (`Mobile App RN/src/`)
- [ ] Checklist files (§3): the same as Bidwise, in `lib/projects.js` (`attachFile`, `getAttachedFile`, `mergeFromServer`) and `ChecklistItem.tsx`.
- [ ] Project tenders stay bookmarked (§1): bookmark the tender locally when a project is created; block un-bookmarking a project's tender with the warning "Tenders in projects can't be removed from bookmarks. Remove the project first."
- [ ] Bid Agent (§5): optional; Bidwise's `components/project/AgentChat.tsx` + `data/bidAgent.tsx` + `lib/bidAgent.ts` can be copied over.

### Server UI console (`Server UI/BidManagerControl.jsx`)
- [ ] `UsersPanel`: show org and role; **section toggles** (5, including Portal search) → `PUT /admin/users/{id}/permissions`.
- [ ] A new **Orgs** panel: list, detail (members, requests, sync view), create for a user, rename, regenerate code, add member, approve/reject, member permissions/role, de-link (retain/clear), dissolve.
- [ ] Follow the `Server UI/restore/<date>/` backup rule and the `CHANGELOG_PENDING.txt` note.
- [x] Bid Agent tab (§5): API key / model, learned employers, form library (done on branch `feat/bid-agent`).

### Server Mobile App (`Server Mobile App/src/`)
- [ ] `lib/api.ts`: `setUserPermissions`, org routes.
- [ ] `UserDetailScreen`: org and role, plus section toggles (5).
- [ ] An Orgs screen (list, detail, approve/reject, member toggles, de-link, dissolve).
- [ ] Bid Agent (§5): optional read-only view of `/admin/bid-agent/config` and employers.

---

## 5. Bid Agent (READY since 2026-11-05)

### Concepts
- **A chat per tender**, shared by everyone who owns the tender's project (the organisation, or an individual). Each message runs one agent turn on the server; the agent **does what it is asked**:
  - "show / fetch the prequal(ification)" → the criteria table (single entity / JV, thresholds, forms), key personnel and equipment, shown in the chat;
  - "save the prequal (as Excel / Word / PDF)" → saved to **Docs for Preparation**;
  - "extract the tender forms" or a specific form ("FIN-3.2", "letter of bid") → editable files pre-filled from the company profile, saved to **Docs for Preparation** and attached to the matching Ready Docs row if there is one;
  - "prepare the checklist (of documents required)" → **Ready Docs** rows for every form and evidence document the tender asks for (Pending), with the forms the agent prepares **attached automatically**;
  - "can we qualify?" → criteria checked against the company profile.
  - "the criteria are on pages 12–14 (of <file>)" → re-reads the criteria from those pages and keeps them for later saves; "which files are in the tender" lists files, pages and sections. Criteria are found under any heading ("Eligibility Criteria", "Qualifying requirements", tables or numbered paragraphs; scanned pages are read as images when AI is on).
- With an Anthropic key (console → Bid Agent tab) Claude reads the documents and chooses the tools; without one a keyword router handles the same requests (basic mode; `ai_enabled: false`).
- The tender's documents are read from `downloaded_files` (local or Drive). **ZIPs are unpacked** (also ZIPs inside ZIPs); old `.xls` / `.rtf` and, with LibreOffice in the image, `.doc` / `.odt` / `.ods` are converted; unreadable files are listed with the reason.
- **Where files go** (Drive, same storage as checklist files §3):
  `project-files/P - <tender id>/<owner>/<project>/` — files attached to Ready Docs rows
  `project-files/P - <tender id>/<owner>/<project>/Docs for Preparation/` — prequal, extracted forms, users' prep docs
  `project-files/P - <tender id>/<owner>/<project>/Bid Agent index.json` — the key: every file → kind, folder, checklist row
  The same map is in the table `bid_agent_files`. All files are `client_project_files` rows, so they download through `POST /client/project-files/{id}/download-request`.
- **Checklist rows and projects** the agent creates are written into the owner's `/client/sync` data (rows: `subfolder: "Ready Docs"`, `status: "Pending"`; files as `server_file`). Apps see them on their next pull. If the tender has no project yet, the agent creates it. Server-made ids start at 9,000,000.
- **Company profile** (per owner) is used to pre-fill forms and to check criteria. Only org admins (or individuals) can edit it.

### Client routes (`x-client-key`; 403 `section_forbidden` without `projects`; 404 for tenders outside the account's sections)
| Method | Path | Notes |
|---|---|---|
| GET | `/client/tenders/{id}/bid-agent/chat?since=n` | `{messages: [... id > n], next, status: "idle"\|"working", progress, ai_enabled, suggestions}`. Poll every ~1.5 s while `working`. |
| POST | `/client/tenders/{id}/bid-agent/chat?since=n` | `{message}` → same shape, `status: "working"`. **409 `{reason:"busy"}`** while the last request runs. |
| DELETE | `/client/tenders/{id}/bid-agent/chat` | Clears the conversation. |
| GET | `/client/tenders/{id}/bid-agent/files?folder=prep\|ready` | `{items: [{file_id, name, kind: "prequalification"\|"form"\|"user", folder, checklist_item_id, size, created_at}]}` |
| POST | `/client/tenders/{id}/bid-agent/prep-files` | **multipart** `file` → `{file}`: a user's own Docs for Preparation file, stored beside the agent's. 413 too large, 400 empty. |
| DELETE | `/client/tenders/{id}/bid-agent/prep-files/{file_id}` | Removes a Docs for Preparation file. |
| GET / PUT | `/client/company-profile` | `{profile: {general, financials, experience, works_in_hand, personnel, equipment, certificates, litigation}, schema, can_edit}`; PUT by section; 403 `{reason:"org_admin_only"}` for members. |
| GET | `/client/bid-agent/status` | `{ai_enabled, model, owner, can_edit_profile, roles}` |

`message` = `{id, role: "user"|"assistant", text, at, cards?, error?}`; `cards`:
- `{type: "table", title, columns, rows}` — e.g. the prequalification, eligibility check;
- `{type: "files", title, folder, files: [{file_id, name, kind}], attached: [{row, file}]}` — files just saved;
- `{type: "checklist", title, folder: "Ready Docs", rows: [{id, name, added, file}]}` — rows added / already there, with the attached file name.
After an answer with a `files` or `checklist` card, **pull `/client/sync`** so Ready Docs shows the new rows and files.

Older one-shot routes (still served): `POST/GET /client/tenders/{id}/bid-pack`, `PUT .../bid-pack/documents` (correct a file's sections), `GET .../bid-pack/files/{name}`, `GET /client/bid-agent/analyses`.

### Operator routes (`x-admin-key`)
| Method | Path | Notes |
|---|---|---|
| GET / PUT | `/admin/bid-agent/config` | `{api_key?, model?}` → `{api_key_set, api_key_hint, api_key_source, model, default_model}`. The key is never returned |
| GET | `/admin/bid-agent/employers` | learned employers: `{org_key, org_name, aliases {role: [terms]}, form_codes, tender_count}` |
| DELETE | `/admin/bid-agent/employers/{org_key}` | forget an employer (aliases + its form templates) |
| GET | `/admin/bid-agent/forms?org_key=` | form template library |
