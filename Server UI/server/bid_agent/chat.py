"""The Bid Agent as a chat: it does what the user asks, one request at a time.

Each user message runs one agent turn. With a Claude key, Claude chooses and
calls the tools below (several per turn if needed) and answers in plain text;
without a key a keyword router maps common requests to the same tools. Tools
return text for the model plus "cards" the apps render (tables, saved files,
checklist rows), so what the user sees is the real result, not a description.

Saved files go to the tender's project folder (see workspace.py):
  "Docs for Preparation"  prequalification, extracted forms (working copies)
  "Ready Docs" checklist  rows the agent prepares, with its files attached
"""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import time
from typing import Any, Callable

from . import compliance, generate
from .criteria import form_codes_in, normalize_form_code
from .workspace import PREP_FOLDER, READY_SUBFOLDER, Workspace, norm_name

FORMATS_DOC = ("docx", "pdf", "xlsx")

SYSTEM = """You are the Bid Agent in BidManager. You help a contractor prepare a bid for ONE public tender \
(Indian government / PSU / metro rail / multilateral-funded works). Work like a sharp assistant on claude.ai: \
read the tender pages you are given and answer directly.

Answer style (always, unless the user's standing instructions say otherwise):
- Lead with the answer. At most 4 short lines, or one compact table. No preamble, no "Sure", no summary of \
what you are about to do, no repeating what a card already shows. Amounts like "INR 190 Cr".
- Quote the tender's own numbers and clause refs; never invent criteria, values, form codes or pages. If the \
pages you have don't say, say so in one line and offer to read more pages.
- End with at most one short next step when useful (e.g. "Save it as Excel?").

Use tools only for actions or for pages you don't have:
- show_prequalification shows the full criteria table to the user (use it when they ask to see/fetch the \
prequal or criteria; then reply in one line).
- save_prequalification (Excel default; Word / PDF if asked) and extract_tender_forms save files to Docs for \
Preparation; prepare_checklist fills the Ready Docs checklist (start from the user's checklist template rows \
when given, add every form and evidence document THIS tender asks for, form code first, e.g. "FIN-3.2 (a) - \
Average Annual Construction Turnover"); check_eligibility compares with the company profile.
- If the user says the criteria are on particular pages, or your criteria look incomplete (e.g. only JV \
rules), call extract_criteria_from_pages. read_tender_pages for any other pages.
- When the user corrects you or states a preference that should apply next time, call remember (once).
- Saving creates the tender's project if there isn't one yet; mention that briefly.
- If no tender documents are downloaded, say so and stop.
"""

