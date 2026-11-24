"""Stage 3 – locate bidding forms and turn each into a fillable template.

A form template ("schema") is a list of blocks:
  heading    {text}
  paragraph  {text}            placeholders written as {{field_id}}
  fields     {fields}          label/value pairs (name, address, date ...)
  table      {title, columns, prefilled_rows, rows_hint, binds_to}
  signature  {}
Each field/column carries an optional canonical ``key`` from company.py so it
can be pre-filled from the bidder's master data.

Templates are fingerprinted and stored per employer in ``bid_form_library``;
the next tender from the same employer with an unchanged form is generated
without another AI call.
"""

from __future__ import annotations

import hashlib
import re
from typing import Callable

from . import company
from .criteria import form_codes_in, normalize_form_code
from .docreader import Document
from .llm import LLM, strict_schema

FORM_START_RE = re.compile(
    r"^\s*(?:(?:Bidding\s+|Bid\s+|Tender\s+)?Form|FORM|Format|FORMAT|Annexure|ANNEXURE|Annex|ANNEX|Appendix|APPENDIX|"
    r"Proforma|PROFORMA|Schedule|SCHEDULE)\s*[-–:.]?\s*(?:No\.?\s*)?"
    r"(?P<code>[A-Z]{2,6}\s*[-–]?\s*\d+(?:\.\d+)*(?:\s*\([a-z]\))?|[IVX]{1,6}\b|\d+(?:\.\d+)*(?:\s*\([a-z]\))?|[A-Z]\b(?:\s*-\s*\d+)?)"
    r"\s*[:.\-–]?\s*(?P<title>.*)$"
)
# Lines like "FIN – 3.1: Historical Financial Performance" without the word "Form".
CODE_LINE_RE = re.compile(r"^\s*(?P<code>[A-Z]{2,6}\s*[-–]\s*\d+(?:\.\d+)*(?:\s*\([a-z]\))?)\s*[:.\-–]?\s*(?P<title>.{0,160})$")
PLACEHOLDER_RE = re.compile(r"\[[^\]]{2,120}\]|_{4,}|\.{6,}|…{2,}")


def _is_list_page(text: str) -> bool:
    """Pages listing many forms (index of forms) are not form bodies."""
    starts = sum(1 for ln in text.splitlines() if FORM_START_RE.match(ln) or CODE_LINE_RE.match(ln))
    return starts >= 6 or bool(re.search(r"(table\s+of\s+contents|list\s+of\s+(forms|annexures))", text, re.I))


def locate_forms(doc: Document, start: int, end: int, expected: list[str] | None = None) -> list[dict]:
    """Find form boundaries in pages [start, end] by their headings."""
    expected_norm = {normalize_form_code(c).lower() for c in (expected or [])}
    hits: list[dict] = []
    for page in doc.pages[start - 1:end]:
        if _is_list_page(page.text):
            continue
        lines = page.text.splitlines()
        for idx, ln in enumerate(lines):
            if idx > 12 and not expected_norm:
                break  # form titles sit near the top of a page unless we know the codes
            m = FORM_START_RE.match(ln) or CODE_LINE_RE.match(ln)
            if not m:
                continue
            code = normalize_form_code(m.group("code"))
            title = (m.group("title") or "").strip()
            if not title and idx + 1 < len(lines):
                title = lines[idx + 1].strip()
            known = code.lower() in expected_norm
            # Reject body-text cross references such as "Form FIN-3.2 shall be ..."
            if not known and (len(ln) > 140 or re.search(r"\b(shall|should|will|as per|refer)\b", ln, re.I)):
                continue
            if not known and idx > 12:
                continue
            if hits and hits[-1]["code"].lower() == code.lower() and page.number - hits[-1]["start_page"] <= 1:
                continue  # repeated header on a continuation page
            hits.append({"code": code, "title": title[:160], "start_page": page.number, "line": idx})
    forms = []
    for i, h in enumerate(hits):
        nxt = hits[i + 1] if i + 1 < len(hits) else None
        end_page = (nxt["start_page"] if nxt and nxt["line"] > 3 else (nxt["start_page"] - 1 if nxt else end))
        end_page = max(h["start_page"], end_page)
        forms.append({**h, "end_page": end_page, "text": _form_text(doc, h, nxt, end_page)})
    return forms


