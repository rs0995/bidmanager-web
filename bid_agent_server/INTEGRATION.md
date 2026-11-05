# Bid Agent — server integration

This folder holds the Bid Agent for the BidManager server. It is kept outside `Server UI/` so that it can be
reviewed and applied by the session that owns `Server UI/server/`.

## Apply (server session, Windows PC)
```
python bid_agent_server/install.py --dry-run
python bid_agent_server/install.py
```
The installer copies `bid_agent/` into `Server UI/server/`, mounts the routers in `api_server.py` (just before the
final `_mount_frontend_if_available()`), adds the Python dependencies to `requirements.txt`, backs up the edited
files to `Server UI/restore/<date>/` and appends to `CHANGES.txt` / `CHANGELOG_PENDING.txt`. It is idempotent.
Then:
1. Paste `API_CHANGES_section.md` into `Server UI/server/API_CHANGES.md` as section 5.
2. Run the tests: `BID_AGENT_SERVER_DIR="Server UI/server" python -m unittest discover -s bid_agent_server/tests`
   (run from inside `Server UI/server` so its modules import).
3. Deploy through `deploy/oci/deploy-backend.sh` when the user asks.
4. In the console's Bid Agent tab, enter an Anthropic API key (or set `ANTHROPIC_API_KEY` on the container).

## What it adds
- A **chat agent** per tender (`bid_agent/chat.py`): it shows / saves the prequalification, extracts tender
  forms, checks eligibility and prepares the Ready Docs checklist, on instruction. Files go to the tender's
  project folder on Drive (`workspace.py`): Ready Docs attachments and a `Docs for Preparation/` subfolder,
  with `Bid Agent index.json` as the key; checklist rows go into the owner's sync data.
- Tables (created on start-up, SQLite and Postgres): `bid_org_profiles`, `bid_doc_cache`, `bid_form_library`,
  `bid_analyses`, `bid_company_profiles`, `bid_agent_chats`, `bid_agent_files` (the file → folder → row key).
- Dockerfile: LibreOffice (headless Writer + Calc) for old `.doc` files and PDF output.
- Settings: `bid_agent_api_key`, `bid_agent_model` (in `app_settings`; not part of `ADMIN_CONFIG_KEYS`, so the
  generic config endpoint never returns the key).
- Routes: see `API_CHANGES_section.md`.

## Runtime notes
- Preparation runs in a background thread of the API process. Status and logs are written to `bid_analyses`,
  so polling works from any worker. A run older than 45 min still marked `running` is treated as stale.
- Source files come from `downloaded_files` (local disk or Google Drive) and are copied into a temp folder
  that is deleted afterwards. Generated Word/Excel files are built per download in a temp folder.
- A typical 300-page tender is about 3–6 Claude calls on first analysis. Model default `claude-opus-5-5`; can be
  changed in the console.
- Scanned PDFs (no text layer) are flagged `needs_ocr`; the keyword parser cannot read them.

## Layout
| File | Purpose |
|---|---|
| `bid_agent/docreader.py` | PDF/DOCX/XLSX/TXT → page text and tables; ZIPs extracted |
| `bid_agent/roles.py` | section types + default aliases |
| `bid_agent/classify.py` | file / page-range → section type (running headers, not the TOC; Claude confirms) |
| `bid_agent/criteria.py` | qualification rows, personnel, equipment |
| `bid_agent/forms.py` | locate bidding forms, convert to fillable templates |
| `bid_agent/company.py` | company profile schema + canonical field keys |
| `bid_agent/compliance.py` | automated checks against the profile |
| `bid_agent/generate.py` | Word per form + Excel workbook |
| `bid_agent/agent.py` | pipeline + on-demand outputs |
| `bid_agent/chat.py` | the chat agent: tools, Claude tool loop, keyword router |
| `bid_agent/workspace.py` | project / checklist rows in the sync data, files on Drive, manifest + index |
| `bid_agent/store.py` | persistence (owner-scoped and shared tables) |
| `bid_agent/server_routes.py` | FastAPI routers |
| `tests/` | pipeline tests (standalone) + route tests (need `BID_AGENT_SERVER_DIR`) |
