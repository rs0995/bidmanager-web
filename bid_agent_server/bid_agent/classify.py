"""Stage 1 – skim each tender file and map it (or page ranges of it) to roles.

Signals, cheapest first:
  1. file cache (same file analysed before -> reuse)
  2. filename + running page headers/footers + first heading lines, scored
     against default aliases and aliases learned for this employer
  3. Claude, given a compact outline (filename, running headers, the first
     lines of every page, first pages in full) to confirm or correct the
     heuristic map and to split combined PDFs into sections.

The cover page / table of contents usually lists *every* section, so pages
that look like a TOC are excluded from voting.
"""

from __future__ import annotations

import re
from typing import Callable

from .docreader import Document
from .llm import LLM, LLMUnavailable, strict_schema
from .roles import ROLES, role_label, score_text

TOC_RE = re.compile(r"(table\s+of\s+contents|^\s*contents\s*$|^\s*index\s*$)", re.I | re.M)


def _page_head(text: str, n_top: int = 3, n_bottom: int = 2) -> str:
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    return "\n".join(lines[:n_top] + lines[-n_bottom:])


def _is_toc(text: str) -> bool:
    if TOC_RE.search(text or ""):
        return True
    roles = {r for r, s in score_text(text).items() if s > 0}
    return len(roles) >= 5


def _best(scores: dict[str, float]) -> tuple[str, float]:
    if not scores:
        return "other", 0.0
    role = max(scores, key=lambda r: scores[r])
    return role, scores[role]


def heuristic_segments(doc: Document, aliases: dict[str, list[str]] | None = None) -> list[dict]:
    """Split ``doc`` into contiguous role segments using text signals only."""
    # Document-level prior: filename + running headers.
    prior = score_text(re.sub(r"[_\-.]+", " ", doc.name), aliases)
    for line, hits in doc.running_headers():
        for role, s in score_text(line, aliases).items():
            prior[role] = prior.get(role, 0) + s * 2 + hits / max(1, doc.page_count)
    default_role, default_score = _best(prior)

    # Per-page signal: only lines that repeat as page headers/footers on >=3
    # pages (body text often mentions other sections, e.g. "as per BDS").
    header_lines = {ln for ln, _n in doc.running_headers(min_hits=3, limit=200)}
    page_roles: list[tuple[str, float]] = []
    for p in doc.pages:
        if _is_toc(p.text):
            page_roles.append(("_toc", 0.0))
            continue
        edge = [ln for ln in doc.page_edge_lines(p) if ln in header_lines]
        if not edge:  # section title pages: first non-empty lines carry a big heading
            first = [ln.strip() for ln in p.text.splitlines() if ln.strip()][:2]
            edge = [ln for ln in first if re.match(r"^(section|part|volume|vol\.?|chapter)\b", ln, re.I)]
        role, s = _best(score_text("\n".join(edge), aliases))
        page_roles.append((role, s) if s >= 1 else ("", 0.0))

    # Fill pages without an own signal. A run of unsigned pages that contains
    # a cover/TOC page starts the NEXT section; other runs continue the
    # previous one.
    n = len(page_roles)
    resolved: list[str] = [""] * n
    i = 0
    prev = default_role if default_score > 0 else "other"
    while i < n:
        role, _s = page_roles[i]
        if role and role != "_toc":
            resolved[i] = prev = role
            i += 1
            continue
        j = i
        has_toc = False
        while j < n and not (page_roles[j][0] and page_roles[j][0] != "_toc"):
            has_toc = has_toc or page_roles[j][0] == "_toc"
            j += 1
        nxt = page_roles[j][0] if j < n else prev
        fill = nxt if (has_toc or i == 0) else prev
        for k in range(i, j):
            resolved[k] = fill
        i = j

    # If one role dominates, treat the file as a single volume (cover/TOC included).
    counts: dict[str, int] = {}
    for r in resolved:
        counts[r] = counts.get(r, 0) + 1
    top_role = max(counts, key=lambda r: counts[r]) if counts else "other"
    if default_score > 0 and counts.get(default_role, 0) >= 0.6 * max(1, len(resolved)):
        return [_seg(default_role, 1, max(1, doc.page_count), "heuristic", min(0.9, 0.5 + default_score / 10))]
    if counts.get(top_role, 0) >= 0.85 * max(1, len(resolved)):
        return [_seg(top_role, 1, max(1, doc.page_count), "heuristic", 0.6)]

    segments: list[dict] = []
    for i, r in enumerate(resolved, start=1):
        if segments and segments[-1]["role"] == r:
            segments[-1]["end_page"] = i
        else:
            segments.append(_seg(r, i, i, "heuristic", 0.5))
    return _merge_small(segments)


def _seg(role: str, start: int, end: int, source: str, confidence: float, title: str = "") -> dict:
    return {
        "role": role if role in ROLES else "other",
        "label": role_label(role),
        "start_page": int(start),
        "end_page": int(end),
        "title": title,
        "source": source,
        "confidence": round(float(confidence), 2),
    }


