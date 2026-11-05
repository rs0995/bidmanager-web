"""FastAPI routes for the Bid Agent on the BidManager server.

Mount from ``api_server.py`` (see bid_agent_server/INTEGRATION.md)::

    import bid_agent.server_routes as bid_agent_routes
    bid_client_router, bid_admin_router = bid_agent_routes.create_routers(require_admin_key)
    app.include_router(bid_client_router)
    app.include_router(bid_admin_router)

Client routes follow client_api conventions: ``x-client-key`` auth, tender
access scoped by the account's sections, 404 for tenders outside them. Work is
owned by the account's organisation (``org:<id>``) or, for individual accounts,
by the user (``user:<id>``), so everyone in an organisation shares one company
profile and one bid pack per tender.
"""

from __future__ import annotations

import os
import shutil
import tempfile
import threading
import time
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from . import agent, company
from .docreader import load_document
from .llm import DEFAULT_MODEL, LLM
from .roles import ROLES
from .store import Store

API_KEY_SETTING = "bid_agent_api_key"
MODEL_SETTING = "bid_agent_model"
STALE_RUN_SEC = 45 * 60

_runs: dict[tuple[str, int], threading.Thread] = {}
_runs_lock = threading.Lock()


class SegmentIn(BaseModel):
    role: str
    start_page: int = Field(ge=1)
    end_page: int = Field(ge=1)
    title: str = ""


class DocumentRolesIn(BaseModel):
    file: str
    segments: list[SegmentIn] = Field(min_length=1, max_length=50)


class ConfigIn(BaseModel):
    api_key: Optional[str] = None
    model: Optional[str] = None