def _form_text(doc: Document, h: dict, nxt: dict | None, end_page: int) -> str:
    parts = []
    for p in doc.pages[h["start_page"] - 1:end_page]:
        lines = p.text.splitlines()
        if p.number == h["start_page"]:
            lines = lines[h["line"]:]
        if nxt and p.number == nxt["start_page"]:
            cut = nxt["line"] - (h["line"] if p.number == h["start_page"] else 0)
            lines = lines[:max(0, cut)]
        parts.append("\n".join(lines))
    return "\n".join(parts).strip()


def fingerprint(text: str) -> str:
    norm = re.sub(r"[^a-z]+", "", (text or "").lower())
    return hashlib.sha1(norm.encode()).hexdigest()[:20]


FIELD_SCHEMA = strict_schema({"id": {"type": "string"}, "label": {"type": "string"}, "key": {"type": "string"}})
BLOCK_SCHEMA = strict_schema(
    {
        "type": {"type": "string", "enum": ["heading", "paragraph", "fields", "table", "signature"]},
        "text": {"type": "string"},
        "fields": {"type": "array", "items": FIELD_SCHEMA},
        "title": {"type": "string"},
        "columns": {
            "type": "array",
            "items": strict_schema({"header": {"type": "string"}, "key": {"type": "string"}}),
        },
        "prefilled_rows": {"type": "array", "items": {"type": "array", "items": {"type": "string"}}},
        "rows_hint": {"type": "integer"},
        "binds_to": {"type": "string"},
    }
)
FORM_SCHEMA = strict_schema(
    {
        "code": {"type": "string"},
        "title": {"type": "string"},
        "kind": {"type": "string", "enum": ["letter", "table", "mixed"]},
        "instructions": {"type": "string"},
        "blocks": {"type": "array", "items": BLOCK_SCHEMA},
    }
)
FORMS_BATCH_SCHEMA = strict_schema({"forms": {"type": "array", "items": FORM_SCHEMA}})

FORM_SYSTEM = (
    "You convert tender bidding forms into fillable templates for a bidder's data-entry team. Reproduce "
    "each form faithfully - every heading, paragraph, declaration and table in order - but turn every "
    "blank, '[insert ...]' instruction, dotted line or underscore into a placeholder {{field_id}} inside "
    "the paragraph text and list it in a 'fields' block (id snake_case, label = what to enter). Put the "
    "employer's bracketed drafting notes (e.g. '[Bidder shall complete...]') into 'instructions', not "
    "into the body. Tables: columns in order; prefilled_rows only for rows whose first cells are fixed "
    "by the employer (e.g. financial-year labels, criterion names); rows_hint = number of blank rows "
    "the form expects (default 5). Map fields and columns to canonical bidder-profile keys where the "
    "meaning clearly matches (else key ''), and set binds_to on a table that lists repeated profile "
    "records (financials, experience, works_in_hand, personnel, equipment, certificates, litigation) "
    "else ''. kind: letter (mostly text), table (mostly a table), mixed. Unused properties: '' / [] / 0.\n\n"
    "Canonical keys:\n" + company.vocabulary_text()
)


