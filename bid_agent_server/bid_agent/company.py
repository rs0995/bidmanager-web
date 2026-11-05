"""Bidder (company) master data used to pre-fill bidding forms.

Forms extracted from tenders tag their fields with the canonical keys below
(e.g. ``general.name``) and their tables with a profile list section
(``financials``, ``experience`` ...). Generation then fills what it can and
leaves highlighted blanks for the rest.
"""

from __future__ import annotations

import re
from typing import Any

GENERAL_FIELDS: dict[str, str] = {
    "name": "Legal name of bidder",
    "legal_status": "Legal status / constitution (Pvt Ltd, LLP, Partnership...)",
    "year_of_incorporation": "Year of incorporation / registration",
    "registration_no": "Company registration / CIN number",
    "country": "Country of registration",
    "registered_address": "Registered address",
    "pan": "PAN",
    "gstin": "GSTIN",
    "authorized_signatory": "Authorised signatory name",
    "signatory_designation": "Authorised signatory designation",
    "phone": "Phone",
    "email": "Email",
    "website": "Website",
    "bank_name": "Banker's name",
    "bank_branch_address": "Bank branch address",
    "bank_account_no": "Bank account number",
    "bank_ifsc": "Bank IFSC",
    "msme_udyam_no": "MSME / Udyam registration no.",
    "epf_registration_no": "EPF registration no.",
    "esic_registration_no": "ESIC registration no.",
}

LIST_SECTIONS: dict[str, dict[str, str]] = {
    "financials": {
        "fy": "Financial year (e.g. 2024-25)",
        "turnover_inr_cr": "Total turnover (INR Cr)",
        "civil_turnover_inr_cr": "Civil/construction turnover (INR Cr)",
        "net_worth_inr_cr": "Net worth (INR Cr)",
        "current_assets_inr_cr": "Current assets (INR Cr)",
        "current_liabilities_inr_cr": "Current liabilities (INR Cr)",
        "profit_before_tax_inr_cr": "Profit before tax (INR Cr)",
        "total_assets_inr_cr": "Total assets (INR Cr)",
        "total_liabilities_inr_cr": "Total liabilities (INR Cr)",
    },
    "experience": {
        "name_of_work": "Name of work / contract",
        "client": "Employer / client name",
        "client_address": "Client address & contact",
        "contract_no": "Contract / agreement number",
        "location": "Location",
        "contract_value_inr_cr": "Contract value (INR Cr)",
        "completed_value_inr_cr": "Value of work completed (INR Cr)",
        "role": "Role (prime / JV member / sub-contractor / management contractor)",
        "share_pct": "Share in JV (%)",
        "start_date": "Start date",
        "completion_date": "Completion date (actual)",
        "status": "Status (completed / ongoing)",
        "category": "Nature / category of work (metro station, road, building...)",
        "description": "Brief scope description",
    },
    "works_in_hand": {
        "name_of_work": "Name of work",
        "client": "Employer",
        "contract_value_inr_cr": "Contract value (INR Cr)",
        "balance_value_inr_cr": "Value of balance work (INR Cr)",
        "expected_completion": "Anticipated completion date",
    },
    "personnel": {
        "name": "Name",
        "designation": "Proposed / current position",
        "qualification": "Qualification",
        "total_experience_years": "Total experience (years)",
        "relevant_experience_years": "Relevant experience (years)",
        "years_with_firm": "Years with the firm",
    },
    "equipment": {
        "type": "Type of equipment",
        "make_model": "Make / model",
        "capacity": "Capacity",
        "quantity": "Quantity",
        "year_of_manufacture": "Year of manufacture",
        "ownership": "Owned / leased / to be purchased",
        "location": "Current location",
    },
    "certificates": {
        "name": "Certificate (ISO 9001, 14001, 45001 ...)",
        "number": "Certificate number",
        "issued_by": "Issued by",
        "valid_till": "Valid till",
    },
    "litigation": {
        "year": "Year",
        "matter": "Matter in dispute",
        "value_inr_cr": "Value (INR Cr)",
        "outcome": "Outcome / status",
    },
}


