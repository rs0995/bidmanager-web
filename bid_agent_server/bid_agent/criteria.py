"""Stage 2 – extract qualification / evaluation criteria into structured rows."""

from __future__ import annotations

import re
from typing import Callable

from .docreader import Document
from .llm import LLM, strict_schema

FORM_REF_RE = re.compile(
    r"\b(?:Form|Format|Annexure|Annex|Appendix|Schedule)\s*[-–:]?\s*(?:No\.?\s*)?"
    r"([A-Z]{2,6}\s*[-–]?\s*\d+(?:\.\d+)*(?:\s*\([a-z]\))?|[IVX]{1,5}|\d+(?:\.\d+)*(?:\s*\([a-z]\))?|[A-Z](?:-\d+)?)\b"
)
INR_RE = re.compile(r"(?:\bINR|\bRs\.?|₹)\s*(\d[\d,]*(?:\.\d+)?)\s*(crores?|cr\b\.?|lakhs?|lacs?)?", re.I)
WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
PERIOD_RE = re.compile(r"last\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\(\d+\)\s*)?(?:financial\s+)?years", re.I)


def _period_years(text: str) -> int:
    m = PERIOD_RE.search(text or "")
    if not m:
        return 0
    v = m.group(1).lower()
    return int(v) if v.isdigit() else WORDS.get(v, 0)

METRICS = [
    "avg_annual_turnover", "net_worth", "liquidity", "bid_capacity", "similar_work_value",
    "specific_experience", "general_experience_years", "certificate", "personnel", "equipment",
    "litigation", "eligibility", "other",
]

CRITERIA_SCHEMA = strict_schema(
    {
        "criteria": {
            "type": "array",
            "items": strict_schema(
                {
                    "ref": {"type": "string"},
                    "category": {"type": "string"},
                    "subject": {"type": "string"},
                    "requirement": {"type": "string"},
                    "single_entity": {"type": "string"},
                    "jv_all_parties": {"type": "string"},
                    "jv_each_member": {"type": "string"},
                    "jv_one_member": {"type": "string"},
                    "forms": {"type": "array", "items": {"type": "string"}},
                    "metric": {"type": "string", "enum": METRICS},
                    "threshold_inr_cr": {"type": "number"},
                    "threshold_count": {"type": "integer"},
                    "period_years": {"type": "integer"},
                    "page": {"type": "integer"},
                }
            ),
        },
        "personnel": {
            "type": "array",
            "items": strict_schema(
                {
                    "position": {"type": "string"},
                    "count": {"type": "string"},
                    "qualification": {"type": "string"},
                    "experience": {"type": "string"},
                }
            ),
        },
        "equipment": {
            "type": "array",
            "items": strict_schema(
                {"type": {"type": "string"}, "min_units": {"type": "string"}, "max_age_years": {"type": "string"}}
            ),
        },
        "similar_work_definition": {"type": "string"},
        "financial_year_cutoff": {"type": "string"},
        "notes": {"type": "array", "items": {"type": "string"}},
    }
)

CRITERIA_SYSTEM = (
    "You extract bidder qualification and evaluation criteria from tender documents for a contractor "
    "preparing a bid. Return every criterion row exactly as the employer states it (do not summarise away "
    "numbers, years, percentages or conditions). For each row: ref (the employer's numbering), category "
    "(e.g. Eligibility, Historical Non-Performance, Financial, Experience, ESHS), subject, requirement "
    "(complete text incl. formulas such as 2AN-B), the requirement for single entity / JV all parties "
    "combined / JV each member / JV one member (use '' when the document has no such column), forms = the "
    "bidding form codes cited as documentary evidence (e.g. 'FIN-3.2 (a)', 'EXP-4.1', 'ELI-1.1'), metric "
    "= best-fitting category from the enum, threshold_inr_cr = the main money threshold converted to INR "
    "crore (1 crore = 100 lakh; 0 when none), threshold_count = number of works required for that "
    "threshold option (0 when n/a), period_years = look-back period (0 when n/a), page = page number "
    "where the row starts. When a similar-work criterion offers alternatives (1 work of X OR 2 of Y OR 3 "
    "of Z) emit one row per alternative with the same ref suffixed (a), (b), (c). Also list key personnel "
    "and key equipment requirements, the definition of 'similar work', the financial-year cut-off date, "
    "and important notes (JV share rules, certificate requirements, escalation factors for updating "
    "past values). Criteria may be a table or numbered paragraphs (Indian NITs often use an 'Eligibility "
    "Criteria' / 'Qualifying requirements' list): capture EVERY criterion - financial (turnover, net worth, "
    "solvency, bid capacity), technical / similar-work experience, registration / licences, personnel, "
    "equipment - not only the JV conditions. JV conditions are separate rows. Pages that are scanned images "
    "are attached as PDF pages; read them too. If the given pages hold no criteria, return an empty list."
)