def llm_structure_forms(forms: list[dict], llm: LLM, doc_name: str) -> list[dict]:
    """Structure several located forms in one request (cheaper than one call each)."""
    blocks = []
    for f in forms:
        blocks.append(f"===== FORM {f['code']} - {f['title']} (file {doc_name}, pages {f['start_page']}-{f['end_page']}) =====\n{f['text'][:40000]}")
    content = (
        "Convert each form below into a template. Return them in the same order, one entry per form, keeping "
        "the given code.\n\n" + "\n\n".join(blocks)
    )
    data = llm.json_call(FORM_SYSTEM, content, FORMS_BATCH_SCHEMA, effort="medium", max_tokens=64000)
    return data.get("forms", [])


LOCATE_SCHEMA = strict_schema(
    {
        "forms": {
            "type": "array",
            "items": strict_schema(
                {"code": {"type": "string"}, "title": {"type": "string"},
                 "start_page": {"type": "integer"}, "end_page": {"type": "integer"}}
            ),
        }
    }
)


def llm_locate_forms(doc: Document, start: int, end: int, llm: LLM, expected: list[str]) -> list[dict]:
    outline = []
    for p in doc.pages[start - 1:end]:
        lines = [ln.strip() for ln in p.text.splitlines() if ln.strip()][:6]
        outline.append(f"[{p.number}] " + " / ".join(l[:120] for l in lines))
    content = (
        f"FILE {doc.name}, pages {start}-{end}. Forms the qualification criteria refer to: "
        f"{', '.join(expected) or 'unknown'}.\nList every bidding form/format/annexure that the bidder must fill, "
        "with its code (as printed; invent a short code like 'LETTER-OF-BID' if none), title and page range. "
        "Skip index/contents pages.\n\n" + "\n".join(outline)
    )
    data = llm.json_call("You index bidding forms in tender documents.", content, LOCATE_SCHEMA,
                         effort="low", max_tokens=8000)
    out = []
    for f in data.get("forms", []):
        s = max(start, min(int(f["start_page"]), end))
        e = max(s, min(int(f["end_page"]), end))
        hit = {"code": normalize_form_code(f["code"]), "title": f["title"], "start_page": s, "line": 0}
        out.append({**hit, "end_page": e, "text": doc.text_range(s, e)})
    return out


def heuristic_structure(form: dict, doc: Document) -> dict:
    """Template without AI: paragraphs + detected blanks + the PDF's tables."""
    blocks: list[dict] = [_block("heading", text=f"{form['code']} {form['title']}".strip())]
    fields: list[dict] = []
    para: list[str] = []
    table_texts = set()
    tables = []
    for p in doc.pages[form["start_page"] - 1:form["end_page"]]:
        for t in p.tables:
            if t and max(len(r) for r in t) >= 2:
                tables.append(t)
                for r in t:
                    table_texts.update(c for c in r if c)

    def flush():
        if para:
            blocks.append(_block("paragraph", text=" ".join(para)))
            para.clear()

    notes: list[str] = []
    for ln in form["text"].splitlines()[1:]:
        s = ln.strip()
        if not s:
            flush()
            continue
        if s in table_texts:
            continue
        # Employer drafting notes: "[The Bidder shall fill in this Form ...]"
        if re.fullmatch(r"\[[^\]]{30,}\]\.?", s) or re.match(r"^\[?\s*(note|the bidder shall|bidder shall|this form)", s, re.I):
            notes.append(s.strip("[]. "))
            continue
        context = re.split(r"[\[_.…]", s, maxsplit=1)[0]

        def repl(m):
            fid = f"field_{len(fields) + 1}"
            label = m.group(0).strip("[]_.… ") or context.strip(" :") or f"Entry {len(fields) + 1}"
            key = company.guess_key(context) or company.guess_key(label)
            fields.append({"id": fid, "label": label[:100], "key": key})
            return "{{" + fid + "}}"

        line = PLACEHOLDER_RE.sub(repl, s)
        para.append(line)
        # New paragraph after a sentence/label end or a filled-in line.
        if line.endswith((".", ":", "]", "}}", ";")) or "{{" in line:
            flush()
    flush()
    if fields:
        blocks.append(_block("fields", fields=fields))
    for t in tables:
        header = [c or f"Column {i + 1}" for i, c in enumerate(t[0])]
        blocks.append(_block("table", columns=[{"header": h, "key": ""} for h in header],
                             prefilled_rows=[r for r in t[1:] if any(r)], rows_hint=max(0, 5 - (len(t) - 1))))
    blocks.append(_block("signature"))
    return {"code": form["code"], "title": form["title"], "kind": "table" if tables else "letter",
            "instructions": " ".join(notes + ["(Generated without AI - check wording against the tender document.)"]),
            "blocks": blocks}


