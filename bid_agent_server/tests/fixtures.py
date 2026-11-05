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