def _to_crore(amount: str, unit: str | None) -> float:
    try:
        v = float(amount.replace(",", ""))
    except ValueError:
        return 0.0
    u = (unit or "").lower()
    if u.startswith(("lakh", "lac")):
        return round(v / 100.0, 4)
    if u.startswith("cr"):
        return v
    # plain rupees
    return round(v / 1e7, 4) if v > 1e5 else v


def normalize_form_code(code: str) -> str:
    c = (code or "").replace("–", "-").replace("—", "-").strip()
    c = re.sub(r"(?i)^(forms?|format|annexure|annex|appendix|schedule)\s*[-:]?\s*", "", c)
    c = re.sub(r"\s+", " ", c)
    c = re.sub(r"^([A-Z]{2,6})\s*-?\s*(\d)", r"\1-\2", c)  # FIN3.2 / FIN 3.2 -> FIN-3.2
    c = re.sub(r"\s*\(\s*([a-z])\s*\)", r" (\1)", c)
    return c.strip(" .;:,")


def form_codes_in(text: str) -> list[str]:
    """Form codes cited in free text, expanding 'Forms ELI-1.1, 1.2' -> ELI-1.1, ELI-1.2."""
    t = (text or "").replace("–", "-")
    out: list[str] = []
    for m in re.finditer(r"\b([A-Z]{2,6})\s*-?\s*(\d+(?:\.\d+)*(?:\s*\([a-z]\))?)((?:\s*(?:,|and|&)\s*\d+(?:\.\d+)*(?:\s*\([a-z]\))?)*)", t):
        prefix = m.group(1)
        if prefix in {"ITB", "INR", "ISO", "GCC", "PCC", "BDS", "IS", "IRC", "BS", "EN", "OHSAS"} and not re.search(r"form", t[max(0, m.start() - 12):m.start()], re.I):
            continue
        codes = [m.group(2)] + re.findall(r"\d+(?:\.\d+)*(?:\s*\([a-z]\))?", m.group(3) or "")
        for c in codes:
            code = normalize_form_code(f"{prefix}-{c}")
            if code not in out:
                out.append(code)
    return out


# Words that mark qualification criteria in any tender style (tables or paragraphs).
CRITERIA_TERMS = [
    (re.compile(r"(average\s+)?annual\s+(financial\s+)?turnover|\bturnover\b", re.I), 3),
    (re.compile(r"similar\s+(nature\s+of\s+)?works?", re.I), 3),
    (re.compile(r"bid(ding)?\s+capacity|\b2\s*A\s*N\s*-\s*B\b", re.I), 3),
    (re.compile(r"net\s*worth|solvency|liquid\s+assets|working\s+capital|credit\s+facilit", re.I), 2),
    (re.compile(r"eligibility\s+criteria|qualif(ying|ication)\s+(criteria|requirements?)|minimum\s+eligibility", re.I), 4),
    (re.compile(r"(completed|executed)\s+.{0,40}(works?|contracts?)", re.I), 1),
    (re.compile(r"(last|preceding)\s+(\d+|three|five|seven)\s*(financial\s+)?years", re.I), 1),
    (re.compile(r"(rs\.?|inr|₹)\s*\d[\d,.]*\s*(crores?|cr\b|lakhs?|lacs?)", re.I), 1),
    (re.compile(r"work\s+done\s+certificate|completion\s+certificate|audited\s+(balance|financial)", re.I), 1),
]


def page_criteria_score(text: str) -> int:
    return sum(min(3, len(rx.findall(text or ""))) * w for rx, w in CRITERIA_TERMS)


