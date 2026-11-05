## 5. Bid packs — Bid Agent (PENDING: not installed on the server yet)

> Paste this section into `Server UI/server/API_CHANGES.md` when `bid_agent_server/install.py` is applied.

### Concepts
- A **bid pack** is prepared per tender from the documents already downloaded for it. The agent:
  1. maps every file (or page range of a combined PDF) to a section type: ITB/ITT, Bid Data Sheet, qualification criteria, bidding forms, BOQ, GCC/PCC … whatever the employer calls them;
  2. extracts the qualification criteria (single entity / JV columns, money thresholds, look-back periods, required forms, key personnel, key equipment);
  3. converts every bidding form into an editable Word file and builds one Excel workbook (index, compliance, criteria, personnel, equipment, tabular forms);
  4. checks turnover, net worth, liquidity, bid capacity, similar works and ISO certificates against the **company profile**.
- **Owner**: an organisation's bid packs and company profile are shared by all its members (`org:<id>`); individuals own their own (`user:<id>`). Only org admins (or individuals) can edit the company profile.
- Learned per **employer** and shared by everyone: section names, corrections and form templates. The second tender from the same employer reuses them without AI calls.
- Word/Excel files are generated on download from the stored result, so they always reflect the latest company profile.
- AI (Claude) is optional. Without a key the agent uses keyword and table parsing; `GET /client/bid-agent/status` says which is active.

### Client routes (`x-client-key`; 403 `section_forbidden` without `projects`; 404 for tenders outside the account's sections)
| Method | Path | Notes |
|---|---|---|
| GET | `/client/bid-agent/status` | `{ai_enabled, model, owner: "organisation"\|"individual", can_edit_profile, roles: [{role,label}]}` |
| GET | `/client/bid-agent/analyses` | `{items: [{tender_id, status, updated_at}]}` for the owner |
| POST | `/client/tenders/{id}/bid-pack` | starts (or re-runs) preparation; returns the same shape as GET. Already running → returns current state |
| GET | `/client/tenders/{id}/bid-pack?since=n` | `{status: "none"\|"running"\|"completed"\|"failed", error, updated_at, logs: [...from n], next, result, files: [{name, kind: "workbook"\|"form"\|"zip", code?, title?}]}`. Poll every 1–2 s while `running`, passing `since=next` |
| PUT | `/client/tenders/{id}/bid-pack/documents` | `{file, segments: [{role, start_page, end_page}]}` — correct a file's sections; re-runs and teaches the employer profile |
| GET | `/client/tenders/{id}/bid-pack/files/{name}` | streams the `.docx` / `.xlsx` / `.zip` named in `files` |
| GET | `/client/company-profile` | `{profile: {general: {...}, financials: [...], experience: [...], works_in_hand, personnel, equipment, certificates, litigation}, schema, can_edit}` |
| PUT | `/client/company-profile` | partial update by section (`general`, `financials`, …); 403 `{reason: "org_admin_only"}` for org members |

`result` fields used by the apps: `tender {employer, reference, title}`, `key_sections [{role, label, found, locations}]`, `documents [{file, pages, error, needs_ocr, segments, segments_source}]`, `criteria {criteria [...], personnel, equipment, similar_work_definition, notes}`, `forms [{code, title, file, start_page, end_page, source}]`, `missing_forms`, `compliance [{ref, subject, required, actual, status: Meets|Shortfall|Check|Data missing|Manual check, forms, remarks}]`, `llm {used, model, usage}`.

### Operator routes (`x-admin-key`)
| Method | Path | Notes |
|---|---|---|
| GET / PUT | `/admin/bid-agent/config` | `{api_key?, model?}` → `{api_key_set, api_key_hint, api_key_source, model, default_model}`. The key is never returned |
| GET | `/admin/bid-agent/employers` | learned employers: `{org_key, org_name, aliases {role: [terms]}, form_codes, tender_count}` |
| DELETE | `/admin/bid-agent/employers/{org_key}` | forget an employer (aliases + its form templates) |
| GET | `/admin/bid-agent/forms?org_key=` | form template library |

### To-do per app
- **Client UI**: Bid Agent panel on a project/tender (prepare, progress, sections + correct, compliance, criteria, forms download), Company Profile page. *(done on branch `feat/bid-agent`)*
- **Bidwise**: Bid pack screen from a project/tender (prepare, progress, key sections, compliance, open/share files), read-only company profile summary. *(done on branch `feat/bid-agent`)*
- **Server UI console**: Bid Agent tab — API key/model, learned employers, form library. *(done on branch `feat/bid-agent`)*
