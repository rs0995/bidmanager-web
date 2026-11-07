"""Read tender files into page-wise text (and tables where possible).

Supported: PDF (pdfplumber), DOCX (python-docx), XLSX (openpyxl), TXT/HTML.
Scanned PDFs (no text layer) are flagged with ``needs_ocr`` so the caller can
fall back to sending page images/PDF to the LLM.
"""

from __future__ import annotations

import hashlib
import os
import threading
import re
from collections import Counter
from dataclasses import dataclass, field

SUPPORTED_EXTS = {".pdf", ".docx", ".xlsx", ".xlsm", ".txt", ".htm", ".html"}


@dataclass
class Page:
    number: int  # 1-based
    text: str
    tables: list[list[list[str]]] = field(default_factory=list)


@dataclass
class Document:
    path: str
    name: str
    ext: str
    sha1: str
    pages: list[Page]
    needs_ocr: bool = False
    error: str = ""

    @property
    def page_count(self) -> int:
        return len(self.pages)

    def text_range(self, start: int, end: int, max_chars: int | None = None) -> str:
        """Text of pages [start, end] (1-based, inclusive) with page markers."""
        parts = []
        for p in self.pages[max(0, start - 1): end]:
            parts.append(f"\n<<page {p.number}>>\n{p.text}")
        out = "".join(parts)
        if max_chars and len(out) > max_chars:
            out = out[:max_chars]
        return out

    def running_headers(self, top_lines: int = 2, bottom_lines: int = 2, min_hits: int | None = None,
                        limit: int = 12) -> list[tuple[str, int]]:
        """Lines repeated at the top/bottom of many pages (page headers/footers).

        For split tender volumes these usually name the section, e.g.
        ``Section III: Qualification and Evaluation Criteria``.
        """
        counter: Counter[str] = Counter()
        for p in self.pages:
            lines = [ln.strip() for ln in p.text.splitlines() if ln.strip()]
            for ln in lines[:top_lines] + lines[-bottom_lines:]:
                norm = normalize_header(ln)
                if len(norm) >= 6:
                    counter[norm] += 1
        if min_hits is None:
            min_hits = max(2, int(len(self.pages) * 0.25))
        return [(ln, n) for ln, n in counter.most_common(limit) if n >= min_hits]

    def page_edge_lines(self, page: "Page", top_lines: int = 2, bottom_lines: int = 2) -> list[str]:
        lines = [ln.strip() for ln in page.text.splitlines() if ln.strip()]
        return [normalize_header(ln) for ln in lines[:top_lines] + lines[-bottom_lines:]]


def normalize_header(line: str) -> str:
    s = re.sub(r"\bpage\s*\d+\s*(of\s*\d+)?", "", line, flags=re.I)
    s = re.sub(r"\s+\d{1,4}\s*$", "", s)  # trailing page numbers
    s = re.sub(r"^\s*\d{1,4}\s+", "", s)
    return re.sub(r"\s+", " ", s).strip(" -|–")


def file_sha1(path: str) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _clean_table(tbl) -> list[list[str]]:
    rows = []
    for row in tbl or []:
        cells = [re.sub(r"\s+", " ", str(c or "")).strip() for c in row]
        if any(cells):
            rows.append(cells)
    return rows


def read_pdf(path: str, with_tables: bool = True, max_pages: int | None = None) -> list[Page]:
    import pdfplumber

    pages: list[Page] = []
    with pdfplumber.open(path) as pdf:
        for i, pg in enumerate(pdf.pages):
            if max_pages and i >= max_pages:
                break
            try:
                text = pg.extract_text() or ""
            except Exception:
                text = ""
            tables: list[list[list[str]]] = []
            if with_tables:
                try:
                    tables = [t for t in (_clean_table(x) for x in pg.extract_tables()) if t]
                except Exception:
                    tables = []
            pages.append(Page(number=i + 1, text=text, tables=tables))
    return pages


def read_docx(path: str) -> list[Page]:
    """DOCX has no fixed pages; we emit one 'page' per ~3000 chars, keeping
    tables in reading order."""
    import docx  # python-docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    d = docx.Document(path)
    pages: list[Page] = []
    buf: list[str] = []
    tables: list[list[list[str]]] = []
    size = 0

    def flush():
        nonlocal buf, tables, size
        if buf or tables:
            pages.append(Page(number=len(pages) + 1, text="\n".join(buf), tables=tables))
        buf, tables, size = [], [], 0

    body = d.element.body
    for child in body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            para = Paragraph(child, d)
            txt = para.text.strip()
            is_break = 'w:br w:type="page"' in child.xml or "lastRenderedPageBreak" in child.xml
            if txt:
                buf.append(txt)
                size += len(txt)
            if is_break and size > 200:
                flush()
        elif tag == "tbl":
            tbl = Table(child, d)
            rows = []
            for r in tbl.rows:
                try:
                    rows.append([c.text.strip() for c in r.cells])
                except Exception:
                    continue
            rows = _clean_table(rows)
            if rows:
                tables.append(rows)
                buf.append("\n".join(" | ".join(r) for r in rows))
                size += sum(len(" ".join(r)) for r in rows)
        if size > 3000:
            flush()
    flush()
    return pages