def create_routers(require_admin: Callable[..., Any]) -> tuple[APIRouter, APIRouter]:
    # Imported here so this package can be unit-tested without the server.
    import app_core as core
    import client_api
    import org_access

    client = APIRouter(prefix="/client", tags=["client", "bid-agent"])
    admin = APIRouter(prefix="/admin/bid-agent", tags=["admin", "bid-agent"], dependencies=[Depends(require_admin)])

    def connect():
        conn = core.sqlite3.connect(core.DB_FILE)
        conn.row_factory = core.sqlite3.Row
        return conn

    store = Store(connect)
    try:
        store.init_schema()
    except Exception as e:  # never block server start-up
        print(f"[bid-agent] schema init failed: {e}")

    def setting(key: str, default: str = "") -> str:
        try:
            return str(core.ScraperBackend.get_setting(key, default) or default)
        except Exception:
            return default

    def make_llm(log: Callable[[str], None]) -> LLM:
        return LLM(api_key=setting(API_KEY_SETTING) or os.getenv("ANTHROPIC_API_KEY", ""),
                   model=setting(MODEL_SETTING) or os.getenv("BID_AGENT_MODEL", ""), log=log)

    def account(user_id: int) -> dict:
        with client_api._get_db() as conn:
            return org_access.get_account(conn, user_id)

    def owner_of(user_id: int) -> str:
        acc = account(user_id)
        return f"org:{acc['org_id']}" if acc.get("org_id") is not None else f"user:{user_id}"

    def tender_row(user_id: int, tender_db_id: int) -> dict:
        client_api._require_section(user_id, "projects")
        with client_api._get_db() as conn:
            client_api._require_tender_access(conn, user_id, tender_db_id)
            return dict(client_api._find_tender(conn, tender_db_id))

    def materialize(tender: dict, dest: str) -> int:
        """Copy the tender's stored documents (local disk or Drive) into ``dest``."""
        canonical = str(tender.get("tender_id") or "").strip().upper()
        with client_api._get_db() as conn:
            rows = conn.execute(
                "SELECT d.id,d.file_name,d.local_path,d.drive_file_id FROM downloaded_files d "
                f"WHERE {client_api._document_condition()}",
                (int(tender["id"]), canonical),
            ).fetchall()
        n = 0
        for row in rows:
            data = dict(row)
            name = os.path.basename(str(data.get("file_name") or f"document_{data['id']}")) or f"document_{data['id']}"
            target = os.path.join(dest, f"{data['id']}_{name}")
            try:
                kind, ref = client_api._download_reference(data)
                if kind == "local":
                    shutil.copyfile(ref, target)
                else:
                    import drive_storage

                    _meta, response = drive_storage.open_download(ref)
                    with open(target, "wb") as f:
                        for chunk in drive_storage.iter_download_response(response):
                            f.write(chunk)
                n += 1
            except Exception:
                continue
        return n

    def run_analysis(owner: str, tender: dict, user_id: int, overrides: dict) -> None:
        key = (owner, int(tender["id"]))
        logs: list[str] = []
        last_flush = [0.0]

        def log(msg: str) -> None:
            logs.append(str(msg))
            if time.time() - last_flush[0] > 1.5:
                last_flush[0] = time.time()
                store.save_analysis(owner, tender["id"], status="running", logs=logs[-400:])

        work = tempfile.mkdtemp(prefix="bidpack_")
        try:
            log("Collecting the tender's documents…")
            n = materialize(tender, work)
            if not n:
                raise RuntimeError("No downloaded documents are available for this tender yet. Request the documents first.")
            profile = store.get_company_profile(owner)
            result = agent.analyze_files(work, tender, store, make_llm(log), profile, log=log, overrides=overrides)
            store.save_analysis(owner, tender["id"], status="completed", logs=logs[-400:], result=result, error="")
        except Exception as e:
            logs.append(f"Error: {e}")
            store.save_analysis(owner, tender["id"], status="failed", logs=logs[-400:], error=str(e))
        finally:
            shutil.rmtree(work, ignore_errors=True)
            with _runs_lock:
                _runs.pop(key, None)

    def start(owner: str, tender: dict, user_id: int, overrides: dict) -> dict:
        key = (owner, int(tender["id"]))
        with _runs_lock:
            t = _runs.get(key)
            if t and t.is_alive():
                return {"status": "running"}
            current = store.get_analysis(owner, tender["id"])
            if current and current["status"] == "running" and time.time() - float(current.get("updated_at") or 0) < STALE_RUN_SEC:
                return {"status": "running"}  # running in another worker process
            store.save_analysis(owner, tender["id"], status="running", logs=["Queued…"], error="", started_by=user_id)
            t = threading.Thread(target=run_analysis, args=(owner, tender, user_id, overrides), daemon=True)
            _runs[key] = t
            t.start()
        return {"status": "running"}

    def public(a: Optional[dict], since: int = 0) -> dict:
        if not a:
            return {"status": "none", "logs": [], "next": 0, "result": None, "files": []}
        logs = a.get("logs") or []
        res = a.get("result")
        return {
            "status": a["status"], "error": a.get("error", ""), "updated_at": a.get("updated_at"),
            "logs": logs[since:], "next": len(logs), "result": res,
            "files": agent.output_names(res) if res else [],
        }

    # ------------------------------------------------------------ client
    @client.get("/bid-agent/status")
    def client_bid_status(user_id: int = Depends(client_api.require_client_user)) -> dict:
        acc = account(user_id)
        return {
            "ai_enabled": bool(setting(API_KEY_SETTING) or os.getenv("ANTHROPIC_API_KEY")),
            "model": setting(MODEL_SETTING) or DEFAULT_MODEL,
            "owner": "organisation" if acc.get("org_id") is not None else "individual",
            "can_edit_profile": acc.get("org_id") is None or acc.get("role") == "admin",
            "roles": [{"role": k, "label": v["label"]} for k, v in ROLES.items()],
        }

    @client.get("/bid-agent/analyses")
    def client_bid_analyses(user_id: int = Depends(client_api.require_client_user)) -> dict:
        return {"items": store.list_analyses(owner_of(user_id))}

    @client.post("/tenders/{tender_db_id}/bid-pack")
    def client_bid_pack_start(tender_db_id: int, user_id: int = Depends(client_api.require_client_user)) -> dict:
        tender = tender_row(user_id, tender_db_id)
        owner = owner_of(user_id)
        prev = store.get_analysis(owner, tender_db_id) or {}
        overrides = ((prev.get("result") or {}).get("overrides") or {})
        start(owner, tender, user_id, overrides)
        return public(store.get_analysis(owner, tender_db_id))

    @client.get("/tenders/{tender_db_id}/bid-pack")
    def client_bid_pack(tender_db_id: int, since: int = 0, user_id: int = Depends(client_api.require_client_user)) -> dict:
        tender_row(user_id, tender_db_id)
        return public(store.get_analysis(owner_of(user_id), tender_db_id), max(0, since))

    @client.put("/tenders/{tender_db_id}/bid-pack/documents")
    def client_bid_pack_correct(tender_db_id: int, body: DocumentRolesIn,
                                user_id: int = Depends(client_api.require_client_user)) -> dict:
        tender = tender_row(user_id, tender_db_id)
        owner = owner_of(user_id)
        a = store.get_analysis(owner, tender_db_id)
        if not a or not a.get("result"):
            raise HTTPException(400, "Prepare the bid pack first.")
        bad = [s.role for s in body.segments if s.role not in ROLES]
        if bad:
            raise HTTPException(400, f"Unknown section type: {', '.join(bad)}")
        result = a["result"]
        if body.file not in {d["file"] for d in result.get("documents", [])}:
            raise HTTPException(404, "File not found in this bid pack.")
        segs = [{"role": s.role, "label": ROLES[s.role]["label"], "start_page": s.start_page,
                 "end_page": max(s.start_page, s.end_page), "title": s.title, "source": "manual", "confidence": 1.0}
                for s in body.segments]
        overrides = dict(result.get("overrides") or {})
        overrides[body.file] = segs
        # Remember the employer's wording for these sections (shared learning).
        org_key = result.get("org_key") or ""
        if org_key:
            for s in segs:
                if s["role"] != "other":
                    stem = os.path.splitext(body.file.split("/")[-1])[0]
                    stem = stem.split("_", 1)[1] if "_" in stem and stem.split("_", 1)[0].isdigit() else stem
                    store.learn_alias(org_key, result.get("org_name", ""), s["role"], stem.replace("_", " "))
        start(owner, tender, user_id, overrides)
        return public(store.get_analysis(owner, tender_db_id))

    @client.get("/tenders/{tender_db_id}/bid-pack/files/{name}")
    def client_bid_pack_file(tender_db_id: int, name: str, user_id: int = Depends(client_api.require_client_user)):
        tender_row(user_id, tender_db_id)
        owner = owner_of(user_id)
        a = store.get_analysis(owner, tender_db_id)
        if not a or not a.get("result"):
            raise HTTPException(404, "No bid pack for this tender.")
        profile = store.get_company_profile(owner)
        result = agent.refresh_compliance(a["result"], profile)
        out = tempfile.mkdtemp(prefix="bidpack_out_")
        try:
            path = agent.build_output(result, profile, name, out)
        except FileNotFoundError:
            shutil.rmtree(out, ignore_errors=True)
            raise HTTPException(404, "File not found.")
        media = ("application/zip" if name.endswith(".zip") else
                 "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if name.endswith(".xlsx") else
                 "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        return FileResponse(path, media_type=media, filename=name,
                            background=BackgroundTask(shutil.rmtree, out, True))

    @client.get("/company-profile")
    def client_company_profile(user_id: int = Depends(client_api.require_client_user)) -> dict:
        data = company.empty_profile()
        data.update(store.get_company_profile(owner_of(user_id)))
        acc = account(user_id)
        return {"profile": data, "schema": company.profile_schema(),
                "can_edit": acc.get("org_id") is None or acc.get("role") == "admin"}

    @client.put("/company-profile")
    def client_save_company_profile(body: dict, user_id: int = Depends(client_api.require_client_user)) -> dict:
        acc = account(user_id)
        if acc.get("org_id") is not None and acc.get("role") != "admin":
            raise HTTPException(403, detail={"reason": "org_admin_only",
                                             "message": "Only your organisation's admins can edit the company profile."})
        allowed = {"general", *company.LIST_SECTIONS.keys()}
        clean = {k: v for k, v in (body or {}).items() if k in allowed}
        if len(str(clean)) > 2_000_000:
            raise HTTPException(413, "Company profile is too large.")
        merged = store.get_company_profile(owner_of(user_id))
        merged.update(clean)
        store.save_company_profile(owner_of(user_id), merged, user_id)
        return client_company_profile(user_id)

    # ------------------------------------------------------------- admin
    @admin.get("/config")
    def admin_bid_config() -> dict:
        key = setting(API_KEY_SETTING) or os.getenv("ANTHROPIC_API_KEY", "")
        return {"api_key_set": bool(key), "api_key_hint": (key[:7] + "…" + key[-4:]) if len(key) > 12 else "",
                "api_key_source": "settings" if setting(API_KEY_SETTING) else ("env" if key else ""),
                "model": setting(MODEL_SETTING) or DEFAULT_MODEL, "default_model": DEFAULT_MODEL}

    @admin.put("/config")
    def admin_bid_config_save(body: ConfigIn) -> dict:
        if body.api_key is not None:
            core.ScraperBackend.set_setting(API_KEY_SETTING, body.api_key.strip())
        if body.model is not None:
            core.ScraperBackend.set_setting(MODEL_SETTING, body.model.strip())
        return admin_bid_config()

    @admin.get("/employers")
    def admin_bid_employers() -> list:
        return store.list_orgs()

    @admin.delete("/employers/{org_key}")
    def admin_bid_employer_forget(org_key: str) -> dict:
        store.delete_org(org_key)
        return {"ok": True}

    @admin.get("/forms")
    def admin_bid_forms(org_key: str = "") -> list:
        return store.list_forms(org_key)

    return client, admin