def criteria_pages(docs, classified: list[tuple], max_pages: int = 40) -> list[tuple]:
    """Pages that hold the qualification criteria: the sections classified as such,
    plus any page (in any file) dense with criteria language, with a page of context.
    Returns (doc, start, end) ranges."""
    picked: dict[str, set[int]] = {}
    by_name = {d.name: d for d in docs}
    for doc, s, e in classified:
        if e - s + 1 <= max_pages:
            picked.setdefault(doc.name, set()).update(range(s, e + 1))
    # Pages outside the classified sections count only if they read at least as much
    # like criteria as the best classified page (a wrongly classified section, e.g.
    # just the JV clause, is then overruled by the real criteria list).
    best_in = 0
    for doc in docs:
        for n in picked.get(doc.name, ()):
            best_in = max(best_in, page_criteria_score(doc.pages[n - 1].text))
    threshold = max(9, 0.8 * best_in)
    scored = []
    for doc in docs:
        inside = picked.get(doc.name, set())
        for p in doc.pages:
            if p.number in inside:
                continue
            sc = page_criteria_score(p.text)
            if sc >= threshold:
                scored.append((sc, doc.name, p.number))
    scored.sort(reverse=True)
    for sc, name, num in scored[:max_pages]:
        doc = by_name[name]
        pages = picked.setdefault(name, set())
        for n in (num - 1, num, num + 1):
            if 1 <= n <= doc.page_count:
                pages.add(n)
    out: list[tuple] = []
    budget = max_pages * 2
    for name, pages in picked.items():
        doc = by_name[name]
        for a, b in _ranges(sorted(pages)):
            if budget <= 0:
                break
            b = min(b, a + budget - 1)
            out.append((doc, a, b))
            budget -= b - a + 1
    return out


def _ranges(nums: list[int]):
    if not nums:
        return
    start = prev = nums[0]
    for n in nums[1:]:
        if n == prev + 1:
            prev = n
            continue
        yield start, prev
        start = prev = n
    yield start, prev


CLAUSE_RE = re.compile(r"^\s*((\d{1,2}(\.\d{1,2}){0,2})[.)]?|\(?[a-z]\)|\(?[ivx]{1,4}\)|[a-z]\.)\s+(?=\S)", re.I)


def paragraph_criteria(doc: Document, start: int, end: int) -> list[dict]:
    """Numbered paragraphs that state criteria ("1. Average annual turnover ... Rs 45 Cr")."""
    lines: list[tuple[int, str]] = []
    for page in doc.pages[start - 1:end]:
        for ln in page.text.splitlines():
            if ln.strip():
                lines.append((page.number, ln.strip()))
    clauses: list[tuple[str, int, list[str]]] = []
    for num, ln in lines:
        if ln.count(" | ") >= 2:  # a table row as DOCX text: read from the table instead
            continue
        m = CLAUSE_RE.match(ln)
        if m and len(ln) > 12:
            clauses.append((m.group(1).strip("()."), num, [ln[m.end():]]))
        elif clauses:
            clauses[-1][2].append(ln)
    rows = []
    for ref, page_no, body in clauses:
        text = " ".join(body)
        text = re.sub(r"\s+", " ", text).strip()
        if page_criteria_score(text) < 3 or len(text) < 30:
            continue
        subject = re.split(r"[:–—-]\s|\.\s", text, maxsplit=1)[0][:80] if len(text) > 80 else ""
        m = INR_RE.search(text)
        rows.append({
            "ref": ref, "category": "", "subject": subject, "requirement": text[:1500],
            "single_entity": "", "jv_all_parties": "", "jv_each_member": "", "jv_one_member": "",
            "forms": form_codes_in(text), "metric": _guess_metric(text),
            "threshold_inr_cr": _to_crore(m.group(1), m.group(2)) if m else 0.0,
            "threshold_count": 0, "period_years": _period_years(text), "page": page_no,
        })
    return rows


def _table_kind(table: list[list[str]]) -> str:
    head = " ".join(" ".join(r) for r in table[:3]).lower()
    if ("designation" in head or "position" in head) and "qualification" in head:
        return "personnel"
    if "equipment" in head and ("no. of units" in head or "minimum" in head or "type" in head):
        return "equipment"
    if re.search(r"requirement|criteri|qualif|eligib|particulars", head) and re.search(
            r"form|document|single entity|joint venture|\bjv\b|evidence|submit|complian|remarks|annex", head):
        return "criteria"
    return ""


