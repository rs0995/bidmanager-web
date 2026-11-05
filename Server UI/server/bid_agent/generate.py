"""Stage 4 – write editable bid forms (Word + Excel), pre-filled where possible.

Output folder (inside the project): ``Working Docs/Bid Forms/``
  <NN> <code> - <title>.docx        one Word file per form
  Bid Forms Workbook.xlsx           Index, Compliance, Criteria, Personnel,
                                    Equipment + one sheet per tabular form
Blank inputs are highlighted yellow; auto-filled values are green so the
team can review them.
"""

from __future__ import annotations

import os
import re
from typing import Any

from . import company

YELLOW = "FFF2CC"
GREEN = "E2EFDA"
HEADER = "D9E1F2"


def safe_name(text: str, limit: int = 80) -> str:
    s = re.sub(r'[<>:"/\\|?*\n\r\t]+', " ", text or "").strip(" .")
    return re.sub(r"\s+", " ", s)[:limit] or "Form"


def _field_value(field: dict, profile: dict, overrides: dict) -> str:
    if field.get("id") in overrides:
        return str(overrides[field["id"]])
    return company.lookup(profile, field.get("key", ""))


def _table_rows(block: dict, profile: dict) -> tuple[list[list[str]], int]:
    """Rows for a table block and how many of them were auto-filled."""
    cols = block.get("columns", [])
    rows = [list(r) + [""] * (len(cols) - len(r)) for r in block.get("prefilled_rows", [])]
    filled = 0
    section = block.get("binds_to", "")
    if section:
        data = company.rows_for(profile, section)
        if rows and section == "financials":
            # Pre-filled year rows: fill the matching cells by FY label.
            by_fy = {str(r.get("fy", "")).replace(" ", ""): r for r in data}
            for row in rows:
                rec = next((by_fy[k] for k in by_fy if k and k in "".join(row).replace(" ", "")), None)
                if rec:
                    for ci, col in enumerate(cols):
                        k = col.get("key", "")
                        if k.startswith("financials.") and not row[ci]:
                            row[ci] = str(rec.get(k.split(".", 1)[1], "") or "")
                    filled += 1
        elif not rows:
            for rec in data:
                row = []
                for col in cols:
                    k = col.get("key", "")
                    row.append(str(rec.get(k.split(".", 1)[1], "") or "") if k.startswith(section + ".") else "")
                if any(row):
                    rows.append(row)
                    filled += 1
    blanks = max(block.get("rows_hint", 0) or 0, 3 if not rows else 1)
    rows += [[""] * len(cols) for _ in range(blanks)]
    return rows, filled


