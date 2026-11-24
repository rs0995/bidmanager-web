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
