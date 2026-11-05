"""Persistence for the Bid Agent on the BidManager server.

Works on SQLite (local dev) and Postgres (production) through the server's
``sqlite3.connect`` compatibility layer: only ``?`` placeholders, ``ON CONFLICT``
upserts and TEXT JSON columns are used (no ``INSERT OR REPLACE``).

Scopes
  shared  bid_org_profiles, bid_doc_cache, bid_form_library  - facts about public
          tender documents and employers, reused by every account
  owner   bid_analyses, bid_company_profiles - keyed by ``owner_key``:
          ``org:<id>`` for organisation accounts, ``user:<id>`` for individuals
"""

from __future__ import annotations

import json
import re
import time
from contextlib import contextmanager
from typing import Any, Callable

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS bid_org_profiles (
        org_key TEXT PRIMARY KEY,
        org_name TEXT,
        aliases_json TEXT,
        form_codes_json TEXT,
        tender_ids_json TEXT,
        tender_count INTEGER DEFAULT 0,
        updated_at REAL
    )""",
    """CREATE TABLE IF NOT EXISTS bid_doc_cache (
        cache_key TEXT PRIMARY KEY,
        file_name TEXT,
        data_json TEXT,
        updated_at REAL
    )""",
    """CREATE TABLE IF NOT EXISTS bid_form_library (
        lib_key TEXT PRIMARY KEY,
        org_key TEXT,
        form_code TEXT,
        title TEXT,
        fingerprint TEXT,
        schema_json TEXT,
        source_file TEXT,
        use_count INTEGER DEFAULT 1,
        created_at REAL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_bid_form_library_org ON bid_form_library(org_key)",
    """CREATE TABLE IF NOT EXISTS bid_analyses (
        owner_key TEXT NOT NULL,
        tender_db_id INTEGER NOT NULL,
        status TEXT,
        logs_json TEXT,
        result_json TEXT,
        error TEXT,
        started_by INTEGER,
        started_at REAL,
        updated_at REAL,
        PRIMARY KEY (owner_key, tender_db_id)
    )""",
    """CREATE TABLE IF NOT EXISTS bid_company_profiles (
        owner_key TEXT PRIMARY KEY,
        data_json TEXT,
        updated_by INTEGER,
        updated_at REAL
    )""",
]


