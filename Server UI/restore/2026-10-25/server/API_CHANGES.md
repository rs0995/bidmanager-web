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

## 3. To-do per app

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

### Bidwise (`Bidwise/src/`)
- [ ] `lib/api.ts`: `me()`, org routes, portal search routes.
- [ ] `live/LiveProviders.tsx`: load `me()` into the session after sign-in and on launch, and expose `permissions` through `useSession()`.
- [ ] `TabNavigator` / `RootNavigator` / `MoreScreen`: hide screens by `permissions` (same mapping as Client UI).
- [ ] A new **PortalSearch** screen (search and history), reached from Tenders or More, using `CaptchaScreen` for manual captchas.
- [ ] Sign-in/More: organisation sign-up, join by code, and an org admin screen (optional on mobile; can be phase 2).

### Server UI console (`Server UI/BidManagerControl.jsx`)
- [ ] `UsersPanel`: show org and role; **section toggles** (5, including Portal search) → `PUT /admin/users/{id}/permissions`.
- [ ] A new **Orgs** panel: list, detail (members, requests, sync view), create for a user, rename, regenerate code, add member, approve/reject, member permissions/role, de-link (retain/clear), dissolve.
- [ ] Follow the `Server UI/restore/<date>/` backup rule and the `CHANGELOG_PENDING.txt` note.

### Server Mobile App (`Server Mobile App/src/`)
- [ ] `lib/api.ts`: `setUserPermissions`, org routes.
- [ ] `UserDetailScreen`: org and role, plus section toggles (5).
- [ ] An Orgs screen (list, detail, approve/reject, member toggles, de-link, dissolve).