TOOLS = [
    {"name": "show_tender_sections", "description": "Which file and pages hold each section of the tender "
     "(ITB, data sheet, qualification criteria, bidding forms, BOQ, conditions ...).",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "show_prequalification", "description": "Shows the prequalification / qualification and evaluation "
     "criteria table to the user (single entity / JV columns, thresholds, required forms), plus key personnel and "
     "equipment. Returns the criteria to you as text.",
     "input_schema": {"type": "object", "properties": {
         "include_our_position": {"type": "boolean", "description": "Also show our result per criterion from the company profile."}},
         "required": ["include_our_position"], "additionalProperties": False}},
    {"name": "save_prequalification", "description": "Saves the prequalification criteria as a file in the "
     "project's Docs for Preparation (Google Drive, shared with the team).",
     "input_schema": {"type": "object", "properties": {
         "format": {"type": "string", "enum": ["xlsx", "docx", "pdf"]}},
         "required": ["format"], "additionalProperties": False}},
    {"name": "list_tender_forms", "description": "Lists the bidding forms found in the tender documents, and forms "
     "the criteria ask for that weren't found.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "extract_tender_forms", "description": "Extracts bidding forms as editable files (pre-filled from the "
     "company profile) into Docs for Preparation, and attaches each to its checklist row if one exists. "
     "codes = form codes from list_tender_forms; empty list = all forms.",
     "input_schema": {"type": "object", "properties": {
         "codes": {"type": "array", "items": {"type": "string"}},
         "format": {"type": "string", "enum": ["docx", "pdf", "xlsx"]}},
         "required": ["codes", "format"], "additionalProperties": False}},
    {"name": "check_eligibility", "description": "Checks the qualification criteria against the company profile "
     "(turnover, net worth, liquidity, bid capacity, similar works, certificates) and shows the result.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "prepare_checklist", "description": "Adds the documents required for the bid to the project's Ready "
     "Docs checklist (Pending, files to be attached) and attaches the forms the agent prepares to their rows.",
     "input_schema": {"type": "object", "properties": {
         "items": {"type": "array", "items": {"type": "object", "properties": {
             "name": {"type": "string"}, "description": {"type": "string"}},
             "required": ["name", "description"], "additionalProperties": False}}},
         "required": ["items"], "additionalProperties": False}},
    {"name": "list_tender_documents", "description": "The tender's files with page counts and the sections "
     "found in each, and the pages the criteria were read from.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "read_tender_pages", "description": "Returns the text of pages of a tender file (max 30 pages). "
     "file = part of the file name, or '' to pick the file whose pages look most like criteria.",
     "input_schema": {"type": "object", "properties": {
         "file": {"type": "string"}, "start_page": {"type": "integer"}, "end_page": {"type": "integer"}},
         "required": ["file", "start_page", "end_page"], "additionalProperties": False}},
    {"name": "extract_criteria_from_pages", "description": "Re-reads the qualification criteria from the given "
     "pages (as the user points them out), replaces the stored criteria and shows the table.",
     "input_schema": {"type": "object", "properties": {
         "file": {"type": "string"}, "start_page": {"type": "integer"}, "end_page": {"type": "integer"}},
         "required": ["file", "start_page", "end_page"], "additionalProperties": False}},
    {"name": "remember", "description": "Saves a correction or preference so the agent follows it next time "
     "(e.g. 'MMRDA puts eligibility criteria in the NIT, pages 12-14', 'always add GST certificate to the "
     "checklist'). applies_to: 'employer' = this tender's employer only, 'all' = every tender.",
     "input_schema": {"type": "object", "properties": {
         "text": {"type": "string"}, "applies_to": {"type": "string", "enum": ["employer", "all"]}},
         "required": ["text", "applies_to"], "additionalProperties": False}},
    {"name": "list_reference_documents", "description": "The organisation's reference documents (certificates, "
     "registrations, standard formats, previous bids) that can be attached to checklist rows.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "attach_reference_document", "description": "Attaches a reference document to a Ready Docs "
     "checklist row (adds the row if missing). document = its name (or part); row = the checklist row name.",
     "input_schema": {"type": "object", "properties": {
         "document": {"type": "string"}, "row": {"type": "string"}},
         "required": ["document", "row"], "additionalProperties": False}},
    {"name": "list_saved_files", "description": "Lists files the agent and the team saved for this tender "
     "(Docs for Preparation and Ready Docs attachments).",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
]
for _t in TOOLS:
    _t["strict"] = True

HELP = ("I can show the prequalification, save it (Excel, Word or PDF), extract all or specific tender forms, "
        "check whether you qualify, and prepare the Ready Docs checklist with the forms attached. "
        "What should I do?")


class Turn:
    """Runs one user request. ``get_result`` returns the tender analysis (running it if needed)."""

    def __init__(self, workspace: Workspace, get_result: Callable[[], dict], get_profile: Callable[[], dict],
                 progress: Callable[[str], None] = lambda _m: None, pages=None,
                 save_result: Callable[[dict], None] = lambda _r: None,
                 remember: Callable[[str, str], None] | None = None):
        """``pages`` gives access to the tender files: .read(file, start, end) -> (name, text, scanned)
        and .criteria(file, start, end) -> (name, criteria)."""
        self.ws = workspace
        self._get_result = get_result
        self.get_profile = get_profile
        self.progress = progress
        self.pages = pages
        self.save_result = save_result
        self._remember = remember
        self.cards: list[dict] = []
        self._result: dict | None = None

    @property
    def result(self) -> dict:
        if self._result is None:
            self._result = self._get_result()
        return self._result

    # ------------------------------------------------------------- tools
    def call(self, name: str, args: dict) -> str:
        fn = getattr(self, f"tool_{name}", None)
        if not fn:
            return f"Unknown tool {name}."
        try:
            return fn(**(args or {}))
        except Exception as e:  # tell the model, let it explain
            return f"Error: {e}"

    def tool_show_tender_sections(self) -> str:
        secs = self.result.get("key_sections", [])
        docs = self.result.get("documents", [])
        self.cards.append({"type": "table", "title": "Tender sections", "columns": ["Section", "Where"],
                           "rows": [[s["label"], "; ".join(f"{l['file']} p{l['start_page']}-{l['end_page']}" for l in
                                                           s["locations"]) or "Not found"] for s in secs]})
        skipped = [d for d in docs if d.get("error")]
        lines = [f"{s['label']}: " + ("; ".join(f"{l['file']} p{l['start_page']}-{l['end_page']}" for l in s["locations"])
                                       or "not found") for s in secs]
        if skipped:
            lines.append("Unreadable files: " + "; ".join(f"{d['file']} ({d['error']})" for d in skipped))
        return "\n".join(lines)

    def tool_show_prequalification(self, include_our_position: bool = False) -> str:
        crit = self.result.get("criteria", {})
        rows = crit.get("criteria", [])
        if not rows:
            return "No qualification criteria were found in the downloaded documents."
        checks = {c["ref"]: c for c in compliance.check(crit, self.get_profile())} if include_our_position else {}
        cols = ["Ref", "Criterion", "Requirement", "Single entity", "JV", "Forms"]
        if include_our_position:
            cols.append("Ours")
        table = []
        for r in rows:
            jv = " / ".join(x for x in (r.get("jv_all_parties"), r.get("jv_each_member"), r.get("jv_one_member")) if x)
            row = [r.get("ref", ""), r.get("subject", ""), r.get("requirement", ""), r.get("single_entity", ""), jv,
                   ", ".join(r.get("forms", []))]
            if include_our_position:
                c = checks.get(r.get("ref"), {})
                row.append(f"{c.get('status', '')}{(': ' + c['actual']) if c.get('actual') else ''}")
            table.append(row)
        self.cards.append({"type": "table", "title": "Prequalification criteria", "columns": cols, "rows": table})
        if crit.get("personnel"):
            self.cards.append({"type": "table", "title": "Key personnel",
                               "columns": ["Position", "No.", "Qualification", "Experience"],
                               "rows": [[p.get("position"), p.get("count"), p.get("qualification"), p.get("experience")]
                                        for p in crit["personnel"]]})
        if crit.get("equipment"):
            self.cards.append({"type": "table", "title": "Key equipment", "columns": ["Equipment", "Min. units", "Max age"],
                               "rows": [[e.get("type"), e.get("min_units"), e.get("max_age_years")] for e in crit["equipment"]]})
        brief = [f"{r.get('ref')} {r.get('subject')}: {r.get('requirement', '')[:180]}"
                 + (f" [{r.get('threshold_inr_cr')} Cr]" if r.get("threshold_inr_cr") else "") for r in rows]
        if crit.get("similar_work_definition"):
            brief.append("Similar work: " + crit["similar_work_definition"])
        return (f"Shown to the user as a table ({len(rows)} criteria). Reply in one line; don't repeat them.\n"
                + "\n".join(brief))

    def _save(self, path: str, name: str, kind: str, label: str, folder: str = "prep", match: str = "") -> dict:
        saved = self.ws.save_file(path, name, kind=kind, folder=folder, label=label)
        return {"file": saved["file"], "path": path, "name": name, "kind": kind, "label": label, "match": match}

    def _files_card(self, title: str, saved: list[dict], attached: list[dict] | None = None):
        self.cards.append({"type": "files", "title": title, "folder": PREP_FOLDER,
                           "files": [{"file_id": s["file"]["id"], "name": s["file"]["name"], "kind": s["kind"]}
                                     for s in saved],
                           "attached": attached or []})

    def tool_save_prequalification(self, format: str = "xlsx") -> str:
        if not self.result.get("criteria", {}).get("criteria"):
            return "There are no criteria to save."
        res = dict(self.result)
        res["compliance"] = compliance.check(res.get("criteria", {}), self.get_profile())
        ref = re.sub(r"[^\w.-]+", "_", str(res.get("tender", {}).get("reference") or "tender"))[:40]
        tmp = tempfile.mkdtemp(prefix="bidprequal_")
        try:
            base = os.path.join(tmp, f"Prequalification - {ref}")
            if format == "xlsx":
                path = base + ".xlsx"
                generate.write_prequal_xlsx(path, res)
            else:
                path = base + ".docx"
                generate.write_prequal_docx(path, res)
                if format == "pdf":
                    try:
                        path = generate.to_pdf(path)
                    except Exception as e:
                        self.progress(str(e))
            self.progress("Saving to Docs for Preparation…")
            s = self._save(path, os.path.basename(path), "prequalification", "Prequalification criteria")
            self._files_card("Saved to Docs for Preparation", [s])
            return f"Saved {s['file']['name']} to Docs for Preparation."
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def tool_list_tender_forms(self) -> str:
        forms = self.result.get("forms", [])
        missing = self.result.get("missing_forms", [])
        self.cards.append({"type": "table", "title": f"Tender forms ({len(forms)})", "columns": ["Form", "Title", "Pages"],
                           "rows": [[f.get("code"), f.get("title"), f"{f.get('file')} p{f.get('start_page')}-{f.get('end_page')}"]
                                    for f in forms]})
        text = "\n".join(f"{f.get('code')}: {f.get('title')}" for f in forms) or "No forms found."
        if missing:
            text += "\nAsked for by the criteria but not found in the documents: " + ", ".join(missing)
        return text

    def _pick_forms(self, codes: list[str]) -> tuple[list[dict], list[str]]:
        forms = self.result.get("forms", [])
        if not codes:
            return forms, []
        picked, unknown = [], []
        for code in codes:
            want = normalize_form_code(code).lower()
            hits = [f for f in forms if normalize_form_code(f.get("code", "")).lower() == want] or \
                   [f for f in forms if want and (want in normalize_form_code(f.get("code", "")).lower()
                                                   or norm_name(code) in norm_name(f.get("title", "")))]
            if hits:
                picked += [h for h in hits if h not in picked]
            else:
                unknown.append(code)
        return picked, unknown

    def _form_file(self, form: dict, fmt: str, tmp: str) -> str:
        tender = self.result.get("tender", {})
        name = generate.safe_name(f"{form.get('code', '')} - {form.get('title', '')}".strip(" -"))
        path = os.path.join(tmp, name + ".docx")
        generate.write_docx(form, path, self.get_profile(), tender)
        if fmt == "pdf":
            try:
                return generate.to_pdf(path)
            except Exception as e:
                self.progress(str(e))
        return path

    def tool_extract_tender_forms(self, codes: list[str], format: str = "docx") -> str:
        forms, unknown = self._pick_forms(codes or [])
        if not forms:
            return ("No matching forms. " + (f"Not found: {', '.join(unknown)}. " if unknown else "") +
                    "Use list_tender_forms to see what the tender contains.")
        tmp = tempfile.mkdtemp(prefix="bidforms_")
        try:
            saved = []
            if format == "xlsx":
                path = os.path.join(tmp, "Tender forms.xlsx" if len(forms) > 1 else
                                    generate.safe_name(f"{forms[0].get('code')} - {forms[0].get('title')}") + ".xlsx")
                generate.write_workbook(path, forms, {}, [], self.get_profile(), self.result.get("tender", {}), {})
                saved.append(self._save(path, os.path.basename(path), "form", "Tender forms"))
            else:
                for i, f in enumerate(forms, start=1):
                    self.progress(f"Preparing {f.get('code')} ({i}/{len(forms)})…")
                    path = self._form_file(f, format, tmp)
                    saved.append(self._save(path, os.path.basename(path), "form", f.get("title", ""),
                                            match=f.get("code", "")))
            attached = self.ws.attach_matching(saved)
            self._files_card("Saved to Docs for Preparation", saved, attached)
            msg = f"Saved {len(saved)} file(s) to Docs for Preparation"
            if attached:
                msg += f" and attached {len(attached)} to their Ready Docs checklist rows"
            if unknown:
                msg += f". Not found in the tender: {', '.join(unknown)}"
            return msg + "."
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def tool_check_eligibility(self) -> str:
        checks = compliance.check(self.result.get("criteria", {}), self.get_profile())
        if not checks:
            return "No criteria to check."
        self.cards.append({"type": "table", "title": "Eligibility check", "columns": ["Ref", "Criterion", "Required", "Ours", "Result"],
                           "rows": [[c["ref"], c["subject"], c["required"], c["actual"], c["status"]] for c in checks]})
        return "\n".join(f"{c['ref']} {c['subject']}: {c['status']} (needs {c['required'] or '-'}, ours {c['actual'] or '-'}) {c['remarks']}"
                         for c in checks)

    def tool_prepare_checklist(self, items: list[dict]) -> str:
        employer = (self.result.get("tender") or {}).get("employer") or ""
        tname, trows = ("", [])
        try:
            tname, trows = self.ws.template_rows(employer)
        except Exception:
            pass
        items = trows + ([i for i in (items or []) if str(i.get("name") or "").strip()] or default_checklist(self.result))
        self.progress("Adding rows to Ready Docs…")
        rows = self.ws.add_checklist_rows(items)
        # Attach the forms the agent prepares: every row that names a tender form gets that form.
        tmp = tempfile.mkdtemp(prefix="bidattach_")
        attached = []
        try:
            for row in rows:
                if row.get("server_file"):
                    continue
                codes = form_codes_in(row["req_file_name"])
                forms, _ = self._pick_forms(codes) if codes else ([], [])
                if not forms:
                    continue
                f = forms[0]
                self.progress(f"Attaching {f.get('code')}…")
                path = self._form_file(f, "docx", tmp)
                r = self.ws.save_file(path, os.path.basename(path), kind="form", folder="ready",
                                      checklist_item_id=row["id"], label=f.get("title", ""))
                if r.get("attached"):
                    attached.append({"row": row["req_file_name"], "file": r["file"]["name"]})
                    row["attached_file"] = r["file"]["name"]
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        self.cards.append({"type": "checklist", "title": "Ready Docs checklist", "folder": READY_SUBFOLDER,
                           "rows": [{"id": r["id"], "name": r["req_file_name"], "added": r.get("added", False),
                                     "file": r.get("attached_file") or ((r.get("server_file") or {}).get("name") or "")}
                                    for r in rows]})
        added = sum(1 for r in rows if r.get("added"))
        return (f"Ready Docs: {added} row(s) added ({len(rows) - added} already there), {len(attached)} form(s) "
                f"attached; the rest are Pending for files to be attached."
                + (f" Started from your template '{tname}'." if tname else ""))

    def tool_list_tender_documents(self) -> str:
        docs = self.result.get("documents", [])
        self.cards.append({"type": "table", "title": "Tender files", "columns": ["File", "Pages", "Sections"],
                           "rows": [[d["file"], d.get("pages", 0), d.get("error") or "; ".join(
                               f"{s['label']} p{s['start_page']}-{s['end_page']}" for s in d.get("segments", []))]
                                    for d in docs]})
        used = "; ".join(f"{c['file']} p{c['start_page']}-{c['end_page']}" for c in self.result.get("criteria_pages", []))
        return "\n".join(f"{d['file']} ({d.get('pages', 0)} pages): " + (d.get("error") or ", ".join(
            f"{s['label']} p{s['start_page']}-{s['end_page']}" for s in d.get("segments", []))) for d in docs) + \
            (f"\nCriteria were read from: {used}" if used else "")

    def tool_read_tender_pages(self, file: str = "", start_page: int = 1, end_page: int = 1) -> str:
        if not self.pages:
            return "Page reading isn't available."
        name, text, scanned = self.pages.read(file, int(start_page), int(end_page))
        if scanned:
            return (f"{name} pages {start_page}-{end_page} are scanned images with little text. Use "
                    "extract_criteria_from_pages to read them with the page images.\n" + text)
        return f"{name} pages {start_page}-{end_page}:\n{text}"

    def tool_extract_criteria_from_pages(self, file: str = "", start_page: int = 1, end_page: int = 1) -> str:
        if not self.pages:
            return "Page reading isn't available."
        self.progress(f"Reading the criteria on pages {start_page}-{end_page}…")
        name, crit = self.pages.criteria(file, int(start_page), int(end_page))
        if not crit.get("criteria"):
            return (f"No qualification criteria could be read on {name} pages {start_page}-{end_page}. "
                    "Ask the user to check the page numbers (they may be printed page numbers, not PDF pages).")
        result = dict(self.result)
        result["criteria"] = crit
        result["criteria_pages"] = [{"file": name, "start_page": int(start_page), "end_page": int(end_page), "by": "user"}]
        result["compliance"] = compliance.check(crit, self.get_profile())
        self._result = result
        self.save_result(result)
        out = self.tool_show_prequalification(False)
        return f"Read {len(crit['criteria'])} criteria from {name} pages {start_page}-{end_page} and saved them. " + out

    def tool_remember(self, text: str = "", applies_to: str = "employer") -> str:
        if not self._remember:
            return "Can't save that here."
        self._remember(text, applies_to)
        return "Saved; I'll follow it next time."

    def tool_list_reference_documents(self) -> str:
        refs = self.ws.references()
        if not refs:
            return "No reference documents yet. They can be added in Bid Agent settings."
        self.cards.append({"type": "table", "title": "Reference documents", "columns": ["Document", "Note"],
                           "rows": [[r["name"], r.get("label") or ""] for r in refs]})
        return "\n".join(r["name"] for r in refs)

    def tool_attach_reference_document(self, document: str = "", row: str = "") -> str:
        refs = self.ws.references()
        want = norm_name(document)
        hit = next((r for r in refs if norm_name(r["name"]) == want), None) or \
            next((r for r in refs if want and want in norm_name(r["name"])), None)
        if not hit:
            return f"No reference document named like '{document}'."
        rows = self.ws.add_checklist_rows([{"name": row or os.path.splitext(hit["name"])[0],
                                            "description": "Reference document"}])
        target = rows[0]
        if target.get("server_file"):
            return f"'{target['req_file_name']}' already has a file."
        tmp = tempfile.mkdtemp(prefix="bidref_")
        try:
            path = self.ws.fetch_to(hit["storage_ref"], os.path.join(tmp, hit["name"]))
            r = self.ws.save_file(path, hit["name"], kind="reference", folder="ready",
                                  checklist_item_id=target["id"], label=hit.get("label") or "")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        self.cards.append({"type": "checklist", "title": "Ready Docs checklist", "folder": READY_SUBFOLDER,
                           "rows": [{"id": target["id"], "name": target["req_file_name"], "added": target.get("added", False),
                                     "file": r["file"]["name"] if r.get("attached") else ""}]})
        return f"Attached {hit['name']} to '{target['req_file_name']}'." if r.get("attached") else \
            f"'{target['req_file_name']}' already has a file."

    def tool_list_saved_files(self) -> str:
        files = self.ws.files()
        self.cards.append({"type": "files", "title": "Saved for this tender", "folder": "",
                           "files": [{"file_id": f["file_id"], "name": f["name"], "kind": f["kind"],
                                      "folder": f["folder"]} for f in files], "attached": []})
        return "\n".join(f"{f['name']} ({f['folder']})" for f in files) or "Nothing saved yet."


def default_checklist(result: dict) -> list[dict]:
    """Checklist without AI: every form found or asked for, evidence the criteria name, usual items."""
    items: list[dict] = []
    seen = set()

    def add(name: str, desc: str):
        key = norm_name(name)
        if key and key not in seen:
            seen.add(key)
            items.append({"name": name, "description": desc})

    for f in result.get("forms", []):
        add(f"{f.get('code')} - {f.get('title')}".strip(" -"), "Bidding form (prepared by the Bid Agent)")
    for code in result.get("missing_forms", []):
        add(code, "Required by the qualification criteria")
    metrics = {c.get("metric") for c in result.get("criteria", {}).get("criteria", [])}
    if metrics & {"avg_annual_turnover", "net_worth", "liquidity", "bid_capacity"}:
        add("Audited balance sheets and P&L (last 5 years)", "Financial evidence for the criteria")
        add("CA certificate of turnover and net worth", "Financial evidence for the criteria")
    if metrics & {"similar_work_value", "specific_experience", "general_experience_years"}:
        add("Work orders and completion certificates of similar works", "Experience evidence")
    if "bid_capacity" in metrics:
        add("Statement of works in hand", "For the bid capacity calculation")
    if "certificate" in metrics:
        add("ISO certificates", "As asked in the criteria")
    if result.get("criteria", {}).get("personnel"):
        add("CVs of key personnel", "Key personnel listed in the criteria")
    for name, desc in (("Bid security / EMD", "As per the tender"), ("Power of attorney for the signatory", "Authorises the bid signatory"),
                       ("Tender fee receipt", "If the tender charges a fee")):
        add(name, desc)
    return items


_PQ = r"(pre-?qual\w*|\bpq\b|qualif\w*|eligib\w*|criteri\w*)"
INTENTS = [
    ("save_prequalification", r"\b(save|download|export|store|keep)\b.*" + _PQ),
    ("prepare_checklist", r"(checklist|documents? required|required documents?|list of documents)"),
    ("extract_tender_forms", r"\b(extract|save|download|export|prepare|fill|get)\b.*(forms?\b|formats?\b|annexure\w*|letter of bid|\b[a-z]{2,6}-?\d)"),
    ("list_tender_forms", r"(\bforms?\b|\bformats?\b|annexure\w*)"),
    ("check_eligibility", r"(\bqualify\b|\beligible\b|complian\w*|can we bid|do we meet)"),
    ("show_prequalification", _PQ),
    ("show_tender_sections", r"(\bsections?\b|\bvolumes?\b|where is|which file)"),
    ("list_tender_documents", r"(which files|tender files|documents? (in|of) the tender|list (the )?documents)"),
    ("list_saved_files", r"(\bsaved\b|\bfiles\b|what have you)"),
]


PAGES_RE = re.compile(r"\b(?:pages?|pgs?|p)\.?\s*(?:no\.?\s*)?(\d{1,4})(?:\s*(?:-|–|to|till|until|and)\s*(\d{1,4}))?", re.I)
FILE_RE = re.compile(r"\b(?:in|of|from)\s+(?:the\s+)?(?:file|document|doc|volume|vol\.?)\s+[\"“']?([^\"”',.]+)", re.I)


def route_without_ai(text: str) -> tuple[str, dict] | None:
    t = (text or "").lower()
    if re.match(r"^\s*(remember|note that|always|from now on|next time)\b", t):
        body = re.sub(r"^\s*(remember( that)?|note that)\s*[:,-]?\s*", "", text or "", flags=re.I).strip()
        return "remember", {"text": body or text, "applies_to": "all" if re.search(r"\b(all|every|always)\b", t) else "employer"}
    pages = PAGES_RE.search(text or "")
    if pages and re.search(_PQ + r"|requirement|turnover|experience", t):
        a = int(pages.group(1))
        b = int(pages.group(2) or a)
        f = FILE_RE.search(text or "")
        return "extract_criteria_from_pages", {"file": f.group(1).strip() if f else "", "start_page": min(a, b),
                                               "end_page": max(a, b)}
    fmt = "pdf" if "pdf" in t else "xlsx" if re.search(r"excel|xlsx|sheet", t) else "docx" if re.search(r"word|docx|doc\b", t) else ""
    for name, pattern in INTENTS:
        if re.search(pattern, t):
            if name == "save_prequalification":
                return name, {"format": fmt or "xlsx"}
            if name == "extract_tender_forms":
                codes = form_codes_in(text)
                if not codes and not re.search(r"\ball\b|\bforms\b|\bformats\b", t):
                    # "get the letter of bid" -> match the form by its title
                    phrase = re.sub(r"^.*?\b(extract|save|download|export|prepare|fill|get)\b", "", t)
                    phrase = re.sub(r"\b(the|a|an|form|format|in|as|word|pdf|excel|docx|xlsx|please|me)\b", " ", phrase)
                    phrase = " ".join(phrase.split())
                    codes = [phrase] if phrase else []
                return name, {"codes": codes, "format": fmt or "docx"}
            if name == "show_prequalification":
                return name, {"include_our_position": bool(re.search(r"\bour|we\b", t))}
            if name == "prepare_checklist":
                return name, {"items": []}
            return name, {}
    return None


def run_turn(turn: Turn, history: list[dict], message: str, llm, *, model: str = "", effort: str = "low",
             system_extra: str = "", grounding: list[dict] | None = None,
             on_partial: Callable[[str], None] | None = None, max_steps: int = 5) -> str:
    """Runs one request; returns the assistant's reply text (cards are on ``turn.cards``).

    ``model``/``effort``: the chat model (fast; documents are read by the document model).
    ``system_extra``: standing instructions and learned notes. ``grounding``: content blocks with the
    tender's key pages, sent as a fixed first turn so follow-ups are answered from them (prompt-cached).
    ``on_partial``: receives the reply text as it streams."""
    if llm is None or not llm.available:
        routed = route_without_ai(message)
        if not routed:
            return HELP
        name, args = routed
        out = turn.call(name, args)
        if name == "extract_criteria_from_pages":
            return out.split(" Shown to the user.")[0]
        if name.startswith("show_") or name in ("list_tender_forms", "check_eligibility", "list_tender_documents"):
            return "Here it is." if not out.startswith("Error") else out
        return out

    client = llm._get_client()
    tender = turn.ws.tender
    msgs: list[Any] = []
    if grounding:
        blocks = [dict(b) for b in grounding]
        blocks[-1] = {**blocks[-1], "cache_control": {"type": "ephemeral"}}
        msgs.append({"role": "user", "content": blocks + [{"type": "text", "text":
                     "These are the tender's key pages. Answer from them."}]})
        msgs.append({"role": "assistant", "content": "Understood."})
    convo: list[dict] = []
    for h in history[-12:]:
        if h.get("role") in ("user", "assistant") and h.get("text"):
            convo.append({"role": h["role"], "content": h["text"]})
    while convo and convo[0]["role"] != "user":
        convo.pop(0)
    msgs += convo
    msgs.append({"role": "user", "content": message})
    system = SYSTEM + (f"\n{system_extra.strip()}\n" if system_extra.strip() else "") + \
        f"\nTender: {tender.get('tender_id')} - {tender.get('title')} ({str(tender.get('org_chain', '')).split('||')[0]})."
    text_so_far = ""
    for _step in range(max_steps):
        with client.beta.messages.stream(
            model=model or llm.model, max_tokens=4000, betas=["server-side-fallback-2026-07-01"], fallbacks="default",
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            tools=TOOLS, messages=msgs, output_config={"effort": effort},
        ) as stream:
            step_text = ""
            for chunk in stream.text_stream:
                step_text += chunk
                if on_partial and step_text.strip():
                    on_partial(step_text.strip())  # the bubble shows the step being written
            resp = stream.get_final_message()
        llm.usage["calls"] += 1
        if resp.stop_reason == "refusal":
            return "I can't help with that request."
        msgs.append({"role": "assistant", "content": resp.content})
        if resp.stop_reason == "pause_turn":
            continue
        uses = [b for b in resp.content if getattr(b, "type", "") == "tool_use"]
        text = "".join(getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text").strip()
        if not uses:
            return text or text_so_far.strip() or "Done."
        if text:
            text_so_far += text + "\n\n"
        results = []
        for u in uses:
            turn.progress(TOOL_PROGRESS.get(u.name, "Working…"))
            results.append({"type": "tool_result", "tool_use_id": u.id, "content": turn.call(u.name, dict(u.input))})
        msgs.append({"role": "user", "content": results})
    return text_so_far.strip() or "Done."


TOOL_PROGRESS = {
    "show_tender_sections": "Looking through the tender…",
    "show_prequalification": "Reading the qualification criteria…",
    "save_prequalification": "Saving the prequalification…",
    "list_tender_forms": "Finding the tender forms…",
    "extract_tender_forms": "Extracting forms…",
    "check_eligibility": "Checking against your company profile…",
    "prepare_checklist": "Preparing the checklist…",
    "list_saved_files": "Listing saved files…",
    "remember": "Noting that…",
    "list_reference_documents": "Looking at your reference documents…",
    "attach_reference_document": "Attaching the document…",
    "list_tender_documents": "Listing the tender files…",
    "read_tender_pages": "Reading those pages…",
    "extract_criteria_from_pages": "Reading the criteria on those pages…",
}


def suggestions(result_ready: bool) -> list[str]:
    return ["Show the prequalification", "Save the prequal as Excel", "Extract all tender forms",
            "Prepare the documents checklist", "Can we qualify?"]