def read_xlsx(path: str) -> list[Page]:
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    pages = []
    for ws in wb.worksheets:
        rows = []
        for r in ws.iter_rows(values_only=True):
            cells = ["" if v is None else str(v) for v in r]
            if any(c.strip() for c in cells):
                rows.append(cells)
            if len(rows) > 2000:
                break
        text = f"Sheet: {ws.title}\n" + "\n".join(" | ".join(r) for r in rows)
        pages.append(Page(number=len(pages) + 1, text=text, tables=[_clean_table(rows)] if rows else []))
    return pages


def read_text(path: str) -> list[Page]:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        raw = f.read()
    if path.lower().endswith((".htm", ".html")):
        raw = re.sub(r"<[^>]+>", " ", raw)
    chunks = [raw[i:i + 4000] for i in range(0, len(raw), 4000)] or [""]
    return [Page(number=i + 1, text=c) for i, c in enumerate(chunks)]


def load_document(path: str, with_tables: bool = True, max_pages: int | None = None) -> Document:
    name = os.path.basename(path)
    ext = os.path.splitext(name)[1].lower()
    doc = Document(path=path, name=name, ext=ext, sha1="", pages=[])
    try:
        doc.sha1 = file_sha1(path)
        if ext == ".pdf":
            doc.pages = read_pdf(path, with_tables=with_tables, max_pages=max_pages)
        elif ext == ".docx":
            doc.pages = read_docx(path)
        elif ext in (".xlsx", ".xlsm"):
            doc.pages = read_xlsx(path)
        elif ext in (".txt", ".htm", ".html"):
            doc.pages = read_text(path)
        else:
            doc.error = f"Unsupported file type: {ext}"
    except Exception as e:  # corrupt/password-protected files
        doc.error = f"{type(e).__name__}: {e}"
    if doc.pages and ext == ".pdf":
        chars = sum(len(p.text.strip()) for p in doc.pages)
        doc.needs_ocr = chars < 40 * len(doc.pages)
    return doc


_TABLES_LOCK = threading.RLock()


def ensure_tables(doc: Document, start: int, end: int) -> None:
    """Extract tables for pages [start, end] of a PDF loaded without tables."""
    if doc.ext != ".pdf":
        return
    with _TABLES_LOCK:  # criteria and forms may ask for the same file's tables at once
        _ensure_tables(doc, start, end)


def _ensure_tables(doc: Document, start: int, end: int) -> None:
    need = [p for p in doc.pages[start - 1:end] if not getattr(p, "_tables_done", False)]
    if not need:
        return
    import pdfplumber

    with pdfplumber.open(doc.path) as pdf:
        for p in need:
            try:
                p.tables = [t for t in (_clean_table(x) for x in pdf.pages[p.number - 1].extract_tables()) if t]
            except Exception:
                p.tables = []
            p._tables_done = True  # type: ignore[attr-defined]


# Limits for archives from portals: generous for real tenders, but a broken or
# hostile ZIP can't fill the server's disk or loop forever.
MAX_ARCHIVE_DEPTH = 3
MAX_EXTRACT_BYTES = 1_500_000_000      # per tender, all archives together
MAX_ARCHIVE_MEMBERS = 3000
CONVERTIBLE_EXTS = {".doc", ".rtf", ".xls", ".odt", ".ods"}
ARCHIVE_EXTS = {".zip"}
UNSUPPORTED_ARCHIVES = {".rar", ".7z", ".tar", ".gz", ".tgz"}
SKIP_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tif", ".tiff", ".dwg", ".dxf", ".exe", ".db", ".ini", ".lnk"}


def _junk(name: str) -> bool:
    base = os.path.basename(name)
    return (
        base.startswith(("~$", "._", ".")) or base in ("Thumbs.db", "desktop.ini")
        or "__MACOSX" in name.replace("\\", "/").split("/")
    )


def _extract_zip(path: str, dest: str, budget: list[int], report: list[dict], rel: str) -> bool:
    """Extract a ZIP safely into ``dest``. ``budget`` holds the bytes still allowed."""
    import zipfile

    try:
        with zipfile.ZipFile(path) as z:
            infos = [i for i in z.infolist() if not i.is_dir() and not _junk(i.filename)]
            if len(infos) > MAX_ARCHIVE_MEMBERS:
                report.append({"file": rel, "issue": f"ZIP has {len(infos)} files; only the first {MAX_ARCHIVE_MEMBERS} were read."})
                infos = infos[:MAX_ARCHIVE_MEMBERS]
            root = os.path.realpath(dest)
            for info in infos:
                if info.flag_bits & 0x1:
                    report.append({"file": rel, "issue": "ZIP is password-protected; open it on the portal and upload the files."})
                    return False
                target = os.path.realpath(os.path.join(dest, info.filename))
                if not target.startswith(root + os.sep):
                    continue  # zip-slip guard
                if info.file_size > budget[0]:
                    report.append({"file": rel, "issue": "ZIP is too large to unpack on the server; some files were skipped."})
                    return True
                budget[0] -= info.file_size
                z.extract(info, dest)
        return True
    except zipfile.BadZipFile:
        report.append({"file": rel, "issue": "ZIP file is damaged or incomplete; download it again."})
    except NotImplementedError:
        report.append({"file": rel, "issue": "ZIP uses a compression method that can't be read; unpack it on a PC and upload the files."})
    except Exception as e:  # disk full, odd names ...
        report.append({"file": rel, "issue": f"Couldn't unpack ZIP: {e}"})
    return False


