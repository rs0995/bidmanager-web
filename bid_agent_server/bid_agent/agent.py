"""Bid-preparation pipeline for one tender on the BidManager server.

    tender files -> classify (section map) -> criteria -> forms -> compliance

The result is plain JSON stored in ``bid_analyses``. Word/Excel files are built
from it on demand (``build_outputs``), so nothing has to live on the server's
disk and re-filling after a company-profile change costs no AI calls.
"""

from __future__ import annotations

import os
import re
import time
import zipfile
from collections import Counter
from typing import Callable

from . import compliance, generate
from .classify import classify_document
from .criteria import extract_criteria, referenced_form_codes
from .docreader import Document, display_name, ensure_tables, list_tender_files, load_document
from .forms import extract_forms, missing_forms
from .llm import LLM
from .roles import PRIMARY_ROLES, role_label
from .store import Store, employer_from_org_chain, org_key_for

REF_RE = re.compile(
    r"\b(?:IFB|NIT|ICB|NCB|RFP|Bid|Tender|E-?Tender)\s*(?:No|Number|Ref)\.?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9/\-_.()]{5,60})",
    re.I,
)


def analyze_files(
    src_dir: str,
    tender: dict,
    store: Store,
    llm: LLM | None,
    profile: dict,
    log: Callable[[str], None] = print,
    overrides: dict | None = None,
) -> dict:
    """``tender`` = server tender row (id, tender_id, title, org_chain ...)."""
    t0 = time.time()
    overrides = overrides or {}
    skipped: list[dict] = []
    files = list_tender_files(src_dir, skipped)
    for item in skipped:
        log(f"  ! {item['file']}: {item['issue']}")
    if not files:
        if skipped:
            raise RuntimeError("None of this tender's files could be read: " + "; ".join(
                f"{i['file']}: {i['issue']}" for i in skipped[:3]))
        raise RuntimeError("This tender has no downloaded documents yet. Download the documents first.")
    log(f"Reading {len(files)} file(s)…")

    employer = employer_from_org_chain(str(tender.get("org_chain") or ""))
    org_key = org_key_for(employer) if employer else ""
    org = store.get_org(org_key) if org_key else {"aliases": {}, "form_codes": []}

    docs: dict[str, Document] = {}
    documents: list[dict] = []
    meta = {"employer": employer, "reference": str(tender.get("tender_id") or ""), "title": str(tender.get("title") or "")}
    for path in files:
        doc = load_document(path, with_tables=False)
        rel = display_name(path, src_dir)
        entry = {"file": rel, "pages": doc.page_count, "error": doc.error, "needs_ocr": doc.needs_ocr, "segments": []}
        if doc.error or not doc.pages:
            documents.append(entry)
            log(f"  ! {rel}: {doc.error or 'no readable text'}")
            continue
        docs[rel] = doc
        if rel in overrides:
            entry["segments"], entry["segments_source"] = overrides[rel], "manual"
        else:
            cached = store.get_doc_cache("seg:" + doc.sha1)
            if cached and cached.get("segments"):
                info, entry["segments_source"] = cached, "cache"
            else:
                info = classify_document(doc, llm, org.get("aliases"), log)
                entry["segments_source"] = "ai" if any(s["source"] == "ai" for s in info["segments"]) else "heuristic"
                if entry["segments_source"] == "ai":
                    store.put_doc_cache("seg:" + doc.sha1, doc.name, info)
            entry["segments"] = info["segments"]
            for k_src, k_dst in (("employer", "employer"), ("tender_reference", "reference"), ("tender_title", "title")):
                if info.get(k_src) and not meta.get(k_dst):
                    meta[k_dst] = info[k_src]
        documents.append(entry)
        log(f"  {rel}: " + ", ".join(f"{role_label(s['role'])} p{s['start_page']}-{s['end_page']}" for s in entry["segments"]))

    for item in skipped:  # shown in the document list with the reason
        documents.append({"file": item["file"], "pages": 0, "error": item["issue"], "needs_ocr": False,
                          "segments": [], "segments_source": "skipped"})

    if not meta.get("reference"):
        meta["reference"] = _find_reference(list(docs.values()))
    if not org_key:
        employer = meta.get("employer") or "Unknown employer"
        org_key = org_key_for(employer)
        org = store.get_org(org_key)

    def segments_of(*roles: str) -> list[tuple[Document, int, int]]:
        return [(docs[d["file"]], int(s["start_page"]), int(s["end_page"]))
                for d in documents for s in d.get("segments", []) if s["role"] in roles and d["file"] in docs]

    # criteria
    crit_src = segments_of("qualification_criteria") or segments_of("bds", "nit")
    for doc, s, e in crit_src:
        ensure_tables(doc, s, e)
    log(f"Reading qualification criteria from {len(crit_src)} section(s)…")
    crit_key = "crit:" + ",".join(f"{d.sha1}:{s}-{e}" for d, s, e in crit_src)
    cached_crit = store.get_doc_cache(crit_key) if crit_src else None
    if cached_crit and cached_crit.get("source") == "ai":
        criteria = cached_crit
        log("  (reusing criteria read earlier for these pages)")
    else:
        criteria = extract_criteria(crit_src, llm, log)
        if criteria.get("source") == "ai":
            store.put_doc_cache(crit_key, "criteria", criteria)
    expected = referenced_form_codes(criteria)
    log(f"  {len(criteria.get('criteria', []))} criteria; forms referenced: {', '.join(expected) or 'none'}")

    # forms
    form_src = segments_of("bidding_forms")
    if not form_src:
        log("No bidding-forms section identified; looking for annexures in the other documents.")
        form_src = segments_of("nit", "itb", "bds", "other")
    for doc, s, e in form_src:
        ensure_tables(doc, s, e)
    forms = extract_forms(form_src, llm, store, org_key, expected, log)
    missing = missing_forms(expected, forms)
    if missing:
        log(f"  Forms referenced in the criteria but not found: {', '.join(missing)}")

    result = {
        "tender_id": tender.get("id"),
        "org_key": org_key,
        "org_name": org.get("org_name") or employer,
        "tender": meta,
        "documents": documents,
        "key_sections": _key_sections(documents),
        "criteria": criteria,
        "forms": forms,
        "expected_forms": expected,
        "missing_forms": missing,
        "compliance": compliance.check(criteria, profile),
        "overrides": overrides,
        "llm": {"model": llm.model if llm else "", "used": bool(llm and llm.available), "usage": llm.usage if llm else {}},
        "elapsed_sec": round(time.time() - t0, 1),
    }

    # learn employer nomenclature + form codes
    org["org_key"] = org_key
    org["org_name"] = org.get("org_name") or employer
    org["form_codes"] = sorted(set(org.get("form_codes", [])) | {f.get("code", "") for f in forms if f.get("code")})
    ref = str(tender.get("tender_id") or tender.get("id") or "")
    if ref and ref not in org.setdefault("tender_ids", []):
        org["tender_ids"].append(ref)
    for d in documents:
        for s in d.get("segments", []):
            term = (s.get("employer_term") or "").strip()
            if term and s["role"] != "other" and s.get("source") in ("ai", "manual"):
                lst = org.setdefault("aliases", {}).setdefault(s["role"], [])
                if term.lower() not in [a.lower() for a in lst]:
                    lst.append(term[:120])
    store.save_org(org)
    log(f"Done in {result['elapsed_sec']} s: {len(forms)} form(s), {len(criteria.get('criteria', []))} criteria.")
    return result


