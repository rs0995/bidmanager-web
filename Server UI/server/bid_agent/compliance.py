"""Compare extracted qualification criteria with the bidder's master data.

Only checks that can be computed reliably are automated (turnover, net
worth, similar works, bid capacity, liquidity, ISO certificates); every other
criterion is listed as "Manual check" so nothing silently drops off.
"""

from __future__ import annotations

import re
from datetime import date, datetime

from . import company


def _f(v) -> float | None:
    try:
        s = str(v).replace(",", "").strip()
        return float(s) if s else None
    except (TypeError, ValueError):
        return None


def _date(v) -> date | None:
    s = str(v or "").strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%m/%Y", "%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _escalation_rate(text: str) -> float:
    m = re.search(r"(\d+(?:\.\d+)?)\s*%\s*(?:escalation|inflation)", text, re.I) or re.search(
        r"(?:escalation|inflation)[^.%]{0,60}?(\d+(?:\.\d+)?)\s*%", text, re.I)
    return float(m.group(1)) / 100 if m else 0.0


def _fy_rows(profile: dict, n: int) -> list[dict]:
    return company.rows_for(profile, "financials")[:n]


def _turnover(row: dict) -> float | None:
    v = _f(row.get("civil_turnover_inr_cr"))
    return v if v is not None else _f(row.get("turnover_inr_cr"))


def check(criteria: dict, profile: dict, today: date | None = None) -> list[dict]:
    today = today or date.today()
    out = []
    for c in criteria.get("criteria", []):
        metric = c.get("metric", "other")
        req = c.get("requirement", "")
        thr = _f(c.get("threshold_inr_cr")) or 0.0
        res = {
            "ref": c.get("ref"), "subject": c.get("subject"), "requirement": req, "forms": c.get("forms", []),
            "metric": metric, "required": f"{thr:g} Cr" if thr else "", "actual": "", "status": "Manual check",
            "remarks": "",
        }
        try:
            fn = CHECKS.get(metric)
            if fn:
                fn(c, profile, res, thr, today)
        except Exception as e:  # never break the analysis on odd data
            res["remarks"] = f"Could not evaluate automatically: {e}"
        out.append(res)
    return out


def _avg_turnover(c, profile, res, thr, today):
    years = int(c.get("period_years") or 0) or 5
    rows = _fy_rows(profile, years)
    rate = _escalation_rate(c.get("requirement", ""))
    vals = []
    for i, r in enumerate(rows):
        t = _turnover(r)
        if t is not None:
            vals.append(t * ((1 + rate) ** (i + 1)) if rate else t)
    if len(vals) < years:
        res.update(status="Data missing", remarks=f"Need turnover for last {years} financial years ({len(vals)} entered).")
        return
    avg = sum(vals) / years
    res["actual"] = f"{avg:.2f} Cr"
    if thr:
        res["status"] = "Meets" if avg >= thr else "Shortfall"
    res["remarks"] = f"Average of {years} years" + (f", updated at {rate * 100:g}% per year" if rate else "") + \
        ". JV: apply pro-rata share per member."


def _net_worth(c, profile, res, thr, today):
    years = int(c.get("period_years") or 0) or 5
    rows = _fy_rows(profile, years)
    nw = [(_f(r.get("net_worth_inr_cr")), r.get("fy")) for r in rows]
    known = [(v, fy) for v, fy in nw if v is not None]
    if not known:
        res.update(status="Data missing", remarks="Enter net worth per financial year.")
        return
    pos = sum(1 for v, _ in known if v > 0)
    m = re.search(r"any\s+(\d+)\s+of\s+the\s+last\s+(\d+)", c.get("requirement", ""), re.I)
    need = int(m.group(1)) if m else len(known)
    res["required"] = f"Positive in {need} of last {years} yrs" if m else (res["required"] or "Positive")
    res["actual"] = f"Positive in {pos} of {len(known)} yrs"
    if thr:
        latest = known[0][0]
        res["status"] = "Meets" if latest >= thr else "Shortfall"
    else:
        res["status"] = "Meets" if pos >= need else "Shortfall"