def heuristic_criteria(doc: Document, start: int, end: int) -> dict:
    """Table-driven fallback when no LLM is configured."""
    rows_out, personnel, equipment = [], [], []
    last_kind, last_cols = "", 0
    for page in doc.pages[start - 1:end]:
        for table in page.tables:
            kind = _table_kind(table)
            cols = max(len(r) for r in table)
            if not kind and last_kind and cols == last_cols:
                kind = last_kind  # continuation of the previous page's table
            last_kind, last_cols = kind, cols
            for raw in table:
                row = [c for c in raw if c.strip()]  # drop blanks left by merged cells
                if not row:
                    continue
                ref = row[0].strip()
                if kind == "personnel" and len(row) >= 5 and re.match(r"^\d+(\.\d+)*$", ref) and "." in ref:
                    personnel.append({"position": row[1], "count": row[2], "qualification": row[3], "experience": row[4]})
                elif kind == "equipment" and len(row) >= 3 and re.match(r"^[a-z]\)$|^\([a-z]\)$", ref, re.I):
                    equipment.append({"type": row[1], "min_units": row[2], "max_age_years": row[3] if len(row) > 3 else ""})
                elif kind == "criteria" and len(row) >= 4 and re.match(r"^(\d+(\.\d+)*|\([a-z]\))$", ref):
                    subject, requirement = row[1], row[2]
                    middle = row[3:-1] if len(row) >= 5 else []
                    middle += [""] * (4 - len(middle))
                    m = INR_RE.search(requirement)
                    rows_out.append(
                        {
                            "ref": ref,
                            "category": "",
                            "subject": subject,
                            "requirement": requirement,
                            "single_entity": middle[0],
                            "jv_all_parties": middle[1],
                            "jv_each_member": middle[2],
                            "jv_one_member": middle[3],
                            "forms": form_codes_in(row[-1]) or ([row[-1]] if row[-1] else []),
                            "metric": _guess_metric(subject + " " + requirement),
                            "threshold_inr_cr": _to_crore(m.group(1), m.group(2)) if m else 0.0,
                            "threshold_count": 0,
                            "period_years": _period_years(requirement),
                            "page": page.number,
                        }
                    )
    # Criteria written as numbered paragraphs (common in Indian NITs) - only where the
    # tables didn't already give the criteria.
    if len(rows_out) >= 3:
        return {
            "criteria": rows_out,
            "personnel": personnel,
            "equipment": equipment,
            "similar_work_definition": "",
            "financial_year_cutoff": "",
            "notes": ["Extracted without AI (no Claude API key configured): verify against the document."],
        }
    norm = lambda x: re.sub(r"\W+", "", (x or "").lower())  # noqa: E731
    known = [norm(r["requirement"])[:60] for r in rows_out if norm(r["requirement"])]
    for row in paragraph_criteria(doc, start, end):
        text = norm(row["requirement"])
        if any(k and (k[:40] in text or text[:40] in k) for k in known):
            continue  # already read from a table
        known.append(text[:60])
        rows_out.append(row)
    return {
        "criteria": rows_out,
        "personnel": personnel,
        "equipment": equipment,
        "similar_work_definition": "",
        "financial_year_cutoff": "",
        "notes": ["Extracted without AI (no Claude API key configured): verify against the document."],
    }


def _guess_metric(text: str) -> str:
    t = text.lower()
    table = [
        ("litigation", ["litigation"]),
        ("eligibility", ["nationality", "conflict of interest", "eligib", "debar", "blacklist", "non-perform", "suspension"]),
        ("certificate", ["iso ", "iso certif", "certificates"]),
        ("bid_capacity", ["bid capacity"]),
        ("avg_annual_turnover", ["turnover"]),
        ("liquidity", ["liquidity", "cash flow"]),
        ("net_worth", ["net worth", "financial position"]),
        ("similar_work_value", ["similar work"]),
        ("general_experience_years", ["general construction experience"]),
        ("specific_experience", ["experience"]),
    ]
    for metric, keys in table:
        if any(k in t for k in keys):
            return metric
    return "other"


LOCATE_CRITERIA_SCHEMA = strict_schema({
    "ranges": {
        "type": "array",
        "items": strict_schema({"file": {"type": "string"}, "start_page": {"type": "integer"},
                                "end_page": {"type": "integer"}, "what": {"type": "string"}}),
    }
})

LOCATE_CRITERIA_SYSTEM = (
    "You find where a tender states the bidder's qualification / eligibility / evaluation criteria "
    "(minimum turnover, net worth, liquidity, bid capacity, similar works, experience, key personnel, "
    "equipment, certificates, JV rules). Indian tenders often put them in an 'Eligibility Criteria' or "
    "'Qualifying Requirements' list inside the NIT; World-Bank style tenders in Section III. Return every page "
    "range that holds them (include the start of each list and its continuation pages), not the bidding forms, "
    "contract conditions or the index."
)

MAX_AI_CRITERIA_PAGES = 60