def _merge_small(segments: list[dict]) -> list[dict]:
    """Absorb 1-page 'other' fragments into the previous segment."""
    out: list[dict] = []
    for s in segments:
        if out and s["role"] == "other" and s["end_page"] - s["start_page"] < 1:
            out[-1]["end_page"] = s["end_page"]
        elif out and out[-1]["role"] == s["role"]:
            out[-1]["end_page"] = s["end_page"]
        else:
            out.append(dict(s))
    return out


def _outline(doc: Document, max_chars: int = 120_000) -> str:
    head = [f"FILE: {doc.name}", f"PAGES: {doc.page_count}"]
    rh = doc.running_headers()
    if rh:
        head.append("RUNNING HEADERS/FOOTERS: " + " || ".join(f"{l} (x{n})" for l, n in rh))
    head.append("\nFIRST PAGES (full text):")
    head.append(doc.text_range(1, min(3, doc.page_count), max_chars=9000))
    head.append("\nPAGE-BY-PAGE FIRST LINES:")
    per_page = []
    for p in doc.pages:
        lines = [ln.strip() for ln in p.text.splitlines() if ln.strip()][:3]
        per_page.append(f"[{p.number}] " + " / ".join(l[:110] for l in lines))
    body = "\n".join(per_page)
    out = "\n".join(head) + "\n" + body
    return out[:max_chars]


SEGMENT_SCHEMA = strict_schema(
    {
        "employer": {"type": "string"},
        "tender_reference": {"type": "string"},
        "tender_title": {"type": "string"},
        "segments": {
            "type": "array",
            "items": strict_schema(
                {
                    "role": {"type": "string", "enum": list(ROLES.keys())},
                    "start_page": {"type": "integer"},
                    "end_page": {"type": "integer"},
                    "title": {"type": "string"},
                    "employer_term": {"type": "string"},
                    "confidence": {"type": "number"},
                }
            ),
        },
    }
)

SEGMENT_SYSTEM = (
    "You index public-procurement tender documents (works, goods, services; Indian government, PSU, "
    "metro rail, World Bank/ADB/JICA/KfW funded). Employers use different names for the same thing, "
    "e.g. 'Section IV Bidding Forms', 'Volume II Forms & Formats', 'Annexures', 'Technical Bid Formats'. "
    "Map page ranges of the given file to roles. Roles:\n"
    + "\n".join(f"- {k}: {v['label']}" for k, v in ROLES.items())
    + "\nRules: cover pages and tables of contents list every section of the whole tender - do not use them "
    "to infer what THIS file contains; use running headers and actual section headings. Segments must be "
    "contiguous, non-overlapping and cover pages 1..N. Put the cover/TOC into the first real segment. "
    "employer_term = the exact heading the employer uses for that segment (e.g. 'Section III: Qualification "
    "and Evaluation Criteria'). confidence is 0..1. Return employer name, tender/IFB reference number and "
    "tender title if visible, else empty strings."
)


def llm_segments(doc: Document, llm: LLM, heuristic: list[dict], aliases: dict[str, list[str]]) -> dict:
    hint = "; ".join(f"{s['role']} p{s['start_page']}-{s['end_page']}" for s in heuristic)
    learned = "; ".join(f"{r}: {', '.join(a)}" for r, a in (aliases or {}).items() if a)
    text = _outline(doc) + f"\n\nKEYWORD-BASED GUESS (may be wrong): {hint}"
    if learned:
        text += f"\nTERMS THIS EMPLOYER USED BEFORE: {learned}"
    data = llm.json_call(SEGMENT_SYSTEM, text, SEGMENT_SCHEMA, effort="low", max_tokens=8000)
    segs = []
    for s in sorted(data.get("segments", []), key=lambda x: x.get("start_page", 0)):
        start = max(1, min(int(s["start_page"]), doc.page_count or 1))
        end = max(start, min(int(s["end_page"]), doc.page_count or 1))
        seg = _seg(s["role"], start, end, "ai", s.get("confidence", 0.8), s.get("title", ""))
        seg["employer_term"] = s.get("employer_term", "")
        segs.append(seg)
    if not segs:
        segs = heuristic
    return {
        "segments": segs,
        "employer": data.get("employer", ""),
        "tender_reference": data.get("tender_reference", ""),
        "tender_title": data.get("tender_title", ""),
    }


def classify_document(
    doc: Document,
    llm: LLM | None,
    aliases: dict[str, list[str]] | None = None,
    log: Callable[[str], None] = lambda _m: None,
) -> dict:
    heur = heuristic_segments(doc, aliases)
    result = {"segments": heur, "employer": "", "tender_reference": "", "tender_title": ""}
    if llm is not None and llm.available and doc.pages:
        try:
            result = llm_segments(doc, llm, heur, aliases or {})
        except LLMUnavailable:
            pass
        except Exception as e:  # keep heuristic result
            log(f"AI indexing failed for {doc.name}: {e}; using keyword map.")
    return result
