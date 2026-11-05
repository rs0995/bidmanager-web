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

SYSTEM = """You are the Bid Agent inside BidManager, working for a contractor preparing a bid for one \
public tender (Indian government / PSU / metro rail / multilateral-funded works). You act on the user's \
instructions using your tools; you don't just describe what could be done.

How to work:
- Use tools for every fact about the tender. Never invent criteria, values, form codes or page numbers.
- "Show/fetch/what is the prequal(ification) / PQ / eligibility / qualification criteria" -> \
show_prequalification. Then answer briefly; the table is already shown to the user.
- "Save/download/export the prequal" -> save_prequalification in the format asked (Excel by default; \
Word or PDF if asked). It goes to Docs for Preparation.
- "Extract/save the tender forms" or a specific form ("Form FIN-3.2", "letter of bid", "bidder information \
form") -> extract_tender_forms with the matching codes (call list_tender_forms first if unsure of codes), \
in the format asked (Word by default).
- "Prepare/make the checklist (of documents required)" -> prepare_checklist with every document the bid \
must contain according to THIS tender: each bidding form, each document the criteria ask as evidence (audited \
balance sheets, CA certificates, completion certificates, ISO certificates, ...), and the usual submission \
items the tender mentions (bid security / EMD, tender fee, power of attorney, JV agreement if JV is allowed, \
undertakings, affidavits). Name rows as the tender names them and put the form code first when there is one \
(e.g. "FIN-3.2 (a) - Average Annual Construction Turnover"). Rows start Pending; the agent attaches the \
forms it prepares to their rows automatically.
- "Can we qualify / are we eligible" -> check_eligibility.
- Keep answers short (1-4 sentences), say what you did and where it was saved. Don't repeat table contents \
the user can already see. Write amounts like "INR 190 Cr".
- If the tender's documents haven't been downloaded, say so and stop.
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
                 progress: Callable[[str], None] = lambda _m: None):
        self.ws = workspace
        self._get_result = get_result
        self.get_profile = get_profile
        self.progress = progress
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
        brief = [f"{r.get('ref')} {r.get('subject')}: {r.get('requirement', '')[:300]} | forms {', '.join(r.get('forms', []))}"
                 for r in rows]
        if crit.get("similar_work_definition"):
            brief.append("Similar work: " + crit["similar_work_definition"])
        return "Shown to the user. Criteria:\n" + "\n".join(brief)

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
        items = [i for i in (items or []) if str(i.get("name") or "").strip()] or default_checklist(self.result)
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
                f"attached; the rest are Pending for files to be attached.")

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
    ("list_saved_files", r"(\bsaved\b|\bfiles\b|what have you)"),
]


def route_without_ai(text: str) -> tuple[str, dict] | None:
    t = (text or "").lower()
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


def run_turn(turn: Turn, history: list[dict], message: str, llm) -> str:
    """Runs one request; returns the assistant's reply text (cards are on ``turn.cards``)."""
    if llm is None or not llm.available:
        routed = route_without_ai(message)
        if not routed:
            return HELP
        name, args = routed
        out = turn.call(name, args)
        if name.startswith("show_") or name in ("list_tender_forms", "check_eligibility"):
            return "Here it is." if not out.startswith("Error") else out
        return out

    client = llm._get_client()
    msgs: list[Any] = []
    for h in history[-12:]:
        if h.get("role") in ("user", "assistant") and h.get("text"):
            msgs.append({"role": h["role"], "content": h["text"]})
    while msgs and msgs[0]["role"] != "user":
        msgs.pop(0)
    msgs.append({"role": "user", "content": message})
    tender = turn.ws.tender
    system = SYSTEM + f"\nTender: {tender.get('tender_id')} - {tender.get('title')} ({tender.get('org_chain', '').split('||')[0]})."
    for _step in range(8):
        resp = client.beta.messages.create(
            model=llm.model, max_tokens=8000, betas=["server-side-fallback-2026-07-01"], fallbacks="default",
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            tools=TOOLS, messages=msgs, output_config={"effort": "medium"},
        )
        llm.usage["calls"] += 1
        if resp.stop_reason == "refusal":
            return "I can't help with that request."
        msgs.append({"role": "assistant", "content": resp.content})
        uses = [b for b in resp.content if getattr(b, "type", "") == "tool_use"]
        if resp.stop_reason == "pause_turn":
            continue
        if not uses:
            return "".join(getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text").strip() or "Done."
        results = []
        for u in uses:
            turn.progress(TOOL_PROGRESS.get(u.name, "Working…"))
            results.append({"type": "tool_result", "tool_use_id": u.id, "content": turn.call(u.name, dict(u.input))})
        msgs.append({"role": "user", "content": results})
    return "Done."


TOOL_PROGRESS = {
    "show_tender_sections": "Looking through the tender…",
    "show_prequalification": "Reading the qualification criteria…",
    "save_prequalification": "Saving the prequalification…",
    "list_tender_forms": "Finding the tender forms…",
    "extract_tender_forms": "Extracting forms…",
    "check_eligibility": "Checking against your company profile…",
    "prepare_checklist": "Preparing the checklist…",
    "list_saved_files": "Listing saved files…",
}


def suggestions(result_ready: bool) -> list[str]:
    return ["Show the prequalification", "Save the prequal as Excel", "Extract all tender forms",
            "Prepare the documents checklist", "Can we qualify?"]
