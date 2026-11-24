"""Builds a small synthetic tender (three DOCX volumes) for the tests."""

from __future__ import annotations

import os

import docx
from docx.enum.text import WD_BREAK


def _page_break(d):
    d.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def _filler(d, n=3):
    for _ in range(n):
        d.add_paragraph("The provisions of this section shall be read with the other sections of the bidding "
                        "documents and the bidder shall comply with all requirements stated herein in full. " * 2)


def build_tender(folder: str) -> list[str]:
    os.makedirs(folder, exist_ok=True)
    paths = []

    d = docx.Document()
    d.add_paragraph("Section I: Instructions to Bidders")
    _filler(d)
    _page_break(d)
    d.add_paragraph("Section I: Instructions to Bidders")
    d.add_paragraph("1. Scope of Bid. Bid No. ABC/WORKS/2026/01")
    _filler(d)
    p = os.path.join(folder, "Volume 1 - ITT.docx")
    d.save(p)
    paths.append(p)

    d = docx.Document()
    d.add_paragraph("Section III: Qualification and Evaluation Criteria")
    t = d.add_table(rows=1, cols=8)
    for i, h in enumerate(["No.", "Subject", "Requirement", "Single Entity", "JV All Parties", "JV Each Member",
                           "JV One Member", "Documentation Requirements / Forms"]):
        t.rows[0].cells[i].text = h
    rows = [
        ["3.4", "Average Annual Turnover", "Average annual turnover for the last five financial years, with 5% escalation "
         "per year, shall not be less than INR 100.00 Crore.", "Must meet the requirement", "Must meet the requirement",
         "25%", "40%", "Form FIN-3.2"],
        ["4.2", "Similar Work Experience", "At least one similar work of value INR 60.00 Crore in the last 7 years.",
         "Must meet the requirement", "Must meet the requirement", "N/A", "N/A", "Form EXP-4.2"],
        ["5.1", "Certificates", "Valid ISO 9001 and ISO 14001 certificates.", "Must meet the requirement", "N/A",
         "Must meet the requirement", "N/A", "Form CER-5.1"],
    ]
    for r in rows:
        cells = t.add_row().cells
        for i, v in enumerate(r):
            cells[i].text = v
    _filler(d, 2)
    p = os.path.join(folder, "Volume 2 - PQ Criteria.docx")
    d.save(p)
    paths.append(p)

    d = docx.Document()
    d.add_paragraph("Section IV: Bidding Forms")
    _filler(d, 2)
    _page_break(d)
    d.add_paragraph("Form FIN-3.2: Average Annual Construction Turnover")
    d.add_paragraph("Bidder's legal name: [insert full legal name]")
    t = d.add_table(rows=1, cols=2)
    t.rows[0].cells[0].text = "Year"
    t.rows[0].cells[1].text = "Amount (INR Crore)"
    _filler(d, 2)
    _page_break(d)
    d.add_paragraph("Form EXP-4.2: Specific Construction Experience")
    d.add_paragraph("Contract identification: ____________")
    _filler(d, 2)
    p = os.path.join(folder, "Volume 3 - Bidding Forms.docx")
    d.save(p)
    paths.append(p)
    return paths


NIT_FILLER = ("The bidder shall study the tender documents carefully and visit the site before submitting the bid. "
              "All rates shall be quoted in Indian Rupees and shall include all taxes, duties and levies. ") * 3


def build_mmrda_style_nit(folder: str) -> str:
    """One NIT document (as portals publish it) with the criteria as numbered paragraphs
    under 'ELIGIBILITY CRITERIA' in the middle, and a separate JV clause that also
    mentions qualification criteria. Returns the PDF path (DOCX if LibreOffice is missing)."""
    import shutil
    import subprocess

    os.makedirs(folder, exist_ok=True)
    d = docx.Document()
    d.add_paragraph("MUMBAI METROPOLITAN REGION DEVELOPMENT AUTHORITY")
    d.add_paragraph("NOTICE INVITING TENDER  e-Tender No. MMRDA/ENG/2026/1345405")
    d.add_paragraph("Name of work: Construction of flyover and allied works at Thane")
    for _ in range(3):
        d.add_paragraph(NIT_FILLER)
    _page_break(d)
    d.add_paragraph("1. SCOPE OF WORK")
    for _ in range(4):
        d.add_paragraph(NIT_FILLER)
    _page_break(d)
    d.add_paragraph("ELIGIBILITY CRITERIA")
    d.add_paragraph("The bidder shall satisfy the following minimum eligibility criteria:")
    d.add_paragraph("1. Average Annual Financial Turnover: The average annual financial turnover of the bidder "
                    "during the last three financial years ending 31.03.2025 should be at least Rs. 45.00 Crore.")
    d.add_paragraph("2. Similar Works: The bidder should have satisfactorily completed during the last seven years "
                    "ending previous day of last date of submission of bid at least one similar work of value not "
                    "less than Rs. 60.00 Crore, or two similar works each of value not less than Rs. 37.50 Crore, or "
                    "three similar works each of value not less than Rs. 30.00 Crore.")
    d.add_paragraph("3. Bid Capacity: The available bid capacity (2AN-B) of the bidder should be more than the "
                    "estimated cost of the work, where N = 2 years.")
    d.add_paragraph("4. Net Worth: The net worth of the bidder should be positive as per the audited balance "
                    "sheet of the last financial year.")
    d.add_paragraph("5. Registration: The bidder should be registered with GST and EPF authorities.")
    _page_break(d)
    d.add_paragraph("JOINT VENTURE")
    d.add_paragraph("(a) Joint venture of maximum two firms is permitted. The lead partner shall meet at least 60% "
                    "of the qualification criteria of turnover and the other partner at least 40%.")
    d.add_paragraph("(b) Each partner of the joint venture shall be jointly and severally liable for the contract.")
    for _ in range(2):
        d.add_paragraph(NIT_FILLER)
    _page_break(d)
    d.add_paragraph("INSTRUCTIONS TO BIDDERS")
    for _ in range(5):
        d.add_paragraph(NIT_FILLER)
    path = os.path.join(folder, "Tender Document MMRDA 1345405.docx")
    d.save(path)
    soffice = shutil.which("soffice")
    if soffice:
        subprocess.run([soffice, "--headless", "--convert-to", "pdf", "--outdir", folder, path],
                       check=True, timeout=180, capture_output=True)
        os.remove(path)
        return os.path.splitext(path)[0] + ".pdf"
    return path