def llm_criteria_pages(docs: list[Document], classified: list[tuple], llm: LLM,
                       log: Callable[[str], None] = lambda _m: None) -> list[tuple]:
    """Claude picks the pages with the qualification criteria from an outline of every page
    (its first lines, plus where the section map and keyword scores point). -> (doc, start, end)."""
    hint = {(d.name, n) for d, a, b in classified for n in range(a, b + 1)}
    lines = []
    for doc in docs:
        lines.append(f"### FILE: {doc.name} ({doc.page_count} pages)")
        for p in doc.pages:
            head = " / ".join(ln.strip()[:90] for ln in p.text.splitlines() if ln.strip())[:220]
            score = page_criteria_score(p.text)
            flag = (" [section map: criteria]" if (doc.name, p.number) in hint else "") + \
                (f" [criteria words: {score}]" if score else "")
            lines.append(f"p{p.number}: {head}{flag}")
    outline = "\n".join(lines)
    if len(outline) > 400_000:
        outline = outline[:400_000]
    data = llm.json_call(LOCATE_CRITERIA_SYSTEM, "Outline of the tender's files, one line per page:\n\n" + outline,
                         LOCATE_CRITERIA_SCHEMA, effort="low", max_tokens=4000)
    by_name = {d.name: d for d in docs}
    out: list[tuple] = []
    budget = MAX_AI_CRITERIA_PAGES
    for r in data.get("ranges", []):
        doc = by_name.get(r.get("file")) or next((d for d in docs if r.get("file") and r["file"] in d.name), None)
        if not doc or budget <= 0:
            continue
        a = max(1, min(int(r["start_page"]), doc.page_count))
        b = max(a, min(int(r["end_page"]), doc.page_count, a + budget - 1))
        if not any(d is doc and not (b < x or a > y) for d, x, y in out):
            out.append((doc, a, b))
            budget -= b - a + 1
    log(f"Claude found the criteria on: " + ("; ".join(f"{d.name} p{a}-{b}" for d, a, b in out) or "no pages"))
    return out


def extract_criteria(
    sources: list[tuple[Document, int, int]],
    llm: LLM | None,
    log: Callable[[str], None] = lambda _m: None,
) -> dict:
    """``sources`` = (document, start_page, end_page) segments with criteria.

    With an API key Claude reads them: PDF pages are sent as the pages themselves (text,
    tables and layout, scanned or not), other files as text. Without a key, or if Claude
    fails, a rule-based reader is used and the result says so (``source``/``ai_error``)."""
    if not sources:
        return {"criteria": [], "personnel": [], "equipment": [], "similar_work_definition": "",
                "financial_year_cutoff": "", "notes": [], "source": "ai" if llm is not None and llm.available else "none"}
    ai_error = ""
    if llm is not None and llm.available:
        from .llm import pdf_pages_block

        parts = []
        blocks: list[dict] = []
        pdf_pages = 0
        for doc, s, e in sources:
            if doc.ext == ".pdf" and pdf_pages < MAX_AI_CRITERIA_PAGES:
                last = min(e, s + (MAX_AI_CRITERIA_PAGES - pdf_pages) - 1)
                try:
                    blocks.append(pdf_pages_block(doc.path, s, last))
                    pdf_pages += last - s + 1
                    parts.append(f"FILE {doc.name}: pages {s}-{last} attached as PDF pages (in the order listed).")
                    if last < e:
                        parts.append(f"===== FILE: {doc.name} (pages {last + 1}-{e}) =====\n" + doc.text_range(last + 1, e))
                    continue
                except Exception as ex:
                    log(f"Couldn't attach the pages of {doc.name} ({ex}); sending their text.")
            parts.append(f"===== FILE: {doc.name} (pages {s}-{e}) =====\n" + doc.text_range(s, e))
        text = "\n\n".join(parts)
        if len(text) > 600_000:
            log("Criteria section is very large; sending first 600k characters.")
            text = text[:600_000]
        content = blocks + [{"type": "text", "text": text}] if blocks else text
        try:
            data = llm.json_call(CRITERIA_SYSTEM, content, CRITERIA_SCHEMA, effort="medium", max_tokens=64000)
            data["source"] = "ai"
            return data
        except Exception as e:
            ai_error = str(e)[:300]
            log(f"Claude couldn't read the criteria ({ai_error}); using the basic reader.")
    merged = None
    for doc, s, e in sources:
        part = heuristic_criteria(doc, s, e)
        if merged is None:
            merged = part
        else:
            merged["criteria"].extend(part["criteria"])
    merged = merged or {}
    merged["source"] = "heuristic"
    if ai_error:
        merged["ai_error"] = ai_error
    return merged


def referenced_form_codes(criteria: dict) -> list[str]:
    codes: list[str] = []
    for row in criteria.get("criteria", []):
        for f in row.get("forms", []):
            found = form_codes_in(f) or [normalize_form_code(f)]
            for code in found:
                if code and len(code) <= 60 and code not in codes:
                    codes.append(code)
    return codes
