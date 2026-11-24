"""Canonical vocabulary for tender document sections.

Different employers name the same thing differently (``Section IV - Bidding
Forms``, ``Vol II - Forms & Formats``, ``Annexures``, ``Technical Bid Formats``
...). Every document/page range is mapped to one of the canonical roles below.
Default aliases cover common Indian/MDB (World Bank, ADB, JICA, KfW) and CPWD
style tenders; per-organisation aliases learned from user corrections are
stored in ``bid_org_profiles`` and applied on top of these.
"""

from __future__ import annotations

import re

ROLES: dict[str, dict] = {
    "nit": {
        "label": "Notice Inviting Tender / IFB",
        "aliases": [r"notice\s+inviting\s+tender", r"\bNIT\b", r"invitation\s+for\s+bids?", r"\bIFB\b",
                    r"notice\s+of\s+invitation", r"tender\s+notice", r"\bNIB\b", r"e-?tender\s+notice"],
    },
    "itb": {
        "label": "Instructions to Bidders",
        "aliases": [r"instructions?\s+to\s+(bidders|tenderers)", r"\bITB\b", r"\bITT\b",
                    r"instructions?\s+to\s+tenderers?", r"general\s+instructions"],
    },
    "bds": {
        "label": "Bid / Tender Data Sheet",
        "aliases": [r"bid\s+data\s+sheet", r"tender\s+data\s+sheet", r"\bBDS\b", r"\bQBDS\b", r"\bTDS\b",
                    r"qualification\s+and\s+bid\s+data"],
    },
    "qualification_criteria": {
        "label": "Qualification & Evaluation Criteria",
        # Indian NITs (MMRDA, PWD, CPWD ...) put these under "Eligibility Criteria".
        "aliases": [r"qualification\s+and\s+evaluation\s+criteria", r"evaluation\s+and\s+qualification\s+criteria",
                    r"qualification\s+criteria", r"eligibility\s+and\s+qualification", r"minimum\s+eligibility",
                    r"pre-?qualification\s+(criteria|requirements?)", r"\bPQ\s+criteria", r"\bIFCQR\b",
                    r"evaluation\s+criteria", r"eligibility\s+criteria", r"eligibility\s+conditions?",
                    r"qualif(ying|ication)\s+requirements?", r"minimum\s+qualif\w*", r"criteria\s+for\s+eligibility",
                    r"conditions?\s+of\s+eligibility", r"technical\s+eligibility", r"financial\s+eligibility"],
    },
    "bidding_forms": {
        "label": "Bidding Forms / Formats",
        "aliases": [r"bidding\s+forms", r"tender\s+forms", r"forms?\s+(and|&)\s+(schedules|formats)",
                    r"bid\s+forms", r"qualification\s+and\s+bidding\s+forms", r"standard\s+forms",
                    r"formats?\s+for\s+(bid|tender)", r"\bannexures?\b", r"technical\s+bid\s+formats?",
                    r"proforma"],
    },
    "eligibility": {
        "label": "Eligible Countries (funding agency)",
        "aliases": [r"eligible\s+countries", r"source\s+countries", r"eligible\s+goods"],
    },
    "fraud_policy": {
        "label": "Fraud & Corruption / Funding Agency Policy",
        "aliases": [r"fraud\s+and\s+corruption", r"corrupt\s+and\s+fraudulent", r"kfw\s+policy",
                    r"integrity\s+pact", r"bank\s+policy"],
    },
    "employer_requirements": {
        "label": "Employer's Requirements / Scope / Specifications",
        "aliases": [r"employer'?s\s+requirements", r"technical\s+specifications?", r"general\s+specifications?",
                    r"scope\s+of\s+work", r"works\s+requirements", r"\bERGS\b", r"\bERTS\b",
                    r"particular\s+specifications?"],
    },
    "drawings": {
        "label": "Drawings",
        "aliases": [r"tender\s+drawings?", r"\bdrawings?\b"],
    },
    "she": {
        "label": "Safety, Health & Environment",
        "aliases": [r"safety,?\s+health\s+(and|&)\s+environment", r"\bSHE\b\s+manual", r"\bESHS\b\s+(manual|requirements)"],
    },
    "gcc": {
        "label": "General Conditions of Contract",
        "aliases": [r"general\s+conditions(\s+of\s+contract)?", r"\bGCC\b"],
    },
    "pcc": {
        "label": "Particular / Special Conditions of Contract",
        "aliases": [r"particular\s+conditions", r"special\s+conditions(\s+of\s+contract)?", r"\bPCC\b", r"\bSCC\b"],
    },
    "contract_forms": {
        "label": "Contract Forms",
        "aliases": [r"contract\s+forms", r"form\s+of\s+contract\s+agreement", r"performance\s+security\s+form"],
    },
    "boq": {
        "label": "Bill of Quantities / Price Bid",
        "aliases": [r"bill\s+of\s+quantities", r"\bBOQ\b", r"price\s+bid", r"financial\s+bid", r"schedule\s+of\s+(rates|prices)",
                    r"price\s+schedule"],
    },
    "corrigendum": {
        "label": "Corrigendum / Addendum",
        "aliases": [r"corrigendum", r"addend(um|a)", r"amendment\s+no", r"pre-?bid\s+(replies|clarifications)"],
    },
    "other": {"label": "Other", "aliases": []},
}

# Roles that the bid preparer must act on (drive the default UI ordering).
PRIMARY_ROLES = ["qualification_criteria", "bidding_forms", "bds", "itb", "nit", "boq", "corrigendum"]

_COMPILED: dict[str, list[re.Pattern]] = {
    role: [re.compile(a, re.I) for a in spec["aliases"]] for role, spec in ROLES.items()
}


def role_label(role: str) -> str:
    return ROLES.get(role, ROLES["other"])["label"]


def score_text(text: str, extra_aliases: dict[str, list[str]] | None = None) -> dict[str, float]:
    """Score how strongly ``text`` points to each role (higher = stronger)."""
    scores: dict[str, float] = {}
    if not text:
        return scores
    for role, patterns in _COMPILED.items():
        hits = sum(len(p.findall(text)) for p in patterns)
        if hits:
            scores[role] = scores.get(role, 0.0) + hits
    for role, aliases in (extra_aliases or {}).items():
        for alias in aliases:
            try:
                n = len(re.findall(re.escape(alias) if not alias.startswith("re:") else alias[3:], text, re.I))
            except re.error:
                n = 0
            if n:
                # Learned aliases are org-specific and more trustworthy.
                scores[role] = scores.get(role, 0.0) + 3.0 * n
    return scores