def org_key_for(name: str) -> str:
    s = (name or "").lower()
    s = re.sub(r"\b(limited|ltd|pvt|private|corporation|corp|the|of|and)\b", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return re.sub(r"\s+", "-", s)[:80] or "unknown"


def employer_from_org_chain(org_chain: str) -> str:
    """Portal org chains look like 'Gujarat Metro Rail Corporation||Projects||Surat'."""
    parts = [p.strip() for p in re.split(r"\|\||>|/", org_chain or "") if p.strip()]
    return parts[0] if parts else ""


def _loads(raw: Any, default: Any) -> Any:
    if raw in (None, ""):
        return default
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return default


class Store:
    """``connect`` returns a DB-API connection (the server's patched sqlite3.connect)."""

    def __init__(self, connect: Callable[[], Any]):
        self._connect = connect

    @contextmanager
    def conn(self):
        c = self._connect()
        try:
            yield c
        finally:
            c.close()

    def init_schema(self) -> None:
        with self.conn() as c:
            for stmt in SCHEMA:
                c.execute(stmt)
            c.commit()

    # ---- employer profiles (shared) -------------------------------------
    def get_org(self, org_key: str) -> dict:
        with self.conn() as c:
            r = c.execute(
                "SELECT org_key, org_name, aliases_json, form_codes_json, tender_ids_json, updated_at "
                "FROM bid_org_profiles WHERE org_key=?", (org_key,)).fetchone()
        if not r:
            return {"org_key": org_key, "org_name": "", "aliases": {}, "form_codes": [], "tender_ids": [],
                    "tender_count": 0}
        ids = _loads(r[4], [])
        return {"org_key": r[0], "org_name": r[1] or "", "aliases": _loads(r[2], {}),
                "form_codes": _loads(r[3], []), "tender_ids": ids, "tender_count": len(ids), "updated_at": r[5]}

    def list_orgs(self) -> list[dict]:
        with self.conn() as c:
            keys = [r[0] for r in c.execute("SELECT org_key FROM bid_org_profiles ORDER BY updated_at DESC").fetchall()]
        return [self.get_org(k) for k in keys]

    def save_org(self, org: dict) -> None:
        with self.conn() as c:
            c.execute(
                "INSERT INTO bid_org_profiles (org_key, org_name, aliases_json, form_codes_json, tender_ids_json, "
                "tender_count, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT (org_key) DO UPDATE SET "
                "org_name=excluded.org_name, aliases_json=excluded.aliases_json, form_codes_json=excluded.form_codes_json, "
                "tender_ids_json=excluded.tender_ids_json, tender_count=excluded.tender_count, updated_at=excluded.updated_at",
                (org["org_key"], org.get("org_name", ""), json.dumps(org.get("aliases", {})),
                 json.dumps(sorted(set(org.get("form_codes", [])))), json.dumps(org.get("tender_ids", [])[-500:]),
                 len(org.get("tender_ids", [])), time.time()),
            )
            c.commit()

    def delete_org(self, org_key: str) -> None:
        with self.conn() as c:
            c.execute("DELETE FROM bid_org_profiles WHERE org_key=?", (org_key,))
            c.execute("DELETE FROM bid_form_library WHERE org_key=?", (org_key,))
            c.commit()

    def learn_alias(self, org_key: str, org_name: str, role: str, alias: str) -> None:
        alias = (alias or "").strip()
        if len(alias) < 3:
            return
        org = self.get_org(org_key)
        org["org_name"] = org_name or org.get("org_name", "")
        lst = org["aliases"].setdefault(role, [])
        if alias.lower() not in [a.lower() for a in lst]:
            lst.append(alias[:120])
        for other, items in org["aliases"].items():
            if other != role:
                org["aliases"][other] = [a for a in items if a.lower() != alias.lower()]
        self.save_org(org)

    # ---- document cache (shared) ----------------------------------------
    def get_doc_cache(self, key: str) -> Any:
        with self.conn() as c:
            r = c.execute("SELECT data_json FROM bid_doc_cache WHERE cache_key=?", (key,)).fetchone()
        return _loads(r[0], None) if r else None

    def put_doc_cache(self, key: str, file_name: str, data: Any) -> None:
        with self.conn() as c:
            c.execute(
                "INSERT INTO bid_doc_cache (cache_key, file_name, data_json, updated_at) VALUES (?,?,?,?) "
                "ON CONFLICT (cache_key) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at",
                (key, file_name, json.dumps(data), time.time()),
            )
            c.commit()

    # ---- form library (shared) ------------------------------------------
    @staticmethod
    def _lib_key(org_key: str, code: str, fingerprint: str) -> str:
        return f"{org_key}|{code}|{fingerprint}"

    def find_form(self, org_key: str, form_code: str, fingerprint: str) -> dict | None:
        key = self._lib_key(org_key, form_code, fingerprint)
        with self.conn() as c:
            r = c.execute("SELECT schema_json FROM bid_form_library WHERE lib_key=?", (key,)).fetchone()
            if r:
                c.execute("UPDATE bid_form_library SET use_count=use_count+1 WHERE lib_key=?", (key,))
                c.commit()
        return _loads(r[0], None) if r else None

    def save_form(self, org_key: str, form: dict, fingerprint: str, source_file: str) -> None:
        key = self._lib_key(org_key, form.get("code", ""), fingerprint)
        with self.conn() as c:
            c.execute(
                "INSERT INTO bid_form_library (lib_key, org_key, form_code, title, fingerprint, schema_json, source_file, created_at) "
                "VALUES (?,?,?,?,?,?,?,?) ON CONFLICT (lib_key) DO UPDATE SET schema_json=excluded.schema_json, "
                "title=excluded.title",
                (key, org_key, form.get("code", ""), form.get("title", ""), fingerprint, json.dumps(form), source_file, time.time()),
            )
            c.commit()

    def list_forms(self, org_key: str = "") -> list[dict]:
        q = "SELECT org_key, form_code, title, use_count, created_at, source_file FROM bid_form_library"
        args: tuple = ()
        if org_key:
            q += " WHERE org_key=?"
            args = (org_key,)
        with self.conn() as c:
            rows = c.execute(q + " ORDER BY org_key, form_code", args).fetchall()
        cols = ["org_key", "form_code", "title", "use_count", "created_at", "source_file"]
        return [dict(zip(cols, tuple(r))) for r in rows]

    # ---- analyses (per owner) -------------------------------------------
    def save_analysis(self, owner_key: str, tender_db_id: int, *, status: str, logs: list[str] | None = None,
                      result: dict | None = None, error: str = "", started_by: int | None = None) -> None:
        now = time.time()
        with self.conn() as c:
            c.execute(
                "INSERT INTO bid_analyses (owner_key, tender_db_id, status, logs_json, result_json, error, started_by, started_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (owner_key, tender_db_id) DO UPDATE SET "
                "status=excluded.status, logs_json=COALESCE(excluded.logs_json, bid_analyses.logs_json), "
                "result_json=COALESCE(excluded.result_json, bid_analyses.result_json), error=excluded.error, "
                "started_by=COALESCE(excluded.started_by, bid_analyses.started_by), "
                "started_at=CASE WHEN excluded.status='running' THEN excluded.started_at ELSE bid_analyses.started_at END, "
                "updated_at=excluded.updated_at",
                (owner_key, int(tender_db_id), status, json.dumps(logs) if logs is not None else None,
                 json.dumps(result) if result is not None else None, error, started_by, now, now),
            )
            c.commit()

    def get_analysis(self, owner_key: str, tender_db_id: int) -> dict | None:
        with self.conn() as c:
            r = c.execute(
                "SELECT status, logs_json, result_json, error, started_at, updated_at FROM bid_analyses "
                "WHERE owner_key=? AND tender_db_id=?", (owner_key, int(tender_db_id))).fetchone()
        if not r:
            return None
        return {"tender_id": int(tender_db_id), "status": r[0], "logs": _loads(r[1], []),
                "result": _loads(r[2], None), "error": r[3] or "", "started_at": r[4], "updated_at": r[5]}

    def list_analyses(self, owner_key: str) -> list[dict]:
        with self.conn() as c:
            rows = c.execute(
                "SELECT tender_db_id, status, updated_at FROM bid_analyses WHERE owner_key=? ORDER BY updated_at DESC",
                (owner_key,)).fetchall()
        return [{"tender_id": int(r[0]), "status": r[1], "updated_at": r[2]} for r in rows]

    # ---- company profile (per owner) ------------------------------------
    def get_company_profile(self, owner_key: str) -> dict:
        with self.conn() as c:
            r = c.execute("SELECT data_json FROM bid_company_profiles WHERE owner_key=?", (owner_key,)).fetchone()
        return _loads(r[0], {}) if r else {}

    def save_company_profile(self, owner_key: str, data: dict, user_id: int | None = None) -> None:
        with self.conn() as c:
            c.execute(
                "INSERT INTO bid_company_profiles (owner_key, data_json, updated_by, updated_at) VALUES (?,?,?,?) "
                "ON CONFLICT (owner_key) DO UPDATE SET data_json=excluded.data_json, updated_by=excluded.updated_by, "
                "updated_at=excluded.updated_at",
                (owner_key, json.dumps(data), user_id, time.time()),
            )
            c.commit()