def convert_legacy(path: str) -> str | None:
    """Turn .doc/.xls/.rtf/.odt/.ods into something readable. Returns the new path or None."""
    ext = os.path.splitext(path)[1].lower()
    base = os.path.splitext(path)[0]
    try:
        if ext == ".xls":
            import xlrd  # pure Python, reads the old Excel format
            import openpyxl

            book = xlrd.open_workbook(path)
            wb = openpyxl.Workbook()
            wb.remove(wb.active)
            for sh in book.sheets():
                ws = wb.create_sheet((sh.name or "Sheet")[:31])
                for r in range(min(sh.nrows, 5000)):
                    ws.append([sh.cell_value(r, c) for c in range(min(sh.ncols, 200))])
            out = path + ".converted.xlsx"
            wb.save(out)
            return out
        if ext == ".rtf":
            from striprtf.striprtf import rtf_to_text

            with open(path, encoding="latin-1", errors="ignore") as f:
                text = rtf_to_text(f.read())
            out = path + ".converted.txt"
            with open(out, "w", encoding="utf-8") as f:
                f.write(text)
            return out
    except ImportError:
        pass
    except Exception:
        return None
    # .doc / .odt / .ods (and the above without their libraries): LibreOffice if present.
    import shutil
    import subprocess

    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return None
    target = "xlsx" if ext in (".xls", ".ods") else "docx"
    outdir = os.path.dirname(path)
    try:
        subprocess.run([soffice, "--headless", "--convert-to", target, "--outdir", outdir, path],
                       check=True, timeout=120, capture_output=True)
    except Exception:
        return None
    produced = base + "." + target
    if not os.path.isfile(produced):
        return None
    out = path + ".converted." + target
    os.replace(produced, out)
    return out


def display_name(path: str, top: str) -> str:
    """'2026_X_unzipped/Vol 1.pdf' -> '2026_X.zip › Vol 1.pdf'; 'BOQ.xls.converted.xlsx' -> 'BOQ.xls'."""
    rel = os.path.relpath(path, top).replace(os.sep, "/")
    rel = re.sub(r"\.converted\.\w+$", "", rel)
    return re.sub(r"_unzipped/", ".zip › ", rel)


def list_tender_files(folder: str, report: list[dict] | None = None) -> list[str]:
    """All readable files under ``folder``. ZIPs (also ZIPs inside ZIPs) are unpacked
    next to themselves into ``<name>_unzipped/``; old Office formats are converted
    where possible. Anything skipped is added to ``report`` as {file, issue}."""
    report = report if report is not None else []
    budget = [MAX_EXTRACT_BYTES]
    out: list[str] = []
    _walk(folder, folder, out, report, budget, depth=0)
    seen, uniq = set(), []
    for p in out:
        if p not in seen:
            seen.add(p)
            uniq.append(p)
    return uniq


def _walk(folder: str, top: str, out: list[str], report: list[dict], budget: list[int], depth: int) -> None:
    if not folder or not os.path.isdir(folder):
        return
    for root, dirs, files in os.walk(folder):
        dirs[:] = sorted(d for d in dirs if not _junk(d) and not d.endswith("_unzipped"))
        for fn in sorted(files):
            p = os.path.join(root, fn)
            rel = os.path.relpath(p, top).replace(os.sep, "/")
            ext = os.path.splitext(fn)[1].lower()
            if _junk(rel) or ".converted." in fn:
                continue
            if ext in ARCHIVE_EXTS:
                if depth >= MAX_ARCHIVE_DEPTH:
                    report.append({"file": rel, "issue": "ZIP nested too deeply; skipped."})
                    continue
                dest = os.path.splitext(p)[0] + "_unzipped"
                if os.path.isdir(dest) or _extract_zip(p, dest, budget, report, rel):
                    _walk(dest, top, out, report, budget, depth + 1)
            elif ext in SUPPORTED_EXTS:
                out.append(p)
            elif ext in CONVERTIBLE_EXTS:
                conv = convert_legacy(p)
                if conv:
                    out.append(conv)
                else:
                    report.append({"file": rel, "issue": f"Old {ext} format can't be read on the server; save it as "
                                                         f"{'.xlsx' if ext in ('.xls', '.ods') else '.docx or .pdf'} and upload it."})
            elif ext in UNSUPPORTED_ARCHIVES:
                report.append({"file": rel, "issue": f"{ext} archives can't be unpacked on the server; unpack it and upload the files."})
            elif ext not in SKIP_EXTS:
                report.append({"file": rel, "issue": f"{ext or 'This'} file type isn't read."})
