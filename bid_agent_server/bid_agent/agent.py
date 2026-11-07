"""Bid-preparation pipeline for one tender on the BidManager server.

    tender files -> classify (section map) -> criteria  } in parallel
                                           -> forms     }   -> compliance

Files are read and classified in parallel. ``parts`` picks what to read after the
section map: a request for forms doesn't wait for the criteria, and the other way
round. A later request for a missing part reads only that part (``merge_results``).

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
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from . import compliance, generate
from .classify import classify_document
from .criteria import (criteria_pages, extract_criteria, form_codes_in, llm_criteria_pages, page_criteria_score,
                       referenced_form_codes)
from .docreader import Document, display_name, ensure_tables, list_tender_files, load_document
from .forms import extract_forms, missing_forms
from .llm import LLM
from .roles import PRIMARY_ROLES, role_label
from .store import Store, employer_from_org_chain, org_key_for

# Bump when extraction changes enough that stored results should be redone.
PIPELINE_VERSION = 2

# What the tender reading can produce after the section map.
PARTS = ("criteria", "forms")
MAX_FILE_WORKERS = 4

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
    parts: tuple[str, ...] | list[str] = PARTS,
) -> dict:
    """``tender`` = server tender row (id, tender_id, title, org_chain ...).
    ``parts``: which of "criteria" / "forms" to read; the section map is always made."""
    parts = tuple(p for p in PARTS if p in set(parts or ()))
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
    def read_one(path: str) -> tuple[str, Document, dict]:
        """Loads and classifies one file (files are independent: run in parallel)."""
        doc = load_document(path, with_tables=False)
        rel = display_name(path, src_dir)
        entry = {"file": rel, "pages": doc.page_count, "error": doc.error, "needs_ocr": doc.needs_ocr, "segments": []}
        if doc.error or not doc.pages:
            return rel, doc, entry
        if rel in overrides:
            entry["segments"], entry["segments_source"] = overrides[rel], "manual"
            return rel, doc, entry
        cached = store.get_doc_cache("seg:" + doc.sha1)
        if cached and cached.get("segments"):
            info, entry["segments_source"] = cached, "cache"
        else:
            info = classify_document(doc, llm, org.get("aliases"), log)
            entry["segments_source"] = "ai" if any(s["source"] == "ai" for s in info["segments"]) else "heuristic"
            if entry["segments_source"] == "ai":
                store.put_doc_cache("seg:" + doc.sha1, doc.name, info)
        entry["segments"] = info["segments"]
        entry["_info"] = info
        return rel, doc, entry

    workers = max(1, min(MAX_FILE_WORKERS, len(files)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        read = list(pool.map(read_one, files))  # keeps the files' order
    for rel, doc, entry in read:
        info = entry.pop("_info", None)
        if doc.error or not doc.pages:
            documents.append(entry)
            log(f"  ! {rel}: {doc.error or 'no readable text'}")
            continue
        docs[rel] = doc
        for k_src, k_dst in (("employer", "employer"), ("tender_reference", "reference"), ("tender_title", "title")):
            if info and info.get(k_src) and not meta.get(k_dst):
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

    # Criteria and forms don't depend on each other: read the ones asked for, at the same time.
    use_ai = llm is not None and llm.available
    # Without a key, rules pick the criteria pages; with one, Claude picks them (in read_criteria).
    crit_src = (criteria_pages(list(docs.values()), segments_of("qualification_criteria"))
                or segments_of("bds", "nit")) if "criteria" in parts and not use_ai else []
    form_src: list[tuple[Document, int, int]] = []
    if "forms" in parts:
        form_src = segments_of("bidding_forms")
        if not form_src:
            log("No bidding-forms section identified; looking for annexures in the other documents.")
            form_src = segments_of("nit", "itb", "bds", "other")
    # Tables first, in this thread (both parts can use the same file).
    for doc, s, e in crit_src + form_src:
        ensure_tables(doc, s, e)

    def locate_criteria() -> list[tuple[Document, int, int]]:
        """Claude reads an outline of every page and says where the criteria are."""
        rule_pages = criteria_pages(list(docs.values()), segments_of("qualification_criteria")) or segments_of("bds", "nit")
        key = "critloc:" + ",".join(sorted(d.sha1 for d in docs.values()))
        cached = store.get_doc_cache(key)
        if cached and cached.get("ranges"):
            found = [(docs[r["file"]], r["start_page"], r["end_page"]) for r in cached["ranges"] if r["file"] in docs]
            if found:
                return found
        try:
            found = llm_criteria_pages(list(docs.values()), segments_of("qualification_criteria"), llm, log)
        except Exception as e:
            log(f"Claude couldn't locate the criteria ({str(e)[:200]}); using the section map.")
            return rule_pages
        if not found:
            return rule_pages
        store.put_doc_cache(key, "criteria pages", {"ranges": [
            {"file": _rel_of(d, documents, docs), "start_page": a, "end_page": b} for d, a, b in found]})
        return found

    def read_criteria() -> dict:
        if use_ai:
            crit_src[:] = locate_criteria()
            for doc, s, e in crit_src:
                ensure_tables(doc, s, e)  # for the basic reader, should Claude fail
        log(f"Reading qualification criteria from {len(crit_src)} section(s)…")
        crit_key = "crit:" + ",".join(f"{d.sha1}:{s}-{e}" for d, s, e in crit_src)
        cached_crit = store.get_doc_cache(crit_key) if crit_src else None
        if cached_crit and cached_crit.get("source") == "ai":
            log("  (reusing criteria read earlier for these pages)")
            return cached_crit
        crit = extract_criteria(crit_src, llm, log)
        if crit.get("source") == "ai":
            store.put_doc_cache(crit_key, "criteria", crit)
        log(f"  {len(crit.get('criteria', []))} criteria")
        return crit

    def read_forms() -> list[dict]:
        # Form codes the criteria pages cite help find the forms; taken from the page text
        # so the forms needn't wait for the criteria to be read.
        hints = list(dict.fromkeys(
            c for d, s, e in criteria_pages(list(docs.values()), segments_of("qualification_criteria"))
            for c in form_codes_in(d.text_range(s, e, max_chars=200000))))
        return extract_forms(form_src, llm, store, org_key, hints, log)

    jobs = {"criteria": read_criteria, "forms": read_forms}
    wanted = [p for p in parts if p in jobs]
    if len(wanted) > 1:
        with ThreadPoolExecutor(max_workers=len(wanted)) as pool:
            futures = {p: pool.submit(jobs[p]) for p in wanted}
            done = {p: f.result() for p, f in futures.items()}
    else:
        done = {p: jobs[p]() for p in wanted}
    criteria = done.get("criteria", {})
    forms = done.get("forms", [])
    expected = referenced_form_codes(criteria) if "criteria" in parts else []
    missing = missing_forms(expected, forms) if len(wanted) == len(PARTS) else []
    if expected:
        log(f"  Forms referenced in the criteria: {', '.join(expected)}")
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
        "pipeline_version": PIPELINE_VERSION,
        "parts": list(parts),
        "criteria_pages": [{"file": _rel_of(d, documents, docs), "start_page": s, "end_page": e} for d, s, e in crit_src],
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
    log(f"Done in {result['elapsed_sec']} s: " + ", ".join(
        [f"{len(forms)} form(s)"] * ("forms" in parts) + [f"{len(criteria.get('criteria', []))} criteria"] * ("criteria" in parts))
        if parts else f"Done in {result['elapsed_sec']} s: section map only.")
    return result


def parts_of(result: dict | None) -> set[str]:
    """Parts a stored result already has (results made before parts existed have both)."""
    if not result:
        return set()
    return set(result.get("parts", PARTS))


def merge_results(prev: dict | None, new: dict) -> dict:
    """``new`` (read for the missing parts) on top of ``prev``: keeps the parts read before."""
    if not prev:
        return new
    have = parts_of(prev)
    merged = dict(new)
    if "criteria" in have and "criteria" not in parts_of(new):
        for k in ("criteria", "criteria_pages", "compliance"):
            merged[k] = prev.get(k, merged.get(k))
    if "forms" in have and "forms" not in parts_of(new):
        merged["forms"] = prev.get("forms", [])
    merged["parts"] = [p for p in PARTS if p in have | parts_of(new)]
    if set(merged["parts"]) == set(PARTS):
        merged["expected_forms"] = referenced_form_codes(merged.get("criteria") or {})
        merged["missing_forms"] = missing_forms(merged["expected_forms"], merged.get("forms") or [])
    return merged


def _rel_of(doc: Document, documents: list[dict], docs: dict) -> str:
    for rel, d in docs.items():
        if d is doc:
            return rel
    return doc.name


def _pick_doc(src_dir: str, file_hint: str, start: int, end: int) -> tuple[str, Document]:
    """The tender file a user means: by (part of) its name, else the one whose pages
    [start, end] read most like criteria."""
    paths = list_tender_files(src_dir)
    hint = re.sub(r"[^a-z0-9]+", " ", (file_hint or "").lower()).strip()
    named = [p for p in paths if hint and hint in re.sub(r"[^a-z0-9]+", " ", display_name(p, src_dir).lower())]
    best = None
    for p in named or paths:
        doc = load_document(p, with_tables=False)
        if not doc.pages or doc.page_count < start:
            continue
        score = sum(page_criteria_score(pg.text) for pg in doc.pages[start - 1:end])
        if best is None or score > best[0]:
            best = (score, display_name(p, src_dir), doc)
    if best is None:
        raise RuntimeError(f"No tender file has page {start}." if not hint else f"No tender file named like “{file_hint}”.")
    return best[1], best[2]


def criteria_from_pages(src_dir: str, file_hint: str, start: int, end: int, store: Store,
                        llm: LLM | None, log: Callable[[str], None] = print) -> tuple[str, dict]:
    """Re-reads the qualification criteria from the pages the user named."""
    start, end = max(1, int(start)), max(int(start), int(end))
    name, doc = _pick_doc(src_dir, file_hint, start, end)
    end = min(end, doc.page_count)
    ensure_tables(doc, start, end)
    key = f"crit:{doc.sha1}:{start}-{end}"
    cached = store.get_doc_cache(key)
    if cached and cached.get("source") == "ai":
        return name, cached
    crit = extract_criteria([(doc, start, end)], llm, log)
    if crit.get("source") == "ai":
        store.put_doc_cache(key, "criteria", crit)
    return name, crit


def read_pages(src_dir: str, file_hint: str, start: int, end: int, max_chars: int = 60000) -> tuple[str, str, bool]:
    """Text of pages [start, end] of a tender file -> (file, text, scanned)."""
    name, doc = _pick_doc(src_dir, file_hint, start, end)
    end = min(max(start, end), doc.page_count, start + 29)
    text = doc.text_range(start, end, max_chars=max_chars)
    scanned = sum(len(p.text.strip()) for p in doc.pages[start - 1:end]) < 100 * (end - start + 1)
    return name, text, scanned


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


# ---------------------------------------------------------------- chat grounding
MAX_GROUNDING_PAGES = 30


def grounding_key(tender_id, result: dict) -> str:
    pages = [(c.get("file"), c.get("start_page"), c.get("end_page")) for c in result.get("criteria_pages", [])]
    return f"ground:{tender_id}:{pages}"


def grounding_blocks(src_dir: str, result: dict, client=None) -> list[dict]:
    """Content blocks with the tender's key pages (the criteria pages) for the chat model.

    PDF ranges are uploaded once to the Files API when ``client`` is given (blocks then
    reference the file id, so later turns don't resend the pages); otherwise they're sent
    inline. DOCX/XLSX ranges go as text. Returns [] when nothing fits."""
    import io

    blocks: list[dict] = []
    used = 0
    paths = {display_name(p, src_dir): p for p in list_tender_files(src_dir)}
    for c in result.get("criteria_pages", []):
        path = paths.get(c.get("file"))
        if not path:
            continue
        s, e = int(c["start_page"]), int(c["end_page"])
        e = min(e, s + (MAX_GROUNDING_PAGES - used) - 1)
        if e < s:
            break
        used += e - s + 1
        title = f"{c.get('file')} (pages {s}-{e})"
        if path.lower().endswith(".pdf"):
            from pypdf import PdfReader, PdfWriter

            reader = PdfReader(path)
            writer = PdfWriter()
            for i in range(s - 1, min(e, len(reader.pages))):
                writer.add_page(reader.pages[i])
            buf = io.BytesIO()
            writer.write(buf)
            data = buf.getvalue()
            source = None
            if client is not None:
                try:
                    meta = client.files.upload(file=(f"tender-pages-{s}-{e}.pdf", data, "application/pdf"))
                    source = {"type": "file", "file_id": meta.id}
                except Exception:
                    source = None
            if source is None:
                import base64

                source = {"type": "base64", "media_type": "application/pdf", "data": base64.b64encode(data).decode()}
            blocks.append({"type": "document", "source": source, "title": title})
        else:
            doc = load_document(path, with_tables=False)
            blocks.append({"type": "document", "title": title,
                           "source": {"type": "text", "media_type": "text/plain",
                                      "data": doc.text_range(s, min(e, doc.page_count), max_chars=150000) or "(empty)"}})
        if used >= MAX_GROUNDING_PAGES:
            break
    return blocks