def canonical_field_keys() -> list[str]:
    return [f"general.{k}" for k in GENERAL_FIELDS] + [
        f"{sec}.{col}" for sec, cols in LIST_SECTIONS.items() for col in cols
    ]


def vocabulary_text() -> str:
    """Compact description of canonical keys for the LLM prompt."""
    lines = ["Single-value keys:"]
    lines += [f"  general.{k}: {v}" for k, v in GENERAL_FIELDS.items()]
    lines.append("Table sections (bind a table with binds_to=<section>, columns with key=<section>.<col>):")
    for sec, cols in LIST_SECTIONS.items():
        lines.append(f"  {sec}: " + ", ".join(f"{c} ({d})" for c, d in cols.items()))
    return "\n".join(lines)


def empty_profile() -> dict[str, Any]:
    return {"general": {k: "" for k in GENERAL_FIELDS}, **{sec: [] for sec in LIST_SECTIONS}}


def profile_schema() -> dict[str, Any]:
    """Schema description sent to the frontend to render the profile editor."""
    return {
        "general": [{"key": k, "label": v} for k, v in GENERAL_FIELDS.items()],
        "lists": [
            {"section": sec, "columns": [{"key": c, "label": d} for c, d in cols.items()]}
            for sec, cols in LIST_SECTIONS.items()
        ],
    }


def lookup(profile: dict[str, Any], key: str) -> str:
    """Value for a single canonical key like ``general.name``; '' if unknown."""
    if not key or "." not in key:
        return ""
    sec, col = key.split(".", 1)
    data = profile.get(sec)
    if isinstance(data, dict):
        v = data.get(col, "")
        return "" if v is None else str(v)
    return ""


def rows_for(profile: dict[str, Any], section: str, filters: dict | None = None) -> list[dict]:
    rows = profile.get(section) or []
    if not isinstance(rows, list):
        return []
    if section == "financials":
        rows = sorted(rows, key=lambda r: str(r.get("fy", "")), reverse=True)
    if section == "experience" and filters and filters.get("status"):
        rows = [r for r in rows if str(r.get("status", "")).lower().startswith(filters["status"].lower())]
    return rows


# Keyword hints used when no AI is available to tag form fields.
_FIELD_HINTS: list[tuple[str, list[str]]] = [
    ("general.year_of_incorporation", ["year of incorporation", "year of constitution", "year of registration"]),
    ("general.country", ["country of registration", "country of constitution", "country of incorporation"]),
    ("general.registered_address", ["legal address", "registered address", "registered office", "address of the bidder"]),
    ("general.authorized_signatory", ["authorized representative", "authorised representative", "authorized signatory",
                                      "authorised signatory", "name of signatory"]),
    ("general.signatory_designation", ["designation", "title of signatory", "capacity"]),
    ("general.registration_no", ["registration number", "cin", "registration no"]),
    ("general.gstin", ["gstin", "gst no", "gst registration"]),
    ("general.pan", ["pan", "permanent account number"]),
    ("general.email", ["e-mail", "email"]),
    ("general.phone", ["telephone", "phone", "mobile"]),
    ("general.website", ["website", "web site"]),
    ("general.bank_name", ["name of bank", "banker"]),
    ("general.legal_status", ["legal status", "constitution of the firm", "type of entity"]),
    ("general.name", ["legal name", "name of bidder", "bidder's name", "name of the bidder", "name of firm",
                      "name of the firm", "name of applicant", "applicant's name", "name of tenderer"]),
]


def guess_key(label: str) -> str:
    t = re.sub(r"\s+", " ", (label or "").lower())
    for key, hints in _FIELD_HINTS:
        if any(re.search(r"\b" + re.escape(h) + r"\b", t) for h in hints):
            return key
    return ""