def _similar_work(c, profile, res, thr, today):
    years = int(c.get("period_years") or 0) or 7
    need = int(c.get("threshold_count") or 0) or 1
    cutoff = date(today.year - years, today.month, 1)
    works = company.rows_for(profile, "experience")
    if not works:
        res.update(status="Data missing", remarks="Add completed works in Company Profile -> Experience.")
        return
    rate = _escalation_rate(c.get("requirement", ""))
    ok = []
    for w in works:
        v = _f(w.get("completed_value_inr_cr")) or _f(w.get("contract_value_inr_cr"))
        share = _f(w.get("share_pct"))
        if v is None:
            continue
        if share and 0 < share < 100:
            v = v * share / 100
        done = _date(w.get("completion_date"))
        if done and done < cutoff:
            continue
        if done and rate:
            v = v * ((1 + rate) ** max(0, today.year - done.year))
        if v >= thr:
            ok.append(w.get("name_of_work", "?"))
    res["required"] = f"{need} work(s) >= {thr:g} Cr in {years} yrs"
    res["actual"] = f"{len(ok)} qualifying"
    res["status"] = "Meets" if len(ok) >= need else "Check"
    res["remarks"] = ("; ".join(ok[:5]) + " - confirm they match the 'similar work' definition.") if ok else \
        "No entered work reaches the value; check category/similarity manually."


def _bid_capacity(c, profile, res, thr, today):
    req = c.get("requirement", "")
    m = re.search(r"(\d+(?:\.\d+)?)\s*[x×*]?\s*A\s*[x×*]?\s*N\s*-\s*B", req.replace(" ", " "))
    mult = float(m.group(1)) if m else 2.0
    nm = re.search(r"N\s*=\s*(\d+(?:\.\d+)?)", req)
    n = float(nm.group(1)) if nm else None
    rows = _fy_rows(profile, 5)
    rate = _escalation_rate(req)
    vals = [(_turnover(r) or 0) * ((1 + rate) ** (i + 1) if rate else 1) for i, r in enumerate(rows)]
    if not vals or n is None:
        res.update(status="Data missing" if not vals else "Manual check",
                   remarks="Need 5 years' turnover and works in hand; contract period N not found in text." if n is None
                   else "Need 5 years' turnover.")
        return
    a = max(vals)
    b = sum(_f(w.get("balance_value_inr_cr")) or 0 for w in company.rows_for(profile, "works_in_hand"))
    cap = mult * a * n - b
    res["actual"] = f"{cap:.2f} Cr ({mult:g}×{a:.2f}×{n:g} − {b:.2f})"
    if thr:
        res["status"] = "Meets" if cap > thr else "Shortfall"
    res["remarks"] = "Works in hand B must be the value at 28 days before bid due date (update Company Profile)."


def _liquidity(c, profile, res, thr, today):
    rows = _fy_rows(profile, 1)
    if not rows:
        res.update(status="Data missing", remarks="Enter current assets/liabilities.")
        return
    ca, cl = _f(rows[0].get("current_assets_inr_cr")), _f(rows[0].get("current_liabilities_inr_cr"))
    if ca is None or cl is None:
        res.update(status="Data missing", remarks="Enter current assets and current liabilities for the latest year.")
        return
    nca = ca - cl
    res["actual"] = f"NCA {nca:.2f} Cr ({rows[0].get('fy', '')})"
    res["status"] = "Meets" if thr and nca >= thr else "Check"
    res["remarks"] = "Banking reference / credit lines can be added to net current assets where the tender allows."


def _certificates(c, profile, res, thr, today):
    text = c.get("requirement", "")
    wanted = re.findall(r"(ISO\s*\d{4,5}|OHSAS\s*\d{4,5})", text, re.I)
    if not wanted:
        return
    have = company.rows_for(profile, "certificates")
    names = []
    for cert in have:
        valid = _date(cert.get("valid_till"))
        if valid and valid < today:
            continue
        names.append(re.sub(r"\s+", "", str(cert.get("name", "")).upper()))
    missing = []
    groups = {}
    for w in wanted:
        key = re.sub(r"\s+", "", w.upper())
        if key in ("OHSAS18001", "ISO45001"):
            groups.setdefault("ohs", []).append(key)
        else:
            groups.setdefault(key, []).append(key)
    for g, alts in groups.items():
        if not any(any(a in n for n in names) for a in alts):
            missing.append(" / ".join(alts))
    res["required"] = ", ".join(sorted({re.sub(r'\s+', ' ', w.upper()) for w in wanted}))
    res["actual"] = "All valid" if not missing else "Missing: " + ", ".join(missing)
    res["status"] = "Meets" if not missing else "Shortfall"


CHECKS = {
    "avg_annual_turnover": _avg_turnover,
    "net_worth": _net_worth,
    "similar_work_value": _similar_work,
    "bid_capacity": _bid_capacity,
    "liquidity": _liquidity,
    "certificate": _certificates,
}