# ----------------------------------------------------------------- Word
def write_docx(form: dict, path: str, profile: dict, tender: dict, overrides: dict | None = None) -> dict:
    from docx import Document
    from docx.enum.text import WD_COLOR_INDEX
    from docx.shared import Pt

    overrides = overrides or {}
    d = Document()
    style = d.styles["Normal"]
    style.font.name = "Arial"
    style.font.size = Pt(10)
    stats = {"fields": 0, "filled": 0}
    fields = {f["id"]: f for b in form.get("blocks", []) for f in b.get("fields", [])}

    meta_text = "  |  ".join(x for x in (tender.get("reference", ""), tender.get("employer", "")) if x)
    if meta_text:
        r = d.add_paragraph().add_run(meta_text)
        r.font.size = Pt(8)
        r.italic = True

    if form.get("instructions"):
        p = d.add_paragraph()
        r = p.add_run("Note: " + form["instructions"])
        r.italic = True
        r.font.size = Pt(8)

    def add_text_with_fields(par, text: str):
        pos = 0
        for m in re.finditer(r"\{\{\s*([\w\-]+)\s*\}\}", text):
            par.add_run(text[pos:m.start()])
            f = fields.get(m.group(1), {"id": m.group(1), "label": m.group(1), "key": ""})
            val = _field_value(f, profile, overrides)
            stats["fields"] += 1
            run = par.add_run(val if val else f"[{f.get('label') or f['id']}]")
            run.font.highlight_color = WD_COLOR_INDEX.BRIGHT_GREEN if val else WD_COLOR_INDEX.YELLOW
            if val:
                stats["filled"] += 1
            pos = m.end()
        par.add_run(text[pos:])

    title_done = False
    for b in form.get("blocks", []):
        t = b.get("type")
        if t == "heading":
            d.add_heading(b.get("text", ""), level=1 if not title_done else 2)
            title_done = True
        elif t == "paragraph":
            add_text_with_fields(d.add_paragraph(), b.get("text", ""))
        elif t == "fields":
            used_inline = set()
            for blk in form.get("blocks", []):
                if blk.get("type") == "paragraph":
                    used_inline.update(re.findall(r"\{\{\s*([\w\-]+)\s*\}\}", blk.get("text", "")))
            rest = [f for f in b.get("fields", []) if f["id"] not in used_inline]
            if not rest:
                continue
            tbl = d.add_table(rows=0, cols=2)
            tbl.style = "Table Grid"
            for f in rest:
                cells = tbl.add_row().cells
                cells[0].text = f.get("label", f["id"])
                val = _field_value(f, profile, overrides)
                stats["fields"] += 1
                run = cells[1].paragraphs[0].add_run(val)
                if val:
                    stats["filled"] += 1
                    run.font.highlight_color = WD_COLOR_INDEX.BRIGHT_GREEN
        elif t == "table":
            cols = b.get("columns", [])
            if not cols:
                continue
            if b.get("title"):
                d.add_paragraph(b["title"]).runs[0].bold = True
            rows, filled = _table_rows(b, profile)
            stats["filled"] += filled
            tbl = d.add_table(rows=1, cols=len(cols))
            tbl.style = "Table Grid"
            for i, c in enumerate(cols):
                tbl.rows[0].cells[i].text = c.get("header", "")
                for par in tbl.rows[0].cells[i].paragraphs:
                    for run in par.runs:
                        run.bold = True
            for row in rows:
                cells = tbl.add_row().cells
                for i, v in enumerate(row[:len(cols)]):
                    cells[i].text = str(v)
        elif t == "signature":
            d.add_paragraph()
            sig = [
                ("Signature", ""),
                ("Name", company.lookup(profile, "general.authorized_signatory")),
                ("Designation", company.lookup(profile, "general.signatory_designation")),
                ("For and on behalf of", company.lookup(profile, "general.name")),
                ("Date", ""),
                ("Place", ""),
            ]
            for label, val in sig:
                p = d.add_paragraph(f"{label}: ")
                run = p.add_run(val or "____________________")
                if val:
                    run.font.highlight_color = WD_COLOR_INDEX.BRIGHT_GREEN
    os.makedirs(os.path.dirname(path), exist_ok=True)
    d.save(path)
    return stats