def _block(kind: str, **kw) -> dict:
    b = {"type": kind, "text": "", "fields": [], "title": "", "columns": [], "prefilled_rows": [],
         "rows_hint": 0, "binds_to": ""}
    b.update(kw)
    return b


def extract_forms(
    sources: list[tuple[Document, int, int]],
    llm: LLM | None,
    store,
    org_key: str,
    expected_codes: list[str],
    log: Callable[[str], None] = lambda _m: None,
) -> list[dict]:
    """Locate + structure all forms in the bidding-forms segments."""
    results: list[dict] = []
    use_ai = llm is not None and llm.available
    for doc, start, end in sources:
        located = locate_forms(doc, start, end, expected_codes)
        if use_ai and len(located) < 2:
            try:
                located = llm_locate_forms(doc, start, end, llm, expected_codes) or located
            except Exception as e:
                log(f"AI form indexing failed for {doc.name}: {e}")
        log(f"{doc.name}: found {len(located)} form(s) on pages {start}-{end}.")
        pending: list[dict] = []
        for f in located:
            fp = fingerprint(f["text"])
            cached = store.find_form(org_key, f["code"], fp) if store else None
            if cached:
                results.append(_finish(cached, f, doc, fp, "library"))
            else:
                pending.append({**f, "fingerprint": fp})
        # Batch AI calls to keep each request a manageable size.
        batches: list[list[dict]] = []
        size = 0
        for f in pending:
            if not batches or size + len(f["text"]) > 60000 or len(batches[-1]) >= 12:
                batches.append([])
                size = 0
            batches[-1].append(f)
            size += len(f["text"])
        for batch in batches:
            structured: list[dict] = []
            if use_ai:
                try:
                    structured = llm_structure_forms(batch, llm, doc.name)
                except Exception as e:
                    log(f"AI form conversion failed ({e}); using layout-based templates.")
            for i, bf in enumerate(batch):
                if i < len(structured):
                    schema, source = structured[i], "ai"
                    schema["code"] = bf["code"] or schema.get("code", "")
                    if store:
                        store.save_form(org_key, schema, bf["fingerprint"], doc.name)
                else:
                    schema, source = heuristic_structure(bf, doc), "heuristic"
                results.append(_finish(schema, bf, doc, bf["fingerprint"], source))
    return results


def _finish(schema: dict, located: dict, doc: Document, fp: str, source: str) -> dict:
    return {
        **schema,
        "code": schema.get("code") or located["code"],
        "title": schema.get("title") or located["title"],
        "file": doc.name,
        "start_page": located["start_page"],
        "end_page": located["end_page"],
        "fingerprint": fp,
        "source": source,
    }


def missing_forms(expected: list[str], found: list[dict]) -> list[str]:
    have = {normalize_form_code(f.get("code", "")).lower() for f in found}
    have_base = {re.sub(r"\s*\([a-z]\)$", "", h) for h in have}
    out = []
    for c in expected:
        n = normalize_form_code(c).lower()
        if n in have or re.sub(r"\s*\([a-z]\)$", "", n) in have_base:
            continue
        if not form_codes_in(c):  # descriptive names like 'Letter of IFCQR Bid'
            if any(n[:12] in (f.get("title", "") + " " + f.get("code", "")).lower() for f in found):
                continue
        out.append(c)
    return out