def refresh_compliance(result: dict, profile: dict) -> dict:
    result["compliance"] = compliance.check(result.get("criteria", {}), profile)
    return result


def _find_reference(docs: list[Document]) -> str:
    c: Counter[str] = Counter()
    for d in docs:
        for line, n in d.running_headers():
            for m in REF_RE.finditer(line):
                c[m.group(1).strip(" .")] += n
        for p in d.pages[:3]:
            for m in REF_RE.finditer(p.text):
                c[m.group(1).strip(" .")] += 1
    return c.most_common(1)[0][0] if c else ""


def _key_sections(documents: list[dict]) -> list[dict]:
    out = []
    for role in PRIMARY_ROLES:
        hits = [{"file": d["file"], "start_page": s["start_page"], "end_page": s["end_page"]}
                for d in documents for s in d.get("segments", []) if s["role"] == role]
        out.append({"role": role, "label": role_label(role), "found": bool(hits), "locations": hits})
    return out


# ---------------------------------------------------------------- outputs
def output_names(result: dict) -> list[dict]:
    """Stable list of downloadable outputs: {name, kind, form_index}."""
    items = [{"name": "Bid Forms Workbook.xlsx", "kind": "workbook", "form_index": -1}]
    for i, f in enumerate(result.get("forms", []), start=1):
        items.append({"name": generate.safe_name(f"{i:02d} {f.get('code', '')} - {f.get('title', '')}") + ".docx",
                      "kind": "form", "form_index": i - 1, "code": f.get("code", ""), "title": f.get("title", "")})
    items.append({"name": "Bid Forms.zip", "kind": "zip", "form_index": -1})
    return items


def build_output(result: dict, profile: dict, name: str, out_dir: str) -> str:
    """Write one output (or the zip of all) into ``out_dir`` and return its path."""
    items = {i["name"]: i for i in output_names(result)}
    item = items.get(name)
    if not item:
        raise FileNotFoundError(name)
    tender = result.get("tender", {})
    path = os.path.join(out_dir, name)
    if item["kind"] == "form":
        generate.write_docx(result["forms"][item["form_index"]], path, profile, tender)
    elif item["kind"] == "workbook":
        names = {f.get("code", ""): i["name"] for i, f in zip(
            [x for x in output_names(result) if x["kind"] == "form"], result.get("forms", []))}
        generate.write_workbook(path, result.get("forms", []), result.get("criteria", {}),
                                result.get("compliance", []), profile, tender, names)
    else:
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            for other in output_names(result):
                if other["kind"] == "zip":
                    continue
                p = build_output(result, profile, other["name"], out_dir)
                z.write(p, other["name"])
    return path