# ----------------------------------------------------------------- Excel
def write_workbook(path: str, forms: list[dict], criteria: dict, compliance: list[dict],
                   profile: dict, tender: dict, form_files: dict[str, str]) -> None:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    head_fill = PatternFill("solid", fgColor=HEADER)
    yellow = PatternFill("solid", fgColor=YELLOW)
    green = PatternFill("solid", fgColor=GREEN)
    wrap = Alignment(wrap_text=True, vertical="top")

    def sheet(title: str, headers: list[str], widths: list[int] | None = None):
        ws = wb.create_sheet(safe_sheet_title(title, wb))
        ws.append(headers)
        for i, _h in enumerate(headers, start=1):
            c = ws.cell(row=1, column=i)
            c.fill = head_fill
            c.font = Font(bold=True)
            c.alignment = wrap
            ws.column_dimensions[get_column_letter(i)].width = (widths or [])[i - 1] if widths and i <= len(widths) else 22
        ws.freeze_panes = "A2"
        return ws

    wb.remove(wb.active)
    ws = sheet("Index", ["#", "Form", "Title", "Pages in tender", "Word file", "Source", "Status"], [5, 16, 50, 16, 50, 12, 14])
    ws.insert_rows(1, 2)
    ws.freeze_panes = "A4"
    ws["A1"] = f"{tender.get('title', '')}"[:250]
    ws["A1"].font = Font(bold=True, size=12)
    ws["A2"] = f"Ref: {tender.get('reference', '')}   Employer: {tender.get('employer', '')}"
    for i, f in enumerate(forms, start=1):
        ws.append([i, f.get("code"), f.get("title"), f"{f.get('file', '')} p{f.get('start_page')}-{f.get('end_page')}",
                   form_files.get(f.get("code", ""), ""), f.get("source", ""), "Pending"])
        ws.cell(row=ws.max_row, column=7).fill = yellow

    if compliance:
        ws = sheet("Compliance", ["Ref", "Criterion", "Requirement (summary)", "Required", "Our value", "Result", "Evidence / form", "Remarks"],
                   [8, 28, 60, 16, 16, 12, 22, 40])
        for c in compliance:
            ws.append([c.get("ref"), c.get("subject"), c.get("requirement", "")[:500], c.get("required"), c.get("actual"),
                       c.get("status"), ", ".join(c.get("forms", [])), c.get("remarks")])
            ws.cell(row=ws.max_row, column=6).fill = green if c.get("status") == "Meets" else yellow
            for col in range(1, 9):
                ws.cell(row=ws.max_row, column=col).alignment = wrap

    rows = criteria.get("criteria", [])
    if rows:
        ws = sheet("Criteria", ["Ref", "Category", "Subject", "Requirement", "Single entity", "JV all parties", "JV each member",
                                "JV one member", "Forms", "Threshold (INR Cr)", "Page"], [8, 16, 24, 70, 18, 18, 18, 18, 22, 12, 6])
        for r in rows:
            ws.append([r.get("ref"), r.get("category"), r.get("subject"), r.get("requirement"), r.get("single_entity"),
                       r.get("jv_all_parties"), r.get("jv_each_member"), r.get("jv_one_member"), ", ".join(r.get("forms", [])),
                       r.get("threshold_inr_cr") or "", r.get("page")])
            for col in range(1, 12):
                ws.cell(row=ws.max_row, column=col).alignment = wrap
    if criteria.get("personnel"):
        ws = sheet("Key Personnel", ["Position", "Min. no.", "Qualification", "Experience", "Proposed name", "Our qualification",
                                     "Our experience (yrs)", "CV attached?"], [26, 8, 34, 40, 24, 24, 14, 12])
        for p in criteria["personnel"]:
            ws.append([p.get("position"), p.get("count"), p.get("qualification"), p.get("experience"), "", "", "", ""])
            for col in range(5, 9):
                ws.cell(row=ws.max_row, column=col).fill = yellow
            for col in range(1, 5):
                ws.cell(row=ws.max_row, column=col).alignment = wrap
    if criteria.get("equipment"):
        ws = sheet("Key Equipment", ["Equipment", "Min. units", "Max age (yrs)", "Proposed make/model", "Qty", "Year of mfg",
                                     "Owned/leased"], [40, 16, 10, 24, 8, 12, 14])
        for e in criteria["equipment"]:
            ws.append([e.get("type"), e.get("min_units"), e.get("max_age_years"), "", "", "", ""])
            for col in range(4, 8):
                ws.cell(row=ws.max_row, column=col).fill = yellow

    for f in forms:
        tables = [b for b in f.get("blocks", []) if b.get("type") == "table" and b.get("columns")]
        field_blocks = [fl for b in f.get("blocks", []) if b.get("type") == "fields" for fl in b.get("fields", [])]
        if not tables:
            continue
        ws = wb.create_sheet(safe_sheet_title(f.get("code") or f.get("title", "Form"), wb))
        ws["A1"] = f"{f.get('code', '')} - {f.get('title', '')}"
        ws["A1"].font = Font(bold=True, size=12)
        r = 3
        for fl in field_blocks:
            ws.cell(row=r, column=1, value=fl.get("label"))
            val = company.lookup(profile, fl.get("key", ""))
            c = ws.cell(row=r, column=2, value=val)
            c.fill = green if val else yellow
            r += 1
        for t in tables:
            r += 1
            if t.get("title"):
                ws.cell(row=r, column=1, value=t["title"]).font = Font(bold=True)
                r += 1
            for ci, col in enumerate(t["columns"], start=1):
                c = ws.cell(row=r, column=ci, value=col.get("header"))
                c.fill = head_fill
                c.font = Font(bold=True)
                c.alignment = wrap
                ws.column_dimensions[get_column_letter(ci)].width = max(ws.column_dimensions[get_column_letter(ci)].width or 0, 18)
            rows, _filled = _table_rows(t, profile)
            n_pre = len(t.get("prefilled_rows", []))
            for ri, row in enumerate(rows):
                r += 1
                for ci, v in enumerate(row[:len(t["columns"])], start=1):
                    c = ws.cell(row=r, column=ci, value=_num(v))
                    if ri >= n_pre or ci > 1:
                        c.fill = green if v not in ("", None) and ri >= n_pre else (yellow if v in ("", None) else c.fill)
            r += 1
    os.makedirs(os.path.dirname(path), exist_ok=True)
    wb.save(path)


def _num(v: Any):
    if isinstance(v, str):
        s = v.replace(",", "").strip()
        if re.fullmatch(r"-?\d+(\.\d+)?", s):
            try:
                return float(s) if "." in s else int(s)
            except ValueError:
                return v
    return v


def safe_sheet_title(title: str, wb) -> str:
    base = re.sub(r"[\[\]:*?/\\]", "-", title or "Sheet").strip()[:28] or "Sheet"
    name, n = base, 2
    existing = {ws.title.lower() for ws in wb.worksheets}
    while name.lower() in existing:
        name = f"{base[:25]}-{n}"
        n += 1
    return name
