"""
BidManager Web Backend Ã¢â‚¬" FastAPI REST API
Wraps existing app_core.py ScraperBackend with HTTP endpoints.

Usage:
    pip install fastapi uvicorn python-multipart
    uvicorn api_server:app --reload --port 8000
"""

import os
import sys
import json
import re
import sqlite3
import threading
import base64
import uuid
import shutil
import time
import collections
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Any, Optional, List
from contextlib import contextmanager
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Query, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.routing import Route
from pydantic import BaseModel

# Import your existing backend logic
# Make sure app_core.py is in the same directory or on PYTHONPATH
import app_core as core
import storage_runtime

storage_runtime.require_durable_cloud_database()
import admin_providers
import db_compat
import security
import client_api

# -- Initialise --

core.init_db()

app = FastAPI(
    title="BidManager API",
    version="1.0.0",
    description="REST API for BidManager tender/project management",
)

def _cors_origins() -> list[str]:
    raw = os.getenv("BIDMANAGER_CORS_ORIGINS", "").strip()
    if raw:
        return [origin.strip() for origin in raw.split(",") if origin.strip()]
    return [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:4174",
        "http://127.0.0.1:4174",
        "bidmanager://app",
    ]


# Allow configured frontends to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _request_is_local(request: Request) -> bool:
    return security.is_loopback_host(request.client.host if request.client else "")


def _client_write_keys() -> list[str]:
    return [
        value
        for value in (
            os.getenv("BIDMANAGER_CLIENT_API_KEY", "").strip(),
            os.getenv("ADMIN_API_KEY", "").strip(),
        )
        if value
    ]


@app.middleware("http")
async def _protect_client_mutations(request: Request, call_next):
    """Require a server-side key for every state-changing client API call.

    Local loopback calls remain compatible with the desktop application. Cloud
    deployments fail closed when a write key is missing.
    """
    if not security.is_v1_mutation(request.method, request.url.path):
        return await call_next(request)

    local_loopback = not security.is_cloud_environment() and _request_is_local(request)
    if not local_loopback:
        expected_keys = _client_write_keys()
        if not expected_keys:
            return JSONResponse(
                status_code=503,
                content={"detail": "Client write authentication is not configured on the backend."},
            )

        provided = (
            request.headers.get("x-api-key")
            or request.headers.get("x-admin-key")
            or ""
        ).strip()
        if not any(security.secure_equals(provided, expected) for expected in expected_keys):
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or missing client write key."},
            )
    if core.setting_bool("read_only_mode", False):
        return JSONResponse(
            status_code=423,
            content={"detail": "The backend is in read-only mode."},
        )
    return await call_next(request)


# -- Admin metrics: request-latency tracking + process resource stats --
# Lightweight, in-memory only (this is a standalone admin-console backend, not the
# production service) so /admin/metrics can report real numbers instead of mock ones.

_REQUEST_METRICS_WINDOW_SECONDS = 3600
_request_metrics: "collections.deque" = collections.deque()
_request_metrics_lock = threading.Lock()


@app.middleware("http")
async def _admin_request_metrics_middleware(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    duration_ms = (time.time() - start) * 1000
    with _request_metrics_lock:
        _request_metrics.append((start, duration_ms, response.status_code))
        cutoff = start - _REQUEST_METRICS_WINDOW_SECONDS
        while _request_metrics and _request_metrics[0][0] < cutoff:
            _request_metrics.popleft()
    return response


def _request_metrics_snapshot() -> dict:
    with _request_metrics_lock:
        entries = list(_request_metrics)
    durations = sorted(d for _, d, _ in entries)
    total = len(entries)
    errors = sum(1 for _, _, status in entries if status >= 500)

    def _pct(p):
        if not durations:
            return None
        idx = min(len(durations) - 1, int(round(p * (len(durations) - 1))))
        return round(durations[idx], 1)

    return {
        "requests1h": total,
        "p95": _pct(0.95),
        "p99": _pct(0.99),
        "errorRate": round((errors / total) * 100, 2) if total else 0,
    }


try:
    import psutil as _psutil

    _PSUTIL_PROCESS = _psutil.Process()
    _PSUTIL_PROCESS.cpu_percent(interval=None)  # prime the internal sample window
except Exception:
    _psutil = None
    _PSUTIL_PROCESS = None


def _process_resource_snapshot() -> dict:
    if not _PSUTIL_PROCESS:
        return {"cpuPct": None, "memPct": None}
    try:
        return {
            "cpuPct": round(_PSUTIL_PROCESS.cpu_percent(interval=None), 1),
            "memPct": round(_PSUTIL_PROCESS.memory_percent(), 1),
        }
    except Exception:
        return {"cpuPct": None, "memPct": None}


def _candidate_frontend_dirs() -> list[str]:
    # This copy serves its own console UI (Server UI/dist), not the main app's
    # frontend/dist — "frontend" below just names the bundle-internal folder the
    # PyInstaller spec copies the built UI into, kept for convention/consistency.
    base = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(base)
    candidates = [
        os.path.join(project_root, "dist"),
        os.path.join(base, "dist"),
        os.path.join(os.getcwd(), "dist"),
    ]
    exe_dir = os.path.dirname(os.path.abspath(sys.executable)) if getattr(sys, "executable", None) else ""
    if exe_dir:
        candidates.append(os.path.join(exe_dir, "frontend", "dist"))
        candidates.append(os.path.join(os.path.dirname(exe_dir), "frontend", "dist"))
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidates.append(os.path.join(meipass, "frontend", "dist"))
    # Keep order while removing duplicates
    seen = set()
    out = []
    for path in candidates:
        if path not in seen:
            seen.add(path)
            out.append(path)
    return out


def _mount_frontend_if_available():
    for frontend_dist in _candidate_frontend_dirs():
        index_html = os.path.join(frontend_dist, "index.html")
        if not os.path.isfile(index_html):
            continue

        assets_dir = os.path.join(frontend_dist, "assets")
        if os.path.isdir(assets_dir):
            app.mount("/assets", StaticFiles(directory=assets_dir), name="static_assets")

        async def _serve_spa(request):
            path = request.path_params.get("path", "")
            file_path = os.path.join(frontend_dist, path)
            if path and os.path.isfile(file_path):
                return FileResponse(file_path)
            return FileResponse(index_html)

        # Add catch-all after API routes.
        app.router.routes.append(Route("/{path:path}", _serve_spa))
        break




# -- Database Helper --

@contextmanager
def get_db():
    conn = sqlite3.connect(core.DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


# Client routes are isolated in a router that exposes read-only tender data and
# tokenized access to files already present in storage. Register before the SPA
# catch-all is mounted at process startup.
app.include_router(client_api.router)
app.include_router(client_api.download_router)


# -- Pydantic Models --

class WebsiteOut(BaseModel):
    id: int
    name: str
    url: str
    status_url: str

class WebsiteCreate(BaseModel):
    name: str
    url: str
    status_url: str = ""

class OrgOut(BaseModel):
    id: int
    website_id: int
    name: str
    tender_count: int
    is_selected: bool
    last_scraped_at: Optional[float] = None

class OrgToggle(BaseModel):
    is_selected: bool

class TenderOut(BaseModel):
    id: int
    website_id: int
    org_chain: Optional[str]
    tender_id: Optional[str]
    title: Optional[str]
    work_description: Optional[str]
    tender_value: Optional[str]
    emd: Optional[str]
    closing_date: Optional[str]
    opening_date: Optional[str]
    published_date: Optional[str]
    pre_bid_meeting_date: Optional[str]
    location: Optional[str]
    tender_category: Optional[str]
    status: Optional[str]
    is_archived: bool
    is_downloaded: bool
    is_bookmarked: bool
    tender_url: Optional[str]
    folder_path: Optional[str]
    normalized_tender_id: Optional[str] = None
    tender_key: Optional[str] = None
    first_seen_at: Optional[float] = None
    last_seen_at: Optional[float] = None
    last_scraped_at: Optional[float] = None
    last_changed_at: Optional[float] = None
    scrape_interval_minutes: int = 0
    next_scrape_at: float = 0
    scrape_enabled: bool = False
    download_status: str = "not_downloaded"
    initial_download_completed_at: Optional[float] = None
    last_update_checked_at: Optional[float] = None
    last_download_error: Optional[str] = None

class TenderPatch(BaseModel):
    is_downloaded: Optional[bool] = None
    is_bookmarked: Optional[bool] = None
    scrape_interval_minutes: Optional[int] = None
    scrape_enabled: Optional[bool] = None


class SingleTenderDownloadRequest(BaseModel):
    mode: str = "auto"

class ProjectTenderFetchRequest(BaseModel):
    tender_id: str
    scrape_on_miss: bool = True

class ProjectTenderFetchFileOut(BaseModel):
    file_name: str
    file_type: str
    local_path: str
    downloaded_at: str

class ProjectTenderFetchResponse(BaseModel):
    found: bool
    source: str
    tender: Optional[TenderOut]
    files: List[ProjectTenderFetchFileOut]
    message: Optional[str] = None
    scraper_started: bool = False

class ProjectOut(BaseModel):
    id: int
    title: Optional[str]
    client_name: Optional[str]
    source_tender_id: Optional[str]
    project_value: Optional[str]
    prebid: Optional[str]
    deadline: Optional[str]
    status: Optional[str]
    description: Optional[str]
    folder_path: Optional[str]

class ProjectCreate(BaseModel):
    title: str
    client_name: str = ""
    source_tender_id: str = ""
    project_value: str = ""
    prebid: str = ""
    deadline: str = ""
    description: str = ""
    status: str = "Active"

class ProjectPatch(BaseModel):
    title: Optional[str] = None
    client_name: Optional[str] = None
    source_tender_id: Optional[str] = None
    project_value: Optional[str] = None
    prebid: Optional[str] = None
    deadline: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    folder_path: Optional[str] = None

class ChecklistItemOut(BaseModel):
    id: int
    project_id: int
    sr_no: int
    req_file_name: Optional[str]
    description: Optional[str]
    subfolder: Optional[str]
    linked_file_path: Optional[str]
    status: str


class ChecklistItemCreate(BaseModel):
    sr_no: Optional[int] = None
    req_file_name: str = ""
    description: str = ""
    subfolder: str = "Main"
    linked_file_path: str = ""
    status: str = "Pending"


class ChecklistItemPatch(BaseModel):
    sr_no: Optional[int] = None
    req_file_name: Optional[str] = None
    description: Optional[str] = None
    subfolder: Optional[str] = None
    linked_file_path: Optional[str] = None
    status: Optional[str] = None

class DashboardStats(BaseModel):
    active_tenders: int
    archived_tenders: int
    active_projects: int
    bookmarked_tenders: int
    total_pipeline_value: int
    websites: List[dict]
    upcoming_deadlines: List[dict]


class LiveLogEntry(BaseModel):
    seq: int
    ts: float  # epoch seconds when the line was emitted
    text: str


class LiveLogsResponse(BaseModel):
    lines: List[str]  # kept for older clients
    entries: List[LiveLogEntry] = []
    next_seq: int

class TemplateOut(BaseModel):
    id: int
    template_no: Optional[int]
    organization: str
    template_name: str
    description: Optional[str]
    notes: Optional[str]

class TemplateCreate(BaseModel):
    template_no: Optional[int] = None
    organization: str
    template_name: str
    description: Optional[str] = None
    notes: Optional[str] = None

class TemplatePatch(BaseModel):
    template_no: Optional[int] = None
    organization: Optional[str] = None
    template_name: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None

class TemplateItemOut(BaseModel):
    id: int
    template_id: int
    sr_no: Optional[int]
    req_file_name: Optional[str]
    description: Optional[str]
    subfolder: Optional[str]

class TemplateItemCreate(BaseModel):
    sr_no: Optional[int] = None
    req_file_name: Optional[str] = None
    description: Optional[str] = None
    subfolder: Optional[str] = None

class SaveAsTemplateRequest(BaseModel):
    template_no: Optional[int] = None
    organization: str
    template_name: str
    description: Optional[str] = None
    notes: Optional[str] = None

class JobStartResponse(BaseModel):
    job_id: str
    status: str


class FetchSelectedTendersRequest(BaseModel):
    org_ids: List[int]
    download_after: bool = False


class BatchTenderDownloadRequest(BaseModel):
    tender_ids: Optional[List[int]] = None
    all_tenders: bool = False
    mode: str = "auto"


class BatchTenderScheduleRequest(BaseModel):
    tender_ids: List[int]
    interval_minutes: int
    enabled: bool = True


class SavedCustomJobRequest(BaseModel):
    owner_name: str
    name: str
    website_id: int
    job_type: str
    org_ids: Optional[List[int]] = None
    tender_ids: Optional[List[int]] = None
    # Retained for compatibility with older clients; new custom jobs always use
    # explicit organization/tender selections.
    all_organizations: bool = False
    all_tenders: bool = False
    download_mode: str = "full"
    schedule_enabled: bool = False
    schedule_mode: str = ""
    interval_minutes: int = 0
    scheduled_for_at: float = 0


class RestoreProjectsResponse(BaseModel):
    root_folder: str
    scanned_folders: int
    created_projects: int
    updated_projects: int
    restored_checklist_items: int


class StorageItemOut(BaseModel):
    name: str
    rel_path: str
    is_dir: bool
    size_bytes: int
    modified_at: str


class StorageListResponse(BaseModel):
    root_folder: str
    current_rel_path: str
    parent_rel_path: str
    items: List[StorageItemOut]


class StorageDeleteFolderRequest(BaseModel):
    rel_path: str


class StorageDeleteOlderRequest(BaseModel):
    days: int = 30
    rel_path: str = ""


class StorageDeleteOlderResponse(BaseModel):
    deleted_files: int
    deleted_dirs: int


class CaptchaPendingResponse(BaseModel):
    request_id: str
    image_base64: str
    context: str = "captcha"


class CaptchaSubmitRequest(BaseModel):
    request_id: str
    text: str


class ClearSavedDataRequest(BaseModel):
    clear_orgs: bool = False
    clear_active: bool = False
    clear_archived: bool = False


# -- Websites --

@app.get("/v1/websites", response_model=List[WebsiteOut])
def list_websites():
    try:
        core.ScraperBackend.ensure_default_websites_logic()
    except Exception:
        pass
    with get_db() as conn:
        rows = conn.execute("SELECT id, name, url, status_url FROM websites").fetchall()
    return [dict(r) for r in rows]


@app.post("/v1/websites", response_model=WebsiteOut)
def create_website(body: WebsiteCreate):
    nm = str(body.name or "").strip()
    u = str(body.url or "").strip()
    su = str(body.status_url or "").strip()
    if not nm or not u:
        raise HTTPException(400, "Name and URL are required")
    ok = core.ScraperBackend.add_website_logic(body.name, body.url, body.status_url)
    if not ok:
        raise HTTPException(400, "Failed to add website (duplicate name/url or DB error)")
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, name, url, status_url FROM websites WHERE TRIM(name)=?",
            (nm,),
        ).fetchone()
    if not row:
        raise HTTPException(500, "Website insert did not return a row")
    return dict(row)


@app.delete("/v1/websites/{website_id}")
def delete_website(website_id: int):
    ok = core.ScraperBackend.delete_website_logic(website_id)
    if not ok:
        raise HTTPException(400, "Failed to delete website")
    return {"ok": True}


@app.api_route("/v1/data/clear", methods=["GET", "POST"])
def clear_saved_data(
    body: Optional[ClearSavedDataRequest] = None,
    clear_orgs: bool = False,
    clear_active: bool = False,
    clear_archived: bool = False,
):
    clear_orgs_val = bool(body.clear_orgs) if body is not None else bool(clear_orgs)
    clear_active_val = bool(body.clear_active) if body is not None else bool(clear_active)
    clear_archived_val = bool(body.clear_archived) if body is not None else bool(clear_archived)
    result = core.ScraperBackend.clear_saved_scraper_details_logic(
        clear_orgs=clear_orgs_val,
        clear_active=clear_active_val,
        clear_archived=clear_archived_val,
    )
    if result is None:
        raise HTTPException(500, "Failed to clear selected data")
    return {"ok": True, "result": result}


# -- Organizations --

@app.get("/v1/websites/{website_id}/organizations", response_model=List[OrgOut])
def list_organizations(website_id: int, search: str = ""):
    with get_db() as conn:
        sql = (
            "SELECT id, website_id, name, tender_count, is_selected, last_scraped_at "
            "FROM organizations WHERE website_id=?"
        )
        params = [website_id]
        if search:
            sql += " AND name LIKE ?"
            params.append(f"%{search}%")
        sql += " ORDER BY name"
        rows = conn.execute(sql, params).fetchall()
    return [
        {**dict(r), "is_selected": bool(r["is_selected"])}
        for r in rows
    ]


@app.patch("/v1/organizations/{org_id}")
def toggle_organization(org_id: int, body: OrgToggle):
    with get_db() as conn:
        conn.execute(
            "UPDATE organizations SET is_selected=? WHERE id=?",
            (int(body.is_selected), org_id),
        )
        conn.commit()
    return {"ok": True}


# -- Tenders --

@app.get("/v1/websites/{website_id}/tenders", response_model=List[TenderOut])
def list_tenders(
    website_id: int,
    archived: Optional[bool] = None,
    search: str = "",
    org: str = "",
    location: str = "",
    category: str = "",
    bookmarked: Optional[bool] = None,
    sort: str = "closing_date",
    order: str = "asc",
    page: int = 1,
    limit: int = 200,
):
    with get_db() as conn:
        conditions = ["website_id=?"]
        params: list = [website_id]

        if archived is not None:
            conditions.append("COALESCE(is_archived,0)=?")
            params.append(int(archived))

        if search:
            conditions.append(
                "(tender_id LIKE ? OR title LIKE ? OR work_description LIKE ? OR org_chain LIKE ?)"
            )
            q = f"%{search}%"
            params.extend([q, q, q, q])

        if org:
            conditions.append("org_chain LIKE ?")
            params.append(f"%{org}%")

        if location:
            conditions.append("location LIKE ?")
            params.append(f"%{location}%")

        if category:
            conditions.append("tender_category LIKE ?")
            params.append(f"%{category}%")

        if bookmarked is not None:
            conditions.append("COALESCE(is_bookmarked,0)=?")
            params.append(int(bookmarked))

        # Whitelist sort columns
        allowed_sorts = {
            "tender_id", "title", "tender_value", "closing_date",
            "opening_date", "org_chain", "status", "published_date",
            "location", "tender_category",
        }
        sort_col = sort if sort in allowed_sorts else "closing_date"
        sort_dir = "DESC" if order.lower() == "desc" else "ASC"

        offset = (max(1, page) - 1) * limit

        sql = (
            "SELECT id, website_id, org_chain, tender_id, title, work_description, "
            "tender_value, emd, closing_date, opening_date, published_date, "
            "pre_bid_meeting_date, location, tender_category, status, "
            "COALESCE(is_archived,0) as is_archived, "
            "COALESCE(is_downloaded,0) as is_downloaded, "
            "COALESCE(is_bookmarked,0) as is_bookmarked, "
            "tender_url, COALESCE(folder_path,'') as folder_path, normalized_tender_id, tender_key, "
            "first_seen_at, last_seen_at, last_scraped_at, last_changed_at, "
            "COALESCE(scrape_interval_minutes,0) AS scrape_interval_minutes, "
            "COALESCE(next_scrape_at,0) AS next_scrape_at, "
            "COALESCE(scrape_enabled,0) AS scrape_enabled, "
            "COALESCE(download_status,'not_downloaded') AS download_status, "
            "initial_download_completed_at, last_update_checked_at, last_download_error "
            f"FROM tenders WHERE {' AND '.join(conditions)} "
            f"ORDER BY {sort_col} {sort_dir} "
            f"LIMIT ? OFFSET ?"
        )
        params.extend([limit, offset])
        rows = conn.execute(sql, params).fetchall()

    return [
        {
            **dict(r),
            "is_archived": bool(r["is_archived"]),
            "is_downloaded": bool(r["is_downloaded"]),
            "is_bookmarked": bool(r["is_bookmarked"]),
            "scrape_enabled": bool(r["scrape_enabled"]),
        }
        for r in rows
    ]


@app.patch("/v1/tenders/{tender_db_id}")
def patch_tender(tender_db_id: int, body: TenderPatch):
    updates = []
    params = []
    if body.is_downloaded is not None:
        updates.append("is_downloaded=?")
        params.append(int(body.is_downloaded))
    if body.is_bookmarked is not None:
        updates.append("is_bookmarked=?")
        params.append(int(body.is_bookmarked))
    schedule_requested = body.scrape_interval_minutes is not None or body.scrape_enabled is not None
    if body.scrape_interval_minutes is not None and int(body.scrape_interval_minutes) < 0:
        raise HTTPException(400, "scrape_interval_minutes cannot be negative")
    if schedule_requested:
        with get_db() as conn:
            row = conn.execute(
                "SELECT COALESCE(scrape_interval_minutes,0),COALESCE(scrape_enabled,0) FROM tenders WHERE id=?",
                (tender_db_id,),
            ).fetchone()
        if not row:
            raise HTTPException(404, "Tender not found")
        interval = int(body.scrape_interval_minutes if body.scrape_interval_minutes is not None else row[0] or 0)
        enabled = bool(body.scrape_enabled if body.scrape_enabled is not None else row[1])
        if enabled and interval <= 0:
            raise HTTPException(400, "A positive scrape_interval_minutes is required when scheduling is enabled")
        if not core.ScraperBackend.set_tender_scrape_schedule(tender_db_id, interval, enabled):
            raise HTTPException(404, "Tender not found")
    if not updates and not schedule_requested:
        raise HTTPException(400, "Nothing to update")
    if updates:
        params.append(tender_db_id)
        with get_db() as conn:
            conn.execute(f"UPDATE tenders SET {', '.join(updates)} WHERE id=?", params)
            conn.commit()
    return {"ok": True}


@app.get("/v1/tenders/{tender_db_id}/history")
def tender_history(tender_db_id: int, limit: int = 100):
    safe_limit = max(1, min(500, int(limit)))
    with get_db() as conn:
        exists = conn.execute("SELECT id FROM tenders WHERE id=?", (tender_db_id,)).fetchone()
        if not exists:
            raise HTTPException(404, "Tender not found")
        rows = conn.execute(
            "SELECT id,tender_db_id,tender_key,scraped_at,content_hash,changed_fields,snapshot_json "
            "FROM tender_history WHERE tender_db_id=? ORDER BY scraped_at DESC,id DESC LIMIT ?",
            (tender_db_id, safe_limit),
        ).fetchall()
    return [
        {
            "id": int(row[0]),
            "tender_db_id": int(row[1]),
            "tender_key": row[2],
            "scraped_at": float(row[3]),
            "content_hash": row[4],
            "changed_fields": _json_load(row[5], []),
            "snapshot": _json_load(row[6], {}),
        }
        for row in rows
    ]


@app.post("/v1/tenders/{tender_db_id}/archive")
def archive_tender(tender_db_id: int):
    core.ScraperBackend.archive_tender_logic(tender_db_id)
    return {"ok": True}


@app.api_route("/v1/tenders/{tender_db_id}/download", methods=["POST", "GET"], response_model=JobStartResponse)
def download_single_tender(
    tender_db_id: int,
    body: Optional[SingleTenderDownloadRequest] = None,
    mode: str = "auto",
):
    mode_raw = str(body.mode or "").strip() if body is not None else str(mode or "").strip()
    mode = str(mode_raw or "auto").strip().lower()
    if mode not in {"auto", "full", "update"}:
        raise HTTPException(400, "mode must be 'auto', 'full', or 'update'")
    return _enqueue_job("download_single_tender", {"tender_db_id": tender_db_id, "mode": mode})


def _find_tender_with_files(conn: sqlite3.Connection, raw_tender_id: str):
    tender_id = str(raw_tender_id or "").strip()
    if not tender_id:
        return None, []
    row = conn.execute(
        "SELECT id, website_id, org_chain, tender_id, title, work_description, "
        "tender_value, emd, closing_date, opening_date, published_date, "
        "pre_bid_meeting_date, location, tender_category, status, "
        "COALESCE(is_archived,0) as is_archived, "
        "COALESCE(is_downloaded,0) as is_downloaded, "
        "COALESCE(is_bookmarked,0) as is_bookmarked, "
        "tender_url, COALESCE(folder_path,'') as folder_path "
        "FROM tenders WHERE LOWER(TRIM(COALESCE(tender_id,'')))=? "
        "ORDER BY COALESCE(is_downloaded,0) DESC, COALESCE(is_archived,0) ASC, id DESC LIMIT 1",
        (tender_id.lower(),),
    ).fetchone()
    if row is None:
        row = conn.execute(
            "SELECT id, website_id, org_chain, tender_id, title, work_description, "
            "tender_value, emd, closing_date, opening_date, published_date, "
            "pre_bid_meeting_date, location, tender_category, status, "
            "COALESCE(is_archived,0) as is_archived, "
            "COALESCE(is_downloaded,0) as is_downloaded, "
            "COALESCE(is_bookmarked,0) as is_bookmarked, "
            "tender_url, COALESCE(folder_path,'') as folder_path "
            "FROM tenders WHERE LOWER(COALESCE(tender_id,'')) LIKE ? "
            "ORDER BY COALESCE(is_downloaded,0) DESC, COALESCE(is_archived,0) ASC, id DESC LIMIT 1",
            (f"%{tender_id.lower()}%",),
        ).fetchone()
    if row is None:
        return None, []

    row_dict = dict(row)
    row_dict["is_archived"] = bool(row_dict.get("is_archived"))
    row_dict["is_downloaded"] = bool(row_dict.get("is_downloaded"))
    row_dict["is_bookmarked"] = bool(row_dict.get("is_bookmarked"))

    tender_key = str(row_dict.get("tender_id") or "").strip()
    file_rows = conn.execute(
        "SELECT COALESCE(file_name,'') as file_name, COALESCE(file_type,'document') as file_type, "
        "COALESCE(local_path,'') as local_path, COALESCE(downloaded_at,'') as downloaded_at "
        "FROM downloaded_files WHERE TRIM(COALESCE(tender_id,''))=? "
        "ORDER BY downloaded_at DESC",
        (tender_key,),
    ).fetchall()
    files = [dict(f) for f in file_rows]

    if not files:
        folder_path = str(row_dict.get("folder_path") or "").strip()
        if folder_path and os.path.isdir(folder_path):
            for root, _dirs, names in os.walk(folder_path):
                for name in names:
                    abs_path = os.path.join(root, name)
                    files.append(
                        {
                            "file_name": name,
                            "file_type": "document",
                            "local_path": abs_path,
                            "downloaded_at": "",
                        }
                    )
    return row_dict, files


def _find_active_tender(conn: sqlite3.Connection, raw_tender_id: str):
    tender_id = str(raw_tender_id or "").strip()
    if not tender_id:
        return None
    base_select = (
        "SELECT id, website_id, org_chain, tender_id, title, work_description, "
        "tender_value, emd, closing_date, opening_date, published_date, "
        "pre_bid_meeting_date, location, tender_category, status, "
        "COALESCE(is_archived,0) as is_archived, "
        "COALESCE(is_downloaded,0) as is_downloaded, "
        "COALESCE(is_bookmarked,0) as is_bookmarked, "
        "tender_url, COALESCE(folder_path,'') as folder_path "
        "FROM tenders WHERE COALESCE(is_archived,0)=0 "
    )
    row = conn.execute(
        base_select
        + "AND LOWER(TRIM(COALESCE(tender_id,'')))=? "
        "ORDER BY COALESCE(is_downloaded,0) DESC, id DESC LIMIT 1",
        (tender_id.lower(),),
    ).fetchone()
    if row is None:
        row = conn.execute(
            base_select
            + "AND LOWER(TRIM(COALESCE(title,'')))=? "
            "ORDER BY COALESCE(is_downloaded,0) DESC, id DESC LIMIT 1",
            (tender_id.lower(),),
        ).fetchone()
    if row is None:
        row = conn.execute(
            base_select
            + "AND (INSTR(LOWER(COALESCE(tender_id,'')), LOWER(?)) > 0 "
            "OR INSTR(LOWER(?), LOWER(COALESCE(tender_id,''))) > 0) "
            "ORDER BY COALESCE(is_downloaded,0) DESC, id DESC LIMIT 1",
            (tender_id, tender_id),
        ).fetchone()
    if row is None:
        return None
    row_dict = dict(row)
    row_dict["is_archived"] = bool(row_dict.get("is_archived"))
    row_dict["is_downloaded"] = bool(row_dict.get("is_downloaded"))
    row_dict["is_bookmarked"] = bool(row_dict.get("is_bookmarked"))
    return row_dict


def _collect_files_from_folder(folder_path: str):
    out = []
    root = str(folder_path or "").strip()
    if not root or not os.path.isdir(root):
        return out
    for base, _dirs, names in os.walk(root):
        for name in names:
            abs_path = os.path.join(base, name)
            out.append(
                {
                    "file_name": name,
                    "file_type": "document",
                    "local_path": abs_path,
                    "downloaded_at": "",
                }
            )
    return out


def _folder_has_files(folder_path: str) -> bool:
    root = str(folder_path or "").strip()
    if not root or not os.path.isdir(root):
        return False
    try:
        for _base, _dirs, names in os.walk(root):
            if names:
                return True
    except Exception:
        return False
    return False


def _copy_special_tender_docs(src_root: str, dest_root: str) -> int:
    src = str(src_root or "").strip()
    dst = str(dest_root or "").strip()
    if not src or not os.path.isdir(src) or not dst:
        return 0
    os.makedirs(dst, exist_ok=True)
    copied = 0
    keywords = ("corrigendum", "corrigenda", "addendum", "addenda", "prebid", "pre-bid", "pre bid")
    excluded_parts = {"ready docs", "tender docs", "working docs"}
    for root_dir, _dirs, files in os.walk(src):
        rel_dir = os.path.relpath(root_dir, src)
        rel_dir_low = str(rel_dir or "").lower()
        if any(part in rel_dir_low for part in excluded_parts):
            continue
        for name in files:
            src_file = os.path.join(root_dir, name)
            rel_path = os.path.relpath(src_file, src)
            rel_low = str(rel_path or "").lower()
            if not any(k in rel_low for k in keywords):
                continue
            dst_file = os.path.join(dst, rel_path)
            os.makedirs(os.path.dirname(dst_file), exist_ok=True)
            try:
                if os.path.exists(dst_file):
                    if (
                        os.path.getsize(dst_file) == os.path.getsize(src_file)
                        and int(os.path.getmtime(dst_file)) == int(os.path.getmtime(src_file))
                    ):
                        continue
                shutil.copy2(src_file, dst_file)
                copied += 1
            except Exception:
                continue
    return copied


def _guess_file_type_from_name(name: str) -> str:
    txt = str(name or "").lower()
    if any(k in txt for k in ("corrigendum", "corrigenda", "addendum", "addenda", "prebid", "pre-bid", "pre bid")):
        return "corrigendum"
    return "document"


def _ensure_download_log_entries_for_folder(conn: sqlite3.Connection, tender_id: str, folder_path: str) -> int:
    tid = str(tender_id or "").strip()
    root = str(folder_path or "").strip()
    if not tid or not root or not os.path.isdir(root):
        return 0
    inserted = 0
    for base, _dirs, names in os.walk(root):
        for name in names:
            fpath = os.path.join(base, name)
            ftype = _guess_file_type_from_name(name)
            try:
                before = conn.total_changes
                conn.execute(
                    "INSERT OR IGNORE INTO downloaded_files (tender_id, file_name, file_type, source_url, local_path) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (tid, name, ftype, "", fpath),
                )
                inserted += int(conn.total_changes > before)
            except Exception:
                continue
    return inserted


def _safe_tender_folder_name(tender_id: str) -> str:
    raw = str(tender_id or "").strip()
    if not raw:
        return "Tender"
    cleaned = "".join("" if ch in '<>:"/\\|?*' else ch for ch in raw).strip(" .")
    return cleaned or "Tender"


def _normalize_id_token(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(text or "").lower())


def _find_download_folder_by_tender_id(tender_id: str) -> str:
    tid_raw = str(tender_id or "").strip()
    if not tid_raw:
        return ""
    root = core._resolve_path(core.BASE_DOWNLOAD_DIRECTORY)
    if not root or not os.path.isdir(root):
        return ""
    target = _normalize_id_token(tid_raw)
    best = ""
    best_score = -1
    try:
        for name in os.listdir(root):
            full = os.path.join(root, name)
            if not os.path.isdir(full):
                continue
            n = _normalize_id_token(name)
            if not n:
                continue
            score = -1
            if n == target:
                score = 100
            elif target and (target in n or n in target):
                score = min(len(n), len(target))
            if score > best_score:
                best = full
                best_score = score
    except Exception:
        return ""
    return best if best_score >= 0 else ""


def _resolve_active_download_folder(tender_id: str, db_folder_path: str = "") -> str:
    preferred = str(db_folder_path or "").strip()
    if preferred and os.path.isdir(preferred):
        return preferred
    matched = _find_download_folder_by_tender_id(tender_id)
    if matched and os.path.isdir(matched):
        return matched
    safe_id = _safe_tender_folder_name(tender_id)
    fallback = core._resolve_path(os.path.join(core.BASE_DOWNLOAD_DIRECTORY, safe_id))
    if fallback and os.path.isdir(fallback):
        return fallback
    return ""


def _next_available_path(dest_path: str) -> str:
    base = str(dest_path or "").strip()
    if not base:
        return ""
    if not os.path.exists(base):
        return base
    n = 1
    while True:
        candidate = f"{base}_{n}"
        if not os.path.exists(candidate):
            return candidate
        n += 1


def _move_folder_into_parent(src_dir: str, dest_parent_dir: str) -> str:
    src = str(src_dir or "").strip()
    parent = str(dest_parent_dir or "").strip()
    if not src or not parent or not os.path.isdir(src):
        return ""
    os.makedirs(parent, exist_ok=True)
    folder_name = os.path.basename(os.path.normpath(src))
    desired = os.path.join(parent, folder_name)
    source_norm = os.path.normcase(os.path.normpath(src))
    desired_norm = os.path.normcase(os.path.normpath(desired))
    if source_norm == desired_norm and os.path.isdir(desired):
        return desired
    target = _next_available_path(desired)
    shutil.move(src, target)
    return target


def _copy_missing_tree(src_dir: str, dest_dir: str) -> int:
    src = str(src_dir or "").strip()
    dst = str(dest_dir or "").strip()
    if not src or not dst or not os.path.isdir(src):
        return 0
    os.makedirs(dst, exist_ok=True)
    copied = 0
    src_norm = os.path.normcase(os.path.normpath(src))
    for base, dirs, files in os.walk(src):
        rel = os.path.relpath(base, src)
        target_base = dst if rel in (".", "") else os.path.join(dst, rel)
        os.makedirs(target_base, exist_ok=True)
        for d in dirs:
            os.makedirs(os.path.join(target_base, d), exist_ok=True)
        for f in files:
            sfile = os.path.join(base, f)
            dfile = os.path.join(target_base, f)
            if os.path.exists(dfile):
                continue
            # Avoid self-copy in edge cases where src and dst overlap.
            if os.path.normcase(os.path.normpath(sfile)).startswith(src_norm) and _path_eq(sfile, dfile):
                continue
            shutil.copy2(sfile, dfile)
            copied += 1
    return copied


def _has_download_log_for_tender(conn: sqlite3.Connection, tender_id: str) -> bool:
    tid = str(tender_id or "").strip().lower()
    if not tid:
        return False
    row = conn.execute(
        "SELECT COUNT(*) as c FROM downloaded_files "
        "WHERE LOWER(TRIM(COALESCE(tender_id,'')))=?",
        (tid,),
    ).fetchone()
    return bool(row and int(row["c"] or 0) > 0)


def _run_main_scraper_for_tender_to_folder(
    tender_id: str,
    destination_folder: str,
    mode: str,
) -> bool:
    tid = str(tender_id or "").strip()
    dest = str(destination_folder or "").strip()
    mode_txt = str(mode or "").strip().lower()
    if mode_txt not in {"full", "update"}:
        mode_txt = "full"
    if not tid or not dest:
        return False
    os.makedirs(dest, exist_ok=True)

    conn = sqlite3.connect(core.DB_FILE)
    c = conn.cursor()
    row = c.execute(
        "SELECT id, website_id, COALESCE(is_downloaded,0), COALESCE(folder_path,'') "
        "FROM tenders WHERE LOWER(TRIM(COALESCE(tender_id,'')))=? "
        "ORDER BY COALESCE(is_downloaded,0) DESC, id DESC LIMIT 1",
        (tid.lower(),),
    ).fetchone()
    if not row:
        conn.close()
        core.log_to_gui(f"Project fetch: tender not found for id '{tid}'.")
        return False
    target_db_id, website_id, old_selected, old_folder = row
    conn.close()

    ok = False
    try:
        conn = sqlite3.connect(core.DB_FILE)
        c = conn.cursor()
        c.execute(
            "UPDATE tenders SET is_downloaded=1, folder_path=? WHERE id=?",
            (dest, target_db_id),
        )
        conn.commit()
        conn.close()

        core.ScraperBackend.download_tenders_logic(
            int(website_id),
            target_db_ids=[int(target_db_id)],
            forced_mode=mode_txt,
        )
        ok = True
    finally:
        conn = sqlite3.connect(core.DB_FILE)
        c = conn.cursor()
        c.execute(
            "UPDATE tenders SET is_downloaded=?, folder_path=? WHERE id=?",
            (int(old_selected or 0), str(old_folder or "").strip(), int(target_db_id)),
        )
        conn.commit()
        conn.close()
    return ok


def _using_drive_projects() -> bool:
    return admin_providers.active_storage_provider().metadata()["provider"] == "google-drive"


def _sync_project_tender_through_drive(project_id: int, active_tender: dict, project_root: str, *, force_update: bool) -> dict:
    tender_id = str(active_tender.get("tender_id") or "").strip()
    tender_db_id = int(active_tender.get("id") or 0)
    website_id = int(active_tender.get("website_id") or 0)
    if not tender_id or not tender_db_id or not website_id:
        return {"found": False, "source": "active_not_found", "tender": None, "files": []}

    with get_db() as check_conn:
        has_files = _has_download_log_for_tender(check_conn, tender_id)
    scraper_started = force_update or not has_files
    if scraper_started:
        with get_db() as select_conn:
            select_conn.execute("UPDATE tenders SET is_downloaded=1 WHERE id=?", (tender_db_id,))
            select_conn.commit()
        core.ScraperBackend.download_tenders_logic(
            website_id,
            target_db_ids=[tender_db_id],
            forced_mode="update" if has_files else "full",
        )

    with get_db() as final_conn:
        copied = _copy_downloaded_tender_docs_to_project(final_conn, tender_id, project_root)
        refreshed, files = _find_tender_with_files(final_conn, tender_id)
        if refreshed:
            final_conn.execute(
                "UPDATE projects SET title=?, client_name=?, project_value=?, prebid=?, deadline=?, description=? WHERE id=?",
                (
                    str(refreshed.get("title") or ""),
                    str(refreshed.get("org_chain") or ""),
                    str(refreshed.get("tender_value") or ""),
                    str(refreshed.get("pre_bid_meeting_date") or ""),
                    str(refreshed.get("closing_date") or ""),
                    str(refreshed.get("work_description") or ""),
                    int(project_id),
                ),
            )
            final_conn.commit()
    return {
        "found": bool(refreshed),
        "source": "drive_sync",
        "tender": refreshed,
        "files": files,
        "message": f"Drive project sync copied {int(copied or 0)} new files.",
        "scraper_started": scraper_started,
    }


@app.post("/v1/tenders/project-fetch", response_model=ProjectTenderFetchResponse)
def fetch_tender_for_project(body: ProjectTenderFetchRequest):
    requested_tender_id = str(body.tender_id or "").strip()
    if not requested_tender_id:
        raise HTTPException(400, "tender_id is required")

    with get_db() as conn:
        local_tender, local_files = _find_tender_with_files(conn, requested_tender_id)
    if local_tender is not None:
        return {
            "found": True,
            "source": "local",
            "tender": local_tender,
            "files": local_files,
            "scraper_started": False,
        }

    if body.scrape_on_miss:
        with get_db() as conn:
            sites = conn.execute("SELECT id FROM websites ORDER BY id").fetchall()
        for row in sites:
            site_id = int(row["id"])
            try:
                core.ScraperBackend.fetch_tenders_logic(site_id)
            except Exception:
                pass
            with get_db() as conn:
                scraped_tender, scraped_files = _find_tender_with_files(conn, requested_tender_id)
            if scraped_tender is not None:
                return {
                    "found": True,
                    "source": "scraped",
                    "tender": scraped_tender,
                    "files": scraped_files,
                    "scraper_started": True,
                }

    return {
        "found": False,
        "source": "not_found",
        "tender": None,
        "files": [],
        "scraper_started": False,
    }


@app.api_route("/v1/projects/{project_id}/fetch-from-active", methods=["POST", "GET"], response_model=ProjectTenderFetchResponse)
def fetch_project_from_active(project_id: int):
    with get_db() as conn:
        project = conn.execute(
            "SELECT id, COALESCE(title,'') as title, COALESCE(client_name,'') as client_name, "
            "COALESCE(source_tender_id,'') as source_tender_id, COALESCE(folder_path,'') as folder_path, "
            "COALESCE(status,'Active') as status "
            "FROM projects WHERE id=?",
            (project_id,),
        ).fetchone()
        if not project:
            raise HTTPException(404, "Project not found")

        source_tender_id = str(project["source_tender_id"] or "").strip()
        if not source_tender_id:
            raise HTTPException(400, "Project has no source_tender_id")

        synced_project_root = _sync_project_folder(
            conn,
            int(project["id"]),
            str(project["title"] or ""),
            source_tender_id,
            str(project["folder_path"] or ""),
            str(project["status"] or "Active"),
        )
        tender_docs = _project_tender_docs_path(synced_project_root)

        active_tender = _find_active_tender(conn, source_tender_id)
        if active_tender and _using_drive_projects():
            conn.commit()
            return _sync_project_tender_through_drive(
                project_id, active_tender, synced_project_root, force_update=False
            )
        if not active_tender:
            # Try one forced refresh from scraper for all websites (PySide-like
            # behavior where fetch can trigger online resolution when local miss).
            core.log_to_gui(f"Project fetch: active tender '{source_tender_id}' not found locally. Running refresh...")
            try:
                site_rows = conn.execute("SELECT id FROM websites ORDER BY id").fetchall()
                for srow in site_rows:
                    try:
                        core.ScraperBackend.fetch_tenders_logic(int(srow["id"]))
                    except Exception as se:
                        core.log_to_gui(f"Project fetch: refresh failed for website {int(srow['id'])}: {se}")
            except Exception as e:
                core.log_to_gui(f"Project fetch: refresh pass failed: {e}")
            # Re-open connection and resolve again to avoid stale read snapshot.
            with get_db() as conn_retry:
                active_tender = _find_active_tender(conn_retry, source_tender_id)
                if not active_tender:
                    # Fallback to any tender record (active/archived) by best match.
                    any_tender, _existing_files = _find_tender_with_files(conn_retry, source_tender_id)
                    if any_tender:
                        active_tender = any_tender
                    else:
                        conn_retry.commit()
                        return {
                            "found": False,
                            "source": "active_not_found",
                            "tender": None,
                            "files": [],
                            "message": "Tender not found in Active Tenders, even after refresh.",
                        }
                matched_tender_id = str(active_tender.get("tender_id") or source_tender_id).strip() or source_tender_id
                if _using_drive_projects():
                    conn_retry.commit()
                    return _sync_project_tender_through_drive(
                        project_id, active_tender, synced_project_root, force_update=False
                    )
                # Continue entire flow on fresh connection.
                active_folder = _resolve_active_download_folder(
                    matched_tender_id,
                    str(active_tender.get("folder_path") or ""),
                )
                if not active_folder:
                    active_folder = core._resolve_path(
                        os.path.join(core.BASE_DOWNLOAD_DIRECTORY, _safe_tender_folder_name(matched_tender_id))
                    )
                os.makedirs(active_folder, exist_ok=True)
                # Step 1: if docs already exist from Online Tenders/scraper, copy first.
                _copy_missing_tree(active_folder, tender_docs)
                _ensure_download_log_entries_for_folder(conn_retry, matched_tender_id, active_folder)
                copied_retry_pre = _copy_downloaded_tender_docs_to_project(conn_retry, matched_tender_id, synced_project_root)
                core.log_to_gui(
                    f"Project fetch: pre-sync copied {int(copied_retry_pre or 0)} files for '{matched_tender_id}' "
                    f"before any network download"
                )

                # Step 2: refresh this tender's website listing so changed values
                # (deadline, prebid, value, title, etc.) are picked up.
                website_id = int(active_tender.get("website_id") or 0)
                if website_id > 0:
                    try:
                        core.log_to_gui(
                            f"Project fetch: refreshing website {website_id} for tender '{matched_tender_id}'"
                        )
                        core.ScraperBackend.fetch_tenders_logic(website_id)
                    except Exception as re:
                        core.log_to_gui(
                            f"Project fetch: metadata refresh failed for website {website_id}: {re}"
                        )

                has_existing_files = _folder_has_files(active_folder)
                has_download_log = _has_download_log_for_tender(conn_retry, matched_tender_id)
                download_started = False
                core.log_to_gui(
                    f"Project fetch: resolved tender '{matched_tender_id}'. "
                    f"download folder='{active_folder}', has_files={has_existing_files}, "
                    f"log_entries={has_download_log}"
                )
                # Fetch-specific behavior:
                # - if log exists: copy existing docs first, then run update into project Tender Docs
                # - if no log: run full download directly into project Tender Docs
                effective_mode = "update" if has_download_log else "full"
                core.log_to_gui(
                    f"Project fetch: effective download mode for '{matched_tender_id}' is '{effective_mode}'"
                )
                scraper_started = False
                try:
                    os.makedirs(tender_docs, exist_ok=True)
                    if has_download_log:
                        core.log_to_gui(
                            f"Project fetch: download log found for '{matched_tender_id}'. "
                            f"Running update flow into project Tender Docs."
                        )
                        scraper_started = True
                        download_started = bool(
                            _run_main_scraper_for_tender_to_folder(matched_tender_id, tender_docs, "update")
                        )
                        core.log_to_gui(
                            f"Project fetch: update flow {'started/completed' if download_started else 'did not start'} "
                            f"for '{matched_tender_id}' into '{tender_docs}'"
                        )
                    else:
                        core.log_to_gui(
                            f"Project fetch: no download log found for '{matched_tender_id}'. "
                            f"Running full-download flow into project Tender Docs."
                        )
                        scraper_started = True
                        download_started = bool(
                            _run_main_scraper_for_tender_to_folder(matched_tender_id, tender_docs, "full")
                        )
                        core.log_to_gui(
                            f"Project fetch: full-download flow {'started/completed' if download_started else 'did not start'} "
                            f"for '{matched_tender_id}' into '{tender_docs}'"
                        )
                except Exception as de:
                    download_started = False
                    core.log_to_gui(f"Project fetch: download/update crashed for '{matched_tender_id}': {de}")
                _copy_missing_tree(active_folder, tender_docs)
                _ensure_download_log_entries_for_folder(conn_retry, matched_tender_id, tender_docs)
                # Extra safety: copy through indexed/filepath fallback resolver too.
                copied_retry = _copy_downloaded_tender_docs_to_project(conn_retry, matched_tender_id, synced_project_root)
                core.log_to_gui(
                    f"Project fetch: extra sync copied {int(copied_retry or 0)} files for '{matched_tender_id}' "
                    f"from BASE_DOWNLOAD_DIRECTORY='{core.BASE_DOWNLOAD_DIRECTORY}'"
                )
                refreshed_active = _find_active_tender(conn_retry, matched_tender_id) or active_tender
                updated_source = str(refreshed_active.get("tender_id") or matched_tender_id).strip() or matched_tender_id
                updated_title = str(refreshed_active.get("title") or project["title"] or "")
                updated_client = str(refreshed_active.get("org_chain") or "")
                updated_value = str(refreshed_active.get("tender_value") or "")
                updated_prebid = str(refreshed_active.get("pre_bid_meeting_date") or "")
                updated_deadline = str(refreshed_active.get("closing_date") or "")
                updated_desc = str(refreshed_active.get("work_description") or "")
                updated_status = str(project["status"] or "Active")
                conn_retry.execute(
                    "UPDATE projects SET source_tender_id=?, title=?, client_name=?, project_value=?, prebid=?, deadline=?, description=? WHERE id=?",
                    (
                        updated_source,
                        updated_title,
                        updated_client,
                        updated_value,
                        updated_prebid,
                        updated_deadline,
                        updated_desc,
                        project_id,
                    ),
                )
                synced_after_update = _sync_project_folder(
                    conn_retry,
                    int(project["id"]),
                    updated_title,
                    updated_source,
                    synced_project_root,
                    updated_status,
                )
                _write_project_metadata_file(
                    synced_after_update,
                    updated_title,
                    updated_client,
                    updated_source,
                    updated_value,
                    updated_prebid,
                    updated_deadline,
                    updated_desc,
                    updated_status,
                )
                tender_docs_retry = _project_tender_docs_path(synced_after_update)
                copied_retry_final = _copy_downloaded_tender_docs_to_project(conn_retry, matched_tender_id, synced_after_update)
                core.log_to_gui(
                    f"Project fetch: final extra sync copied {int(copied_retry_final or 0)} files for '{matched_tender_id}' "
                    f"into '{tender_docs_retry}'"
                )
                conn_retry.commit()
                files_retry = _collect_files_from_folder(tender_docs_retry)
                msg_retry = f"Effective download mode: {effective_mode}."
                src_retry = "active_sync"
                if not files_retry:
                    if not _folder_has_files(active_folder):
                        src_retry = "active_sync_no_download"
                        msg_retry = (
                            f"Effective download mode: {effective_mode}. "
                            "No downloaded docs found for this tender, and download did not start. "
                            "Check scraper dependencies/login and try again."
                        )
                    else:
                        src_retry = "active_sync_no_files"
                        msg_retry = (
                            f"Effective download mode: {effective_mode}. "
                            "Tender matched, but no files were copied into project Tender Docs."
                        )
                refreshed_active["folder_path"] = tender_docs_retry
                return {
                    "found": True,
                    "source": src_retry,
                    "tender": refreshed_active,
                    "files": files_retry,
                    "message": msg_retry,
                    "scraper_started": scraper_started,
                }

        matched_tender_id = str(active_tender.get("tender_id") or source_tender_id).strip() or source_tender_id
        # Keep tender download history folder in Active Tenders, and copy into
        # project Tender Docs (same approach as PySide Import Docs).
        active_folder = _resolve_active_download_folder(
            matched_tender_id,
            str(active_tender.get("folder_path") or ""),
        )
        if not active_folder:
            active_folder = core._resolve_path(
                os.path.join(core.BASE_DOWNLOAD_DIRECTORY, _safe_tender_folder_name(matched_tender_id))
            )
        os.makedirs(active_folder, exist_ok=True)
        # Step 1: if docs already exist from Online Tenders/scraper, copy first.
        _copy_missing_tree(active_folder, tender_docs)
        _ensure_download_log_entries_for_folder(conn, matched_tender_id, active_folder)
        copied_main_pre = _copy_downloaded_tender_docs_to_project(conn, matched_tender_id, synced_project_root)
        core.log_to_gui(
            f"Project fetch: pre-sync copied {int(copied_main_pre or 0)} files for '{matched_tender_id}' "
            f"before any network download"
        )

        # Step 2: refresh this tender's website listing so changed values
        # (deadline, prebid, value, title, etc.) are picked up.
        website_id = int(active_tender.get("website_id") or 0)
        if website_id > 0:
            try:
                core.log_to_gui(
                    f"Project fetch: refreshing website {website_id} for tender '{matched_tender_id}'"
                )
                core.ScraperBackend.fetch_tenders_logic(website_id)
            except Exception as re:
                core.log_to_gui(
                    f"Project fetch: metadata refresh failed for website {website_id}: {re}"
                )

        has_existing_files = _folder_has_files(active_folder)
        has_download_log = _has_download_log_for_tender(conn, matched_tender_id)
        download_started = False
        core.log_to_gui(
            f"Project fetch: resolved tender '{matched_tender_id}'. "
            f"download folder='{active_folder}', has_files={has_existing_files}, "
            f"log_entries={has_download_log}"
        )
        effective_mode = "update" if has_download_log else "full"
        core.log_to_gui(
            f"Project fetch: effective download mode for '{matched_tender_id}' is '{effective_mode}'"
        )
        scraper_started = False
        try:
            os.makedirs(tender_docs, exist_ok=True)
            if has_download_log:
                core.log_to_gui(
                    f"Project fetch: download log found for '{matched_tender_id}'. "
                    f"Running update flow into project Tender Docs."
                )
                scraper_started = True
                download_started = bool(
                    _run_main_scraper_for_tender_to_folder(matched_tender_id, tender_docs, "update")
                )
                core.log_to_gui(
                    f"Project fetch: update flow {'started/completed' if download_started else 'did not start'} "
                    f"for '{matched_tender_id}' into '{tender_docs}'"
                )
            else:
                core.log_to_gui(
                    f"Project fetch: no download log found for '{matched_tender_id}'. "
                    f"Running full-download flow into project Tender Docs."
                )
                scraper_started = True
                download_started = bool(
                    _run_main_scraper_for_tender_to_folder(matched_tender_id, tender_docs, "full")
                )
                core.log_to_gui(
                    f"Project fetch: full-download flow {'started/completed' if download_started else 'did not start'} "
                    f"for '{matched_tender_id}' into '{tender_docs}'"
                )
        except Exception as de:
            download_started = False
            core.log_to_gui(f"Project fetch: download/update crashed for '{matched_tender_id}': {de}")
        _copy_missing_tree(active_folder, tender_docs)
        _ensure_download_log_entries_for_folder(conn, matched_tender_id, tender_docs)
        copied_main = _copy_downloaded_tender_docs_to_project(conn, matched_tender_id, synced_project_root)
        core.log_to_gui(
            f"Project fetch: extra sync copied {int(copied_main or 0)} files for '{matched_tender_id}' "
            f"from BASE_DOWNLOAD_DIRECTORY='{core.BASE_DOWNLOAD_DIRECTORY}'"
        )

        refreshed_active = _find_active_tender(conn, matched_tender_id) or active_tender
        updated_source = str(refreshed_active.get("tender_id") or matched_tender_id).strip() or matched_tender_id
        updated_title = str(refreshed_active.get("title") or project["title"] or "")
        updated_client = str(refreshed_active.get("org_chain") or "")
        updated_value = str(refreshed_active.get("tender_value") or "")
        updated_prebid = str(refreshed_active.get("pre_bid_meeting_date") or "")
        updated_deadline = str(refreshed_active.get("closing_date") or "")
        updated_desc = str(refreshed_active.get("work_description") or "")
        updated_status = str(project["status"] or "Active")
        conn.execute(
            "UPDATE projects SET source_tender_id=?, title=?, client_name=?, project_value=?, prebid=?, deadline=?, description=? WHERE id=?",
            (
                updated_source,
                updated_title,
                updated_client,
                updated_value,
                updated_prebid,
                updated_deadline,
                updated_desc,
                project_id,
            ),
        )
        synced_after_update = _sync_project_folder(
            conn,
            int(project["id"]),
            updated_title,
            updated_source,
            synced_project_root,
            updated_status,
        )
        _write_project_metadata_file(
            synced_after_update,
            updated_title,
            updated_client,
            updated_source,
            updated_value,
            updated_prebid,
            updated_deadline,
            updated_desc,
            updated_status,
        )
        tender_docs = _project_tender_docs_path(synced_after_update)
        copied_main_final = _copy_downloaded_tender_docs_to_project(conn, matched_tender_id, synced_after_update)
        core.log_to_gui(
            f"Project fetch: final extra sync copied {int(copied_main_final or 0)} files for '{matched_tender_id}' "
            f"into '{tender_docs}'"
        )
        conn.commit()

    files = _collect_files_from_folder(tender_docs)
    msg = f"Effective download mode: {effective_mode}."
    src = "active_sync"
    if not files:
        if not _folder_has_files(active_folder):
            src = "active_sync_no_download"
            msg = (
                f"Effective download mode: {effective_mode}. "
                "No downloaded docs found for this tender, and download did not start. "
                "Check scraper dependencies/login and try again."
            )
        else:
            src = "active_sync_no_files"
            msg = (
                f"Effective download mode: {effective_mode}. "
                "Tender matched, but no files were copied into project Tender Docs."
            )
    refreshed_active["folder_path"] = tender_docs
    return {
        "found": True,
        "source": src,
        "tender": refreshed_active,
        "files": files,
        "message": msg,
        "scraper_started": scraper_started,
    }


@app.api_route("/v1/projects/{project_id}/check-corrigendum", methods=["POST", "GET"], response_model=ProjectTenderFetchResponse)
def check_project_corrigendum(project_id: int):
    with get_db() as conn:
        project = conn.execute(
            "SELECT id, COALESCE(title,'') as title, COALESCE(client_name,'') as client_name, "
            "COALESCE(source_tender_id,'') as source_tender_id, COALESCE(folder_path,'') as folder_path, "
            "COALESCE(status,'Active') as status "
            "FROM projects WHERE id=?",
            (project_id,),
        ).fetchone()
        if not project:
            raise HTTPException(404, "Project not found")

        source_tender_id = str(project["source_tender_id"] or "").strip()
        if not source_tender_id:
            raise HTTPException(400, "Project has no source_tender_id")

        synced_project_root = _sync_project_folder(
            conn,
            int(project["id"]),
            str(project["title"] or ""),
            source_tender_id,
            str(project["folder_path"] or ""),
            str(project["status"] or "Active"),
        )
        tender_docs = _project_tender_docs_path(synced_project_root)

        active_tender = _find_active_tender(conn, source_tender_id)
        if not active_tender:
            conn.commit()
            return {"found": False, "source": "active_not_found", "tender": None, "files": []}
        if _using_drive_projects():
            conn.commit()
            return _sync_project_tender_through_drive(
                project_id, active_tender, synced_project_root, force_update=True
            )

        matched_tender_id = str(active_tender.get("tender_id") or source_tender_id).strip() or source_tender_id
        active_folder = _resolve_active_download_folder(
            matched_tender_id,
            str(active_tender.get("folder_path") or ""),
        )
        if not active_folder:
            active_folder = core._resolve_path(
                os.path.join(core.BASE_DOWNLOAD_DIRECTORY, _safe_tender_folder_name(matched_tender_id))
            )
        os.makedirs(active_folder, exist_ok=True)

        # PySide parity: local pre-sync, then update download, then post-sync.
        _copy_special_tender_docs(active_folder, tender_docs)
        update_ok = False
        try:
            update_ok = bool(core.ScraperBackend.download_updates_for_tender_to_folder(matched_tender_id, active_folder))
        except Exception:
            update_ok = False
        _copy_special_tender_docs(active_folder, tender_docs)
        _ensure_download_log_entries_for_folder(conn, matched_tender_id, active_folder)

        refreshed_active = _find_active_tender(conn, matched_tender_id) or active_tender
        updated_source = str(refreshed_active.get("tender_id") or matched_tender_id).strip() or matched_tender_id
        updated_title = str(refreshed_active.get("title") or project["title"] or "")
        updated_client = str(refreshed_active.get("org_chain") or "")
        updated_value = str(refreshed_active.get("tender_value") or "")
        updated_prebid = str(refreshed_active.get("pre_bid_meeting_date") or "")
        updated_deadline = str(refreshed_active.get("closing_date") or "")
        updated_desc = str(refreshed_active.get("work_description") or "")
        updated_status = str(project["status"] or "Active")
        conn.execute(
            "UPDATE projects SET source_tender_id=?, title=?, client_name=?, project_value=?, prebid=?, deadline=?, description=? WHERE id=?",
            (
                updated_source,
                updated_title,
                updated_client,
                updated_value,
                updated_prebid,
                updated_deadline,
                updated_desc,
                project_id,
            ),
        )
        synced_after_update = _sync_project_folder(
            conn,
            int(project["id"]),
            updated_title,
            updated_source,
            synced_project_root,
            updated_status,
        )
        _write_project_metadata_file(
            synced_after_update,
            updated_title,
            updated_client,
            updated_source,
            updated_value,
            updated_prebid,
            updated_deadline,
            updated_desc,
            updated_status,
        )
        tender_docs = _project_tender_docs_path(synced_after_update)
        conn.commit()

    files = _collect_files_from_folder(tender_docs)
    msg = None
    src = "corrigendum_sync"
    if not update_ok:
        src = "corrigendum_sync_no_download"
        msg = "Corrigendum download did not start. Check scraper dependencies/login and try again."
    refreshed_active["folder_path"] = tender_docs
    return {
        "found": True,
        "source": src,
        "tender": refreshed_active,
        "files": files,
        "message": msg,
    }


# -- Async Jobs (Scraping, Downloads) --

_jobs: dict[str, dict] = {}
_job_lock = threading.Lock()
_job_futures = {}
_job_cancel_poll_at: dict[str, float] = {}
_JOB_WORKER_ID = f"worker-{uuid.uuid4().hex}"
_JOB_WORKER_COUNT = max(1, min(8, int(os.getenv("BIDMANAGER_WORKER_THREADS", "4") or "4")))
_job_executor = ThreadPoolExecutor(max_workers=_JOB_WORKER_COUNT, thread_name_prefix="bidmanager-job")
_execution_condition = threading.Condition()
_running_job_slots = 0
_captcha_lock = threading.Lock()
_CAPTCHA_TTL_SECONDS = 300
_live_log_lock = threading.Lock()
_live_log_seq = 0
_live_log_buffer: list[tuple[int, float, str]] = []  # (seq, emit_epoch, text)
_LIVE_LOG_MAX = 20000
_log_context = threading.local()
_db_live_log_seen: set[tuple[str, int, str]] = set()
_DB_LIVE_LOG_SEEN_MAX = 50000


def _process_role() -> str:
    role = str(os.getenv("BIDMANAGER_PROCESS_ROLE", "all") or "all").strip().lower()
    if role not in {"all", "api", "worker"}:
        return "all"
    return role


def _job_execution_enabled() -> bool:
    return _process_role() in {"all", "worker"}


def _append_live_log(message: str, ts: Optional[float] = None) -> int:
    global _live_log_seq
    txt = str(message or "").strip()
    if not txt:
        with _live_log_lock:
            return int(_live_log_seq)
    stamp = float(ts) if ts else time.time()
    with _live_log_lock:
        _live_log_seq += 1
        _live_log_buffer.append((int(_live_log_seq), stamp, txt))
        if len(_live_log_buffer) > _LIVE_LOG_MAX:
            del _live_log_buffer[: len(_live_log_buffer) - _LIVE_LOG_MAX]
        return int(_live_log_seq)


def _sync_db_job_logs_to_live_buffer() -> None:
    if _process_role() != "api":
        return
    try:
        with get_db() as conn:
            rows = conn.execute(
                "SELECT id,action,logs_json,COALESCE(finished_at,started_at,created_at) "
                "FROM background_jobs WHERE COALESCE(logs_json,'[]')!='[]' "
                "ORDER BY created_at DESC LIMIT 30"
            ).fetchall()
    except Exception:
        return

    pending_lines = []
    for row in reversed(rows):
        job_id = str(row[0])
        action = str(row[1] or "job")
        logs = _json_load(row[2], [])
        try:
            job_ts = float(row[3]) if row[3] else None
        except (TypeError, ValueError):
            job_ts = None
        if not isinstance(logs, list):
            continue
        for index, line in enumerate(logs[-300:]):
            text = str(line or "").strip()
            if not text:
                continue
            seen_key = (job_id, index, text)
            if seen_key in _db_live_log_seen:
                continue
            _db_live_log_seen.add(seen_key)
            pending_lines.append((text, job_ts))

    if len(_db_live_log_seen) > _DB_LIVE_LOG_SEEN_MAX:
        overflow = len(_db_live_log_seen) - _DB_LIVE_LOG_SEEN_MAX
        for key in list(_db_live_log_seen)[:overflow]:
            _db_live_log_seen.discard(key)
    for line, line_ts in pending_lines:
        _append_live_log(line, ts=line_ts)


def _install_live_log_bridge_once():
    original = getattr(core, "log_to_gui", None)
    if not callable(original):
        return
    if getattr(original, "_bidmanager_live_bridge", False):
        return

    def _bridge_log_to_gui(message):
        tag = getattr(_log_context, "tag", "")
        _append_live_log(f"{tag}{message or ''}" if tag else str(message or ""))
        return original(message)

    _bridge_log_to_gui._bidmanager_live_bridge = True  # type: ignore[attr-defined]
    core.log_to_gui = _bridge_log_to_gui


_install_live_log_bridge_once()


def _drain_queue_nowait(q) -> None:
    while True:
        try:
            q.get_nowait()
        except Exception:
            break


def _clear_captcha_state() -> None:
    try:
        _drain_queue_nowait(core.captcha_req_queue)
    except Exception:
        pass


def _new_job_id():
    return f"job_{uuid.uuid4().hex}"


def _json_dump(value) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def _json_load(value, fallback):
    try:
        return json.loads(value) if value not in (None, "") else fallback
    except Exception:
        return fallback


def _job_dedupe_key(action: str, payload: dict) -> str:
    action_name = str(action or "").strip()
    if payload.get("saved_custom_job_id") is not None:
        website_id = int(payload.get("website_id") or 0)
        return f"{action_name}:saved:{int(payload.get('saved_custom_job_id'))}:website:{website_id}"
    tender_db_id = payload.get("tender_db_id")
    if tender_db_id is not None and core.setting_bool("dedupe_by_tender_id", True):
        return f"{action_name}:tender:{int(tender_db_id)}"
    target_db_ids = sorted({int(value) for value in (payload.get("target_db_ids") or [])})
    if target_db_ids and core.setting_bool("dedupe_by_tender_id", True):
        return (
            f"{action_name}:website:{int(payload.get('website_id'))}:"
            f"mode:{str(payload.get('mode') or '')}:tenders:{','.join(map(str, target_db_ids))}"
        )
    if bool(payload.get("include_all")) and core.setting_bool("dedupe_by_tender_id", True):
        return (
            f"{action_name}:website:{int(payload.get('website_id'))}:"
            f"mode:{str(payload.get('mode') or '')}:all"
        )
    source = str(payload.get("source") or "")
    if source == "consolidated-schedule" and payload.get("website_id") is not None:
        # The consolidated scheduler pass (_run_consolidated_scrape_pass)
        # already merges every due tender-schedule/org-schedule/saved-custom
        # target for a website into one job before calling _enqueue_job, so
        # this key only needs to guard against back-to-back scheduler ticks
        # re-enqueueing while the previous tick's job for the same website is
        # still queued/running — at most one auto-scheduled job per website
        # is ever in flight at a time.
        return f"{action_name}:website:{int(payload.get('website_id'))}:auto-schedule"
    if source in {"custom", "custom-all"} and payload.get("org_ids"):
        website_id = payload.get("website_id")
        org_ids = sorted({int(value) for value in (payload.get("org_ids") or [])})
        return f"{action_name}:website:{int(website_id)}:orgs:{','.join(map(str, org_ids))}"
    return ""


def _job_from_row(row) -> dict:
    payload = _json_load(row[3], {})
    return {
        "status": row[1],
        "action": row[2],
        "payload": payload,
        "result": _json_load(row[4], None),
        "error": row[5] or "",
        "logs": _json_load(row[6], []),
        "progress": int(row[7] or 0),
        "created_at": float(row[8] or 0),
        "started_at": float(row[9]) if row[9] is not None else None,
        "finished_at": float(row[10]) if row[10] is not None else None,
        "heartbeat_at": float(row[11]) if row[11] is not None else None,
        "cancel_requested": bool(row[12]),
        "attempt_count": int(row[13] or 0),
        "worker_id": row[14] or "",
        "dedupe_key": row[15] or "",
        "website_id": payload.get("website_id"),
        "tender_id": payload.get("tender_db_id"),
        "mode": payload.get("mode"),
    }


def _persist_job(job_id: str, job: dict) -> None:
    values = (
        job_id,
        job.get("status", "queued"),
        job.get("action", ""),
        _json_dump(job.get("payload") or {}),
        _json_dump(job.get("result")) if job.get("result") is not None else None,
        str(job.get("error") or ""),
        _json_dump(job.get("logs") or []),
        int(job.get("progress") or 0),
        float(job.get("created_at") or time.time()),
        job.get("started_at"),
        job.get("finished_at"),
        job.get("heartbeat_at"),
        1 if job.get("cancel_requested") else 0,
        int(job.get("attempt_count") or 0),
        str(job.get("worker_id") or ""),
        str(job.get("dedupe_key") or ""),
    )
    for attempt in range(3):
        try:
            with get_db() as conn:
                conn.execute(
                    "INSERT INTO background_jobs "
                    "(id,status,action,payload_json,result_json,error,logs_json,progress,created_at,started_at,finished_at,heartbeat_at,cancel_requested,attempt_count,worker_id,dedupe_key) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
                    "ON CONFLICT(id) DO UPDATE SET "
                    "status=excluded.status, action=excluded.action, payload_json=excluded.payload_json, "
                    "result_json=excluded.result_json, error=excluded.error, logs_json=excluded.logs_json, "
                    "progress=excluded.progress, started_at=excluded.started_at, finished_at=excluded.finished_at, "
                    "heartbeat_at=excluded.heartbeat_at, cancel_requested=excluded.cancel_requested, "
                    "attempt_count=excluded.attempt_count, worker_id=excluded.worker_id, dedupe_key=excluded.dedupe_key",
                    values,
                )
                conn.commit()
            return
        except Exception:
            if attempt >= 2:
                raise
            time.sleep(0.1 * (attempt + 1))


def _update_job(job_id: str, **changes) -> Optional[dict]:
    with _job_lock:
        job = _jobs.get(job_id)
        if not job:
            return None
        job.update(changes)
        snapshot = dict(job)
    _persist_job(job_id, snapshot)
    return snapshot


def _job_cancel_requested(job_id: str) -> bool:
    now = time.time()
    timed_out_snapshot = None
    with _job_lock:
        job = _jobs.get(job_id)
        if not job:
            return True
        if job.get("cancel_requested") or job.get("status") == "cancelled":
            return True
        try:
            ttl_seconds = max(
                60, min(604800, int(core.ScraperBackend.get_setting("job_ttl_minutes", "45")) * 60)
            )
        except Exception:
            ttl_seconds = 45 * 60
        age_from = float(job.get("started_at") or job.get("created_at") or now)
        if now - age_from >= ttl_seconds:
            job.update(
                status="cancelled",
                cancel_requested=True,
                error=f"Job exceeded its configured {ttl_seconds // 60}-minute lifetime.",
                finished_at=now,
                heartbeat_at=now,
            )
            timed_out_snapshot = dict(job)
        last_poll = float(_job_cancel_poll_at.get(job_id) or 0.0)
        if not timed_out_snapshot and now - last_poll < 0.75:
            return False
        _job_cancel_poll_at[job_id] = now
    if timed_out_snapshot:
        _persist_job(job_id, timed_out_snapshot)
        return True
    with get_db() as conn:
        row = conn.execute(
            "SELECT status,cancel_requested FROM background_jobs WHERE id=?",
            (job_id,),
        ).fetchone()
    cancelled = not row or str(row[0]) == "cancelled" or bool(row[1])
    if cancelled:
        with _job_lock:
            current = _jobs.get(job_id)
            if current:
                current["status"] = "cancelled"
                current["cancel_requested"] = True
    return cancelled


def _claim_job(job_id: str, initial: dict) -> bool:
    now = time.time()
    with _job_lock:
        job = _jobs.get(job_id)
        if not job or job.get("status") != "queued" or job.get("cancel_requested"):
            return False
        with get_db() as conn:
            cur = conn.execute(
                "UPDATE background_jobs SET status='running', started_at=?, heartbeat_at=?, "
                "worker_id=?, attempt_count=attempt_count+1, error='' "
                "WHERE id=? AND status='queued' AND cancel_requested=0",
                (now, now, _JOB_WORKER_ID, job_id),
            )
            changed = int(cur.rowcount or 0)
            conn.commit()
        if changed != 1:
            return False
        job.update(
            status="running",
            started_at=now,
            heartbeat_at=now,
            worker_id=_JOB_WORKER_ID,
            attempt_count=int(initial.get("attempt_count") or 0) + 1,
            error="",
        )
    return True


def _job_callable(action: str, payload: dict):
    website_id = payload.get("website_id")
    if action == "fetch_organisations":
        return core.ScraperBackend.fetch_organisations_logic(website_id)
    if action in {"fetch_tenders", "fetch_tenders_selected"}:
        return core.ScraperBackend.fetch_tenders_logic(website_id, org_ids=payload.get("org_ids"))
    if action == "download_tenders":
        return core.ScraperBackend.download_tenders_logic(
            website_id,
            target_db_ids=payload.get("target_db_ids"),
            forced_mode=payload.get("mode"),
            include_all=bool(payload.get("include_all")),
        )
    if action == "refresh_tender_details":
        return core.ScraperBackend.refresh_tender_details_logic(
            website_id, target_db_ids=payload.get("target_db_ids")
        )
    if action in {"refresh_selected_tenders", "refresh_and_download_tenders"}:
        target_db_ids = sorted({int(value) for value in (payload.get("target_db_ids") or [])})
        if not target_db_ids:
            raise RuntimeError("No tenders were selected for refresh and download.")
        placeholders = ",".join("?" for _ in target_db_ids)
        with get_db() as conn:
            org_rows = conn.execute(
                "SELECT DISTINCT o.id FROM organizations o JOIN tenders t "
                "ON t.website_id=o.website_id "
                "AND LOWER(TRIM(COALESCE(t.org_chain,'')))=LOWER(TRIM(COALESCE(o.name,''))) "
                f"WHERE t.website_id=? AND t.id IN ({placeholders}) ORDER BY o.id",
                (int(website_id), *target_db_ids),
            ).fetchall()
        org_ids = [int(row[0]) for row in org_rows]
        if not org_ids:
            raise RuntimeError("Could not identify the organization for the selected tender(s). Refresh organizations first.")
        refreshed = core.ScraperBackend.fetch_tenders_logic(website_id, org_ids=org_ids)
        if refreshed is not True:
            suffix = "; download was not started" if action == "refresh_and_download_tenders" else ""
            raise RuntimeError(f"Tender refresh did not complete{suffix}.")
        if action == "refresh_selected_tenders":
            return True
        return core.ScraperBackend.download_tenders_logic(
            website_id,
            target_db_ids=target_db_ids,
            forced_mode=payload.get("mode"),
            include_all=False,
        )
    if action == "download_tender_results":
        return core.ScraperBackend.download_tender_results_logic(website_id)
    if action == "check_status":
        return core.ScraperBackend.check_tender_status_logic(website_id)
    if action == "check_status_archived":
        return core.ScraperBackend.check_tender_status_logic(website_id, archived_only=True)
    if action == "archive_completed_tenders":
        return core.ScraperBackend.archive_completed_tenders_logic(website_id)
    if action == "push_to_cloud":
        return core.ScraperBackend.push_local_data_to_cloud(website_id)
    if action == "download_single_tender":
        return core.ScraperBackend.download_single_tender_logic(payload.get("tender_db_id"), payload.get("mode", "full"))
    raise RuntimeError(f"Unsupported durable job action: {action}")


def _configured_concurrency() -> int:
    try:
        configured = int(core.ScraperBackend.get_setting("max_concurrent_sessions", "1"))
    except Exception:
        configured = 1
    return max(1, min(_JOB_WORKER_COUNT, configured))


def _acquire_execution_slot(job_id: str) -> bool:
    global _running_job_slots
    with _execution_condition:
        while _running_job_slots >= _configured_concurrency():
            if _job_cancel_requested(job_id):
                return False
            _execution_condition.wait(timeout=0.5)
        if _job_cancel_requested(job_id):
            return False
        _running_job_slots += 1
        return True


def _release_execution_slot() -> None:
    global _running_job_slots
    with _execution_condition:
        _running_job_slots = max(0, _running_job_slots - 1)
        no_running_slots = _running_job_slots == 0
        _execution_condition.notify_all()
    if no_running_slots and core.setting_bool("drain_mode", False):
        with get_db() as conn:
            active = int(
                conn.execute(
                    "SELECT COUNT(*) FROM background_jobs WHERE status IN ('queued','running')"
                ).fetchone()[0]
            )
        if active == 0:
            core.ScraperBackend.close_download_session()
            core.ScraperBackend.set_setting("drain_mode", "false")
            _append_live_log("Drain completed; the scraper is accepting new jobs again.")


def _run_job(job_id: str):
    logs: list[str] = []
    requeue_requested = False
    with _job_lock:
        initial = dict(_jobs.get(job_id) or {})
    if not initial or _job_cancel_requested(job_id):
        return
    if not _acquire_execution_slot(job_id):
        return
    if not _claim_job(job_id, initial):
        _release_execution_slot()
        return
    action = initial.get("action", "")
    payload = dict(initial.get("payload") or {})
    last_persisted = [0.0]

    def _capture_log(message):
        msg = str(message)
        logs.append(msg)
        now = time.time()
        if now - last_persisted[0] >= 5:
            _update_job(job_id, logs=list(logs), heartbeat_at=now)
            last_persisted[0] = now

    try:
        _log_context.tag = f"[{action} #{job_id[:8]}] "
        _clear_captcha_state()
        core.configure_job_runtime(
            log_handler=_capture_log,
            cancel_checker=lambda: _job_cancel_requested(job_id),
            captcha_handler=lambda image, context, timeout: _create_and_wait_for_captcha(
                job_id, image, context, timeout
            ),
        )
        core.check_job_cancelled()
        result = _job_callable(action, payload)
        core.check_job_cancelled()

        org_fetch_failed = action == "fetch_organisations" and result is not True
        explicit_failed = result is False

        if explicit_failed or org_fetch_failed:
            _update_job(
                job_id,
                status="failed",
                error=logs[-1] if logs else "Operation failed.",
                logs=logs,
                finished_at=time.time(),
                heartbeat_at=time.time(),
            )
        else:
            _update_job(
                job_id,
                status="completed",
                progress=100,
                result=result,
                logs=logs,
                finished_at=time.time(),
                heartbeat_at=time.time(),
            )
            followup = str(payload.get("followup_action") or "").strip()
            if followup:
                try:
                    followup_payload = {
                        "website_id": payload.get("website_id"),
                        "source": "followup",
                    }
                    if payload.get("org_ids"):
                        followup_payload["org_ids"] = payload.get("org_ids")
                    elif payload.get("followup_all_organizations"):
                        with get_db() as conn:
                            followup_payload["org_ids"] = [
                                int(row[0]) for row in conn.execute(
                                    "SELECT id FROM organizations WHERE website_id=? ORDER BY id",
                                    (int(payload.get("website_id")),),
                                ).fetchall()
                            ]
                        if not followup_payload["org_ids"]:
                            raise HTTPException(400, "No organizations were found after the refresh")
                        followup = "fetch_tenders_selected"
                    if "download_after" in payload:
                        followup_payload["download_after"] = bool(payload.get("download_after"))
                    _enqueue_job(followup, followup_payload)
                except HTTPException as exc:
                    _append_live_log(f"Follow-up job '{followup}' was not queued: {exc.detail}")
    except core.JobCancelledError:
        with _job_lock:
            cancel_reason = str((_jobs.get(job_id) or {}).get("error") or "Cancelled by operator.")
        _update_job(
            job_id,
            status="cancelled",
            error=cancel_reason,
            logs=logs,
            finished_at=time.time(),
            heartbeat_at=time.time(),
            cancel_requested=True,
        )
    except core.JobRequeueError as exc:
        try:
            retry_limit = max(
                1, min(10, int(core.ScraperBackend.get_setting("retry_attempts", "3")))
            )
        except Exception:
            retry_limit = 3
        with _job_lock:
            attempt_count = int((_jobs.get(job_id) or {}).get("attempt_count") or 1)
        if attempt_count < retry_limit:
            _update_job(
                job_id,
                status="queued",
                result=None,
                error=str(exc),
                logs=logs,
                progress=0,
                started_at=None,
                finished_at=None,
                heartbeat_at=time.time(),
                cancel_requested=False,
                worker_id="",
            )
            requeue_requested = True
        else:
            _update_job(
                job_id,
                status="failed",
                error=f"{exc} Retry limit ({retry_limit}) reached.",
                logs=logs,
                finished_at=time.time(),
                heartbeat_at=time.time(),
            )
    except Exception as e:
        _update_job(
            job_id,
            status="failed",
            error=str(e),
            logs=logs,
            finished_at=time.time(),
            heartbeat_at=time.time(),
        )
    finally:
        core.clear_job_runtime()
        _log_context.tag = ""
        _expire_job_captchas(job_id)
        _release_execution_slot()
        if requeue_requested:
            _job_futures[job_id] = _job_executor.submit(_run_job, job_id)
        else:
            # Terminal (completed / failed / cancelled): record the real finish
            # time on any saved custom job this job ran for.
            _touch_saved_job_last_run(job_id, time.time())


def _queue_limit() -> int:
    raw = core.ScraperBackend.get_setting("max_queue_depth", "25")
    try:
        return max(1, min(500, int(raw)))
    except Exception:
        return 25


def _cleanup_expired_jobs() -> int:
    try:
        history_days = max(1, min(90, int(os.getenv("BIDMANAGER_JOB_HISTORY_DAYS", "7"))))
    except Exception:
        history_days = 7
    cutoff = time.time() - (history_days * 86400)
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id FROM background_jobs "
            "WHERE status IN ('completed','failed','cancelled') "
            "AND COALESCE(finished_at,created_at)<?",
            (cutoff,),
        ).fetchall()
        expired_ids = [str(row[0]) for row in rows]
        if expired_ids:
            placeholders = ",".join("?" for _ in expired_ids)
            conn.execute(
                f"DELETE FROM captcha_requests WHERE job_id IN ({placeholders})",
                expired_ids,
            )
            conn.execute(
                f"DELETE FROM background_jobs WHERE id IN ({placeholders})",
                expired_ids,
            )
            conn.commit()
    if expired_ids:
        with _job_lock:
            for job_id in expired_ids:
                _jobs.pop(job_id, None)
                _job_futures.pop(job_id, None)
                _job_cancel_poll_at.pop(job_id, None)
    return len(expired_ids)


def _enqueue_job(action: str, payload: Optional[dict] = None) -> dict:
    payload = dict(payload or {})
    _cleanup_expired_jobs()
    if core.setting_bool("read_only_mode", False):
        raise HTTPException(423, "The backend is in read-only mode.")
    if core.setting_bool("drain_mode", False):
        raise HTTPException(423, "The scraper is in drain mode and is not accepting new jobs.")
    download_after = payload.get("download_after")
    if action in {"fetch_tenders", "fetch_tenders_selected"} and (
        bool(download_after) if download_after is not None
        else core.setting_bool("auto_download_documents", True)
    ):
        payload.setdefault("followup_action", "download_tenders")
    dedupe_key = _job_dedupe_key(action, payload)
    with _job_lock:
        with get_db() as conn:
            existing_row = None
            if dedupe_key:
                existing_row = conn.execute(
                    "SELECT id,status FROM background_jobs WHERE dedupe_key=? "
                    "AND status IN ('queued','running') ORDER BY created_at ASC LIMIT 1",
                    (dedupe_key,),
                ).fetchone()
            if existing_row:
                return {"job_id": str(existing_row[0]), "status": str(existing_row[1]), "created": False}
            active = int(
                conn.execute(
                    "SELECT COUNT(*) FROM background_jobs WHERE status IN ('queued','running')"
                ).fetchone()[0]
            )
        if active >= _queue_limit():
            raise HTTPException(429, "The scraper queue is full. Try again after an active job finishes.")
        job_id = _new_job_id()
        now = time.time()
        job = {
            "status": "queued",
            "action": action,
            "payload": payload,
            "result": None,
            "error": "",
            "logs": [],
            "progress": 0,
            "created_at": now,
            "started_at": None,
            "finished_at": None,
            "heartbeat_at": now,
            "cancel_requested": False,
            "attempt_count": 0,
            "worker_id": "",
            "dedupe_key": dedupe_key,
            "website_id": payload.get("website_id"),
            "tender_id": payload.get("tender_db_id"),
            "mode": payload.get("mode"),
        }
        _jobs[job_id] = job
    try:
        _persist_job(job_id, job)
    except Exception:
        with _job_lock:
            _jobs.pop(job_id, None)
        existing_row = None
        if dedupe_key:
            with get_db() as conn:
                existing_row = conn.execute(
                    "SELECT id,status FROM background_jobs WHERE dedupe_key=? "
                    "AND status IN ('queued','running') ORDER BY created_at ASC LIMIT 1",
                    (dedupe_key,),
                ).fetchone()
        if existing_row:
            return {"job_id": str(existing_row[0]), "status": str(existing_row[1]), "created": False}
        raise
    if _job_execution_enabled():
        _job_futures[job_id] = _job_executor.submit(_run_job, job_id)
    return {"job_id": job_id, "status": "queued", "created": True}


def _load_and_recover_jobs(*, recover_running: bool = True, submit_queued: bool = True) -> None:
    _cleanup_expired_jobs()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id,status,action,payload_json,result_json,error,logs_json,progress,"
            "created_at,started_at,finished_at,heartbeat_at,cancel_requested,attempt_count,worker_id,dedupe_key "
            "FROM background_jobs ORDER BY created_at ASC"
        ).fetchall()

    try:
        recover_retry_limit = max(1, min(10, int(core.ScraperBackend.get_setting("retry_attempts", "3"))))
    except Exception:
        recover_retry_limit = 3

    recover_ids = []
    resumed = 0
    for row in rows:
        job_id = str(row[0])
        job = _job_from_row(row)
        if recover_running and job["status"] == "running":
            attempts = int(job.get("attempt_count") or 0)
            if job.get("cancel_requested"):
                job.update(
                    status="cancelled",
                    error=str(job.get("error") or "Cancelled before the worker restarted."),
                    finished_at=time.time(),
                    heartbeat_at=time.time(),
                )
                _persist_job(job_id, job)
            elif attempts < recover_retry_limit:
                # The worker died under it (deploy / crash). Put it back on the
                # queue instead of surfacing a red FAILED — it re-runs below.
                job.update(
                    status="queued",
                    error="",
                    started_at=None,
                    finished_at=None,
                    heartbeat_at=time.time(),
                    worker_id="",
                )
                _persist_job(job_id, job)
                resumed += 1
            else:
                job.update(
                    status="failed",
                    error=(
                        f"The worker stopped {attempts} times before this job finished — "
                        f"not retrying automatically. Use Retry to run it again."
                    ),
                    finished_at=time.time(),
                    heartbeat_at=time.time(),
                )
                _persist_job(job_id, job)
        with _job_lock:
            _jobs[job_id] = job
        if submit_queued and job["status"] == "queued" and not job.get("cancel_requested"):
            _persist_job(job_id, job)
            recover_ids.append(job_id)

    if resumed:
        _append_live_log(f"Re-queued {resumed} job(s) interrupted by a worker restart.")

    for job_id in recover_ids:
        _job_futures[job_id] = _job_executor.submit(_run_job, job_id)


def _refresh_jobs_from_db_for_display() -> None:
    _load_and_recover_jobs(recover_running=False, submit_queued=False)


def _submit_queued_jobs_from_db() -> int:
    if _process_role() != "worker":
        return 0
    _cleanup_expired_jobs()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id,status,action,payload_json,result_json,error,logs_json,progress,"
            "created_at,started_at,finished_at,heartbeat_at,cancel_requested,attempt_count,worker_id,dedupe_key "
            "FROM background_jobs WHERE status='queued' AND cancel_requested=0 ORDER BY created_at ASC"
        ).fetchall()

    submitted = 0
    for row in rows:
        job_id = str(row[0])
        job = _job_from_row(row)
        with _job_lock:
            future = _job_futures.get(job_id)
            if future and not future.done():
                continue
            _jobs[job_id] = job
            _job_futures[job_id] = _job_executor.submit(_run_job, job_id)
            submitted += 1
    return submitted


def _queue_poll_loop() -> None:
    while not _queue_poll_stop.is_set():
        try:
            _submit_queued_jobs_from_db()
        except Exception as exc:
            _append_live_log(f"Worker queue poll error: {exc}")
        _queue_poll_stop.wait(5)


def _start_queue_poller() -> None:
    global _queue_poll_thread
    if _process_role() != "worker":
        return
    if _queue_poll_thread and _queue_poll_thread.is_alive():
        return
    _queue_poll_thread = threading.Thread(
        target=_queue_poll_loop,
        name="bidmanager-queue-poller",
        daemon=True,
    )
    _queue_poll_thread.start()


_queue_poll_stop = threading.Event()
_queue_poll_thread = None
_scheduler_stop = threading.Event()
_scheduler_thread = None


def _scheduler_enabled() -> bool:
    return (
        core.setting_bool("schedule_enabled", False)
        and not core.setting_bool("scheduler_paused", False)
        and not core.setting_bool("read_only_mode", False)
        and not core.setting_bool("drain_mode", False)
    )


def _saved_job_scheduler_enabled() -> bool:
    """Saved-job schedules are independent of the portal-wide scrape toggle."""
    return (
        not core.setting_bool("scheduler_paused", False)
        and not core.setting_bool("read_only_mode", False)
        and not core.setting_bool("drain_mode", False)
    )


_IST = ZoneInfo("Asia/Kolkata")


def _parse_hhmm(value) -> Optional[int]:
    m = re.fullmatch(r"\s*([01]?\d|2[0-3]):([0-5]\d)\s*", str(value or ""))
    if not m:
        return None
    return int(m.group(1)) * 60 + int(m.group(2))


def _downtime_window() -> Optional[tuple[int, int]]:
    """Configured daily scheduler-pause window as (from_minute, to_minute) IST,
    or None when unset/invalid. to < from means the window spans midnight."""
    start = _parse_hhmm(core.ScraperBackend.get_setting("scheduler_downtime_from", ""))
    end = _parse_hhmm(core.ScraperBackend.get_setting("scheduler_downtime_to", ""))
    if start is None or end is None or start == end:
        return None
    return (start, end)


def _within_downtime(now_epoch: Optional[float] = None) -> bool:
    window = _downtime_window()
    if not window:
        return False
    start, end = window
    moment = datetime.fromtimestamp(now_epoch if now_epoch is not None else time.time(), _IST)
    minute = moment.hour * 60 + moment.minute
    if end < start:  # spans midnight
        return minute >= start or minute < end
    return start <= minute < end


def _defer_past_downtime(next_epoch: float) -> float:
    """If next_epoch (IST) lands inside the downtime window, push it to that
    occurrence's 'to' boundary so the run happens right after downtime ends."""
    window = _downtime_window()
    if not window or not _within_downtime(next_epoch):
        return next_epoch
    _, end = window
    moment = datetime.fromtimestamp(next_epoch, _IST)
    minute = moment.hour * 60 + moment.minute
    target = moment.replace(hour=end // 60, minute=end % 60, second=0, microsecond=0)
    # Overnight window and the target is in the pre-midnight half -> 'to' is next day.
    if end < (window[0]) and minute >= window[0]:
        target += timedelta(days=1)
    return target.timestamp()


def _claim_scheduler_lease(now: float, interval_seconds: int, name: str = "default") -> bool:
    with get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO scheduler_leases (name,lease_until,last_run_at,worker_id) "
            "VALUES (?,0,NULL,'')",
            (name,),
        )
        cur = conn.execute(
            "UPDATE scheduler_leases SET lease_until=?, worker_id=? "
            "WHERE name=? AND lease_until<? "
            "AND COALESCE(last_run_at,0)<=?",
            (now + 60, _JOB_WORKER_ID, name, now, now - interval_seconds),
        )
        changed = int(cur.rowcount or 0)
        conn.commit()
    return changed == 1


def _saved_custom_job_from_row(row) -> dict:
    schedule_enabled = bool(row[10])
    schedule_mode = str(row[11] or "").strip().lower()
    if schedule_mode not in {"manual", "once", "interval"}:
        schedule_mode = "interval" if schedule_enabled else "manual"
    return {
        "id": int(row[0]),
        "owner_name": str(row[1]),
        "name": str(row[2]),
        "website_id": int(row[3]),
        "job_type": "download" if str(row[4]).strip().lower() == "both" else str(row[4]),
        "org_ids": [int(value) for value in _json_load(row[5], [])],
        "tender_ids": [int(value) for value in _json_load(row[6], [])],
        "all_organizations": bool(row[7]),
        "all_tenders": bool(row[8]),
        "download_mode": str(row[9] or "full"),
        "schedule_enabled": schedule_enabled,
        "schedule_mode": schedule_mode,
        "interval_minutes": int(row[12] or 0),
        "scheduled_for_at": float(row[13] or 0),
        "next_run_at": float(row[14] or 0),
        "last_run_at": float(row[15]) if row[15] is not None else None,
        "last_job_id": str(row[16] or ""),
        "created_at": float(row[17] or 0),
        "updated_at": float(row[18] or 0),
        "created_by": "user" if str(row[19] or "admin").strip().lower() == "user" else "admin",
    }


_SAVED_CUSTOM_JOB_SELECT = (
    "SELECT id,owner_name,name,website_id,job_type,org_ids_json,tender_ids_json,"
    "all_organizations,all_tenders,download_mode,schedule_enabled,schedule_mode,interval_minutes,"
    "scheduled_for_at,next_run_at,last_run_at,last_job_id,created_at,updated_at,"
    "COALESCE(created_by,'admin') AS created_by FROM saved_custom_jobs "
)


def _selected_ids_by_website(conn, table: str, selected_ids, require_all: bool = False) -> dict:
    if table not in {"organizations", "tenders"}:
        raise ValueError("Unsupported saved-job selection table")
    ids = sorted({int(value) for value in (selected_ids or []) if int(value) > 0})
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"SELECT id,website_id FROM {table} WHERE id IN ({placeholders}) ORDER BY website_id,id",
        tuple(ids),
    ).fetchall()
    if require_all and len(rows) != len(ids):
        label = "organizations" if table == "organizations" else "tenders"
        raise HTTPException(400, f"One or more selected {label} no longer exist")
    grouped = {}
    for item_id, website_id in rows:
        grouped.setdefault(int(website_id), []).append(int(item_id))
    return grouped


def _enqueue_saved_custom_job(saved_job_id: int, scheduled_trigger: bool = False) -> dict:
    with get_db() as conn:
        row = conn.execute(
            _SAVED_CUSTOM_JOB_SELECT + "WHERE id=?",
            (int(saved_job_id),),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Saved custom job not found")
        definition = _saved_custom_job_from_row(row)
        org_groups = _selected_ids_by_website(conn, "organizations", definition["org_ids"])
        tender_groups = _selected_ids_by_website(conn, "tenders", definition["tender_ids"])

    queued_jobs = []
    if definition["job_type"] == "scrape":
        if definition.get("all_organizations"):
            # "Whole website" scrape job = refresh the organization list and
            # per-org counts. When the operator also ticked "select all" in the
            # Organizations table (non-empty org_ids), chain a follow-up that
            # scrapes tenders for every org that exists after the refresh.
            org_fetch_payload = {
                "website_id": int(definition["website_id"]),
                "source": "saved-custom",
                "saved_custom_job_id": definition["id"],
            }
            if definition.get("org_ids"):
                org_fetch_payload["followup_action"] = "fetch_tenders"
                org_fetch_payload["followup_all_organizations"] = True
                org_fetch_payload["download_after"] = False
            queued_jobs.append(_enqueue_job("fetch_organisations", org_fetch_payload))
        elif not org_groups:
            raise HTTPException(400, "This saved job has no selected organizations")
        else:
            for website_id, org_ids in org_groups.items():
                queued_jobs.append(_enqueue_job(
                    "fetch_tenders_selected",
                    {
                        "website_id": website_id,
                        "org_ids": org_ids,
                        "download_after": False,
                        "source": "saved-custom",
                        "saved_custom_job_id": definition["id"],
                    },
                ))
    if definition["job_type"] == "download":
        if not tender_groups:
            raise HTTPException(400, "This saved job has no selected tenders")
        for website_id, tender_ids in tender_groups.items():
            queued_jobs.append(_enqueue_job(
                "download_tenders",
                {
                    "website_id": website_id,
                    "target_db_ids": tender_ids,
                    "include_all": False,
                    "mode": definition["download_mode"],
                    "source": "saved-custom",
                    "saved_custom_job_id": definition["id"],
                },
            ))

    if not queued_jobs:
        raise HTTPException(400, "This saved job has no selected work")
    queued_ids = [str(item.get("job_id") or "") for item in queued_jobs if item.get("job_id")]
    queued = {
        **queued_jobs[0],
        "job_ids": queued_ids,
        "queued_count": len(queued_jobs),
    }

    now = time.time()
    queued_ids_str = ",".join(queued_ids)
    if scheduled_trigger and definition["schedule_mode"] in ("once", "interval"):
        _advance_saved_custom_job_schedule(definition["id"], now, queued_ids_str)
    else:
        # A manual "Run once" just runs — it does NOT touch next_run_at, so the
        # job still fires at its scheduled time.
        with get_db() as conn:
            conn.execute(
                "UPDATE saved_custom_jobs SET last_job_id=?,updated_at=? WHERE id=?",
                (queued_ids_str, now, definition["id"]),
            )
            conn.commit()
    return queued


def _touch_saved_job_last_run(job_id: str, ts: float) -> None:
    # Stamp saved_custom_jobs.last_run_at with the REAL completion time of the
    # background job(s) that ran for it — called from _run_job when a job
    # reaches a terminal state. last_job_id is usually a single id but can be a
    # comma-joined list; _run_consolidated_scrape_pass also shares one merged
    # job id across every saved job on a website (all match here).
    jid = str(job_id or "").strip()
    if not jid:
        return
    try:
        with get_db() as conn:
            conn.execute(
                "UPDATE saved_custom_jobs SET last_run_at=? "
                "WHERE last_job_id=? OR last_job_id LIKE ? OR last_job_id LIKE ? OR last_job_id LIKE ?",
                (ts, jid, jid + ",%", "%," + jid, "%," + jid + ",%"),
            )
            conn.commit()
    except Exception:
        pass


def _advance_saved_custom_job_schedule(
    saved_job_id: int, now: float, job_id: str
) -> None:
    # Shared by the "scheduled_trigger=True" path in _enqueue_saved_custom_job
    # and by _run_consolidated_scrape_pass, so a saved job's next_run_at only
    # ever advances through this one place. A manual "Run once" does NOT call
    # this — a hand-run leaves the scheduled time untouched.
    with get_db() as conn:
        row = conn.execute(
            "SELECT schedule_mode,interval_minutes,next_run_at FROM saved_custom_jobs WHERE id=?",
            (int(saved_job_id),),
        ).fetchone()
        if not row:
            return
        schedule_mode, interval_minutes, next_run_at = row
        # last_run_at is NOT set here — it is stamped with the real completion
        # time by _touch_saved_job_last_run() when the queued job terminates.
        if schedule_mode == "once":
            conn.execute(
                "UPDATE saved_custom_jobs SET last_job_id=?,schedule_enabled=0,"
                "next_run_at=0,updated_at=? WHERE id=?",
                (job_id, now, int(saved_job_id)),
            )
        elif schedule_mode == "interval" and int(interval_minutes or 0) > 0:
            interval_seconds = int(interval_minutes) * 60
            previous_next = float(next_run_at or now)
            elapsed_intervals = max(1, int((now - previous_next) // interval_seconds) + 1)
            next_run = previous_next + elapsed_intervals * interval_seconds
            next_run = _defer_past_downtime(next_run)
            conn.execute(
                "UPDATE saved_custom_jobs SET last_job_id=?,next_run_at=?,updated_at=? WHERE id=?",
                (job_id, next_run, now, int(saved_job_id)),
            )
        else:
            conn.execute(
                "UPDATE saved_custom_jobs SET last_job_id=?,updated_at=? WHERE id=?",
                (job_id, now, int(saved_job_id)),
            )
        conn.commit()


def _run_consolidated_scrape_pass() -> int:
    # Replaces the old _queue_due_tender_scrapes / _queue_due_org_scrapes /
    # _queue_due_saved_custom_jobs trio. Multiple operators can independently
    # bookmark the same tender/org or create saved custom jobs targeting the
    # same organizations/tenders — this gathers everything due from every
    # source in one pass, merges each website's targets into a union, and
    # enqueues exactly one job per website per group (scrape vs. download),
    # so overlapping schedules from different sources/users never race each
    # other into duplicate concurrent scrapes of the same site.
    #
    # tenders.next_scrape_at / organizations.next_scrape_at are deliberately
    # NOT touched here — they already self-correct inside upsert_tender_row /
    # fetch_tenders_logic based on whichever orgs actually get processed by
    # the job that runs, so they're always accurate regardless of how a job
    # got triggered. saved_custom_jobs has no such self-correction (its
    # next_run_at lives entirely in this scheduling layer), so it's only
    # advanced below when this tick's job for its website was newly created
    # — never when the enqueue attempt silently resolved to an already
    # in-flight job from an earlier tick, which would not have included this
    # job's targets.
    include_bookmark = _scheduler_enabled()
    include_saved = _saved_job_scheduler_enabled()
    if not include_bookmark and not include_saved:
        return 0
    if _within_downtime():
        return 0
    now = time.time()
    lease_name = "consolidated-schedule"
    if not _claim_scheduler_lease(now, 60, lease_name):
        return 0
    queued = 0
    try:
        website_scrape_orgs: dict[int, set] = {}
        website_all_orgs: set = set()
        website_all_orgs_scrape: set = set()
        website_download_tenders: dict[int, set] = {}
        saved_scrape_ids_by_website: dict[int, list] = {}
        saved_download_ids_by_website: dict[int, list] = {}

        with get_db() as conn:
            if include_bookmark:
                for website_id, org_id in conn.execute(
                    "SELECT DISTINCT t.website_id,o.id FROM tenders t "
                    "JOIN organizations o ON o.website_id=t.website_id AND o.name=t.org_chain "
                    "WHERE COALESCE(t.scrape_enabled,0)=1 AND COALESCE(t.scrape_interval_minutes,0)>0 "
                    "AND COALESCE(t.next_scrape_at,0)<=?",
                    (now,),
                ).fetchall():
                    website_scrape_orgs.setdefault(int(website_id), set()).add(int(org_id))
                for website_id, org_id in conn.execute(
                    "SELECT website_id,id FROM organizations WHERE COALESCE(scrape_enabled,0)=1 "
                    "AND COALESCE(scrape_interval_minutes,0)>0 AND COALESCE(next_scrape_at,0)<=?",
                    (now,),
                ).fetchall():
                    website_scrape_orgs.setdefault(int(website_id), set()).add(int(org_id))
            if include_saved:
                saved_rows = conn.execute(
                    "SELECT id,website_id,job_type,org_ids_json,tender_ids_json,all_organizations "
                    "FROM saved_custom_jobs WHERE schedule_enabled=1 "
                    "AND schedule_mode IN ('once','interval') AND COALESCE(next_run_at,0)>0 "
                    "AND COALESCE(next_run_at,0)<=? ORDER BY next_run_at,id",
                    (now,),
                ).fetchall()
                for saved_id, website_id, job_type, org_ids_json, tender_ids_json, all_orgs in saved_rows:
                    website_id = int(website_id)
                    if job_type == "scrape":
                        saved_scrape_ids_by_website.setdefault(website_id, []).append(int(saved_id))
                        try:
                            org_ids = json.loads(org_ids_json or "[]")
                        except (TypeError, ValueError):
                            org_ids = []
                        if all_orgs:
                            website_all_orgs.add(website_id)
                            if org_ids:
                                # "select all" was ticked too -> refresh, then
                                # scrape tenders for every org after the refresh.
                                website_all_orgs_scrape.add(website_id)
                        else:
                            website_scrape_orgs.setdefault(website_id, set()).update(int(x) for x in org_ids)
                    elif job_type == "download":
                        try:
                            tender_ids = json.loads(tender_ids_json or "[]")
                        except (TypeError, ValueError):
                            tender_ids = []
                        website_download_tenders.setdefault(website_id, set()).update(int(x) for x in tender_ids)
                        saved_download_ids_by_website.setdefault(website_id, []).append(int(saved_id))

        for website_id in set(website_scrape_orgs) | website_all_orgs:
            planned: list[tuple[str, dict]] = []
            if website_id in website_all_orgs:
                # "Whole website" saved job = refresh the organization list and
                # per-org counts. If "select all" was also ticked, chain a
                # follow-up tender scrape of every org that exists post-refresh.
                org_fetch_payload = {
                    "website_id": website_id, "source": "consolidated-schedule",
                }
                if website_id in website_all_orgs_scrape:
                    org_fetch_payload["followup_action"] = "fetch_tenders"
                    org_fetch_payload["followup_all_organizations"] = True
                    org_fetch_payload["download_after"] = False
                planned.append(("fetch_organisations", org_fetch_payload))
            explicit_orgs = set(website_scrape_orgs.get(website_id, set()))
            if explicit_orgs:
                planned.append(("fetch_tenders_selected", {
                    "website_id": website_id, "org_ids": sorted(explicit_orgs),
                    "source": "consolidated-schedule", "download_after": False,
                }))
            if not planned:
                _append_live_log(f"Consolidated scrape skipped for website {website_id}: no organizations exist yet.")
                continue
            created_job_id = ""
            for action, payload in planned:
                try:
                    result = _enqueue_job(action, payload)
                except HTTPException as exc:
                    _append_live_log(f"Consolidated scrape was not queued for website {website_id}: {exc.detail}")
                    continue
                if result.get("created"):
                    queued += 1
                    created_job_id = result["job_id"]
            if created_job_id:
                for saved_id in saved_scrape_ids_by_website.get(website_id, []):
                    _advance_saved_custom_job_schedule(saved_id, now, created_job_id)

        for website_id, tender_ids in website_download_tenders.items():
            try:
                result = _enqueue_job("download_tenders", {
                    "website_id": website_id, "target_db_ids": sorted(tender_ids),
                    "include_all": False, "mode": "auto",
                    "source": "consolidated-schedule", "download_after": False,
                })
            except HTTPException as exc:
                _append_live_log(f"Consolidated download was not queued for website {website_id}: {exc.detail}")
                continue
            if result.get("created"):
                queued += 1
                for saved_id in saved_download_ids_by_website.get(website_id, []):
                    _advance_saved_custom_job_schedule(saved_id, now, result["job_id"])
    finally:
        with get_db() as conn:
            conn.execute(
                "UPDATE scheduler_leases SET lease_until=0,last_run_at=?,worker_id=? WHERE name=?",
                (now, _JOB_WORKER_ID, lease_name),
            )
            conn.commit()
    if queued:
        _append_live_log(f"Scheduler queued {queued} consolidated scrape/download job(s).")
    return queued


def _run_expired_tender_sweep() -> int:
    # Archive completed tenders once per day, at the configured IST hour.
    if not core.setting_bool("archive_daily_enabled", True):
        return 0
    target_hour = core.setting_int("archive_daily_hour", 20, minimum=0, maximum=23)
    if datetime.now(_IST).hour < target_hour:
        return 0
    if _within_downtime():
        return 0
    lease_name = "expired-tender-sweep"
    # 20h lease guard + the hour gate above => one run per day anchored to target_hour.
    if not _claim_scheduler_lease(time.time(), 20 * 3600, lease_name):
        return 0
    archived = 0
    try:
        with get_db() as conn:
            website_ids = [int(row[0]) for row in conn.execute("SELECT id FROM websites ORDER BY id").fetchall()]
        for website_id in website_ids:
            archived += core.ScraperBackend.archive_completed_tenders_logic(website_id, emit_log=False)
        core.log_to_gui(f"Archived {archived} tenders (24h+ past closing_date).")
    finally:
        now = time.time()
        with get_db() as conn:
            conn.execute(
                "UPDATE scheduler_leases SET lease_until=0,last_run_at=?,worker_id=? WHERE name=?",
                (now, _JOB_WORKER_ID, lease_name),
            )
            conn.commit()
    return archived


def _scheduler_loop() -> None:
    while not _scheduler_stop.is_set():
        try:
            _run_consolidated_scrape_pass()
            _run_expired_tender_sweep()
            core.ScraperBackend.close_idle_download_session()
        except Exception as exc:
            _append_live_log(f"Scheduler error: {exc}")
        _scheduler_stop.wait(15)


def _start_scheduler() -> None:
    global _scheduler_thread
    if not _job_execution_enabled():
        _append_live_log("Scheduler disabled in API-only process role.")
        return
    if _scheduler_thread and _scheduler_thread.is_alive():
        return
    _scheduler_thread = threading.Thread(
        target=_scheduler_loop,
        name="bidmanager-scheduler",
        daemon=True,
    )
    _scheduler_thread.start()


@app.post("/v1/websites/{website_id}/organizations/fetch", response_model=JobStartResponse)
def fetch_organizations(website_id: int):
    return _enqueue_job("fetch_organisations", {"website_id": website_id})


@app.post("/v1/websites/{website_id}/tenders/fetch", response_model=JobStartResponse)
def fetch_tenders(website_id: int):
    return _enqueue_job("fetch_tenders", {"website_id": website_id})


@app.post("/v1/websites/{website_id}/tenders/fetch-selected", response_model=JobStartResponse)
def fetch_selected_tenders(website_id: int, body: FetchSelectedTendersRequest):
    org_ids = sorted({int(x) for x in body.org_ids if int(x) > 0})
    if not org_ids:
        raise HTTPException(400, "org_ids is required")
    return _enqueue_job(
        "fetch_tenders_selected",
        {
            "website_id": website_id,
            "org_ids": org_ids,
            "download_after": bool(body.download_after),
            "source": "custom",
        },
    )


def _all_organization_ids(conn, website_id: int) -> list:
    # The one place "every organization for this website" is resolved — used
    # anywhere a caller means literally all orgs, as opposed to
    # organizations.is_selected=1 (an unrelated, client-facing watchlist
    # flag; see PATCH /v1/organizations/{id}) or an explicit org_ids list.
    return [
        int(row[0]) for row in conn.execute(
            "SELECT id FROM organizations WHERE website_id=? ORDER BY id",
            (website_id,),
        ).fetchall()
    ]


@app.post("/v1/websites/{website_id}/tenders/fetch-all", response_model=JobStartResponse)
def fetch_all_tenders(website_id: int):
    with get_db() as conn:
        org_ids = _all_organization_ids(conn, website_id)
    if not org_ids:
        raise HTTPException(400, "No organizations are available. Refresh organizations first.")
    return _enqueue_job(
        "fetch_tenders_selected",
        {
            "website_id": website_id,
            "org_ids": org_ids,
            "download_after": False,
            "source": "custom-all",
        },
    )


@app.api_route("/v1/websites/{website_id}/tenders/download", methods=["POST", "GET"], response_model=JobStartResponse)
def download_tenders(website_id: int):
    return _enqueue_job("download_tenders", {"website_id": website_id})


@app.post("/v1/websites/{website_id}/tenders/download-batch", response_model=JobStartResponse)
def download_tender_batch(website_id: int, body: BatchTenderDownloadRequest):
    mode = str(body.mode or "auto").strip().lower()
    if mode not in {"auto", "full", "update"}:
        raise HTTPException(400, "mode must be 'auto', 'full', or 'update'")
    tender_ids = sorted({int(value) for value in (body.tender_ids or []) if int(value) > 0})
    if not body.all_tenders and not tender_ids:
        raise HTTPException(400, "Select at least one tender or request all_tenders")
    if tender_ids:
        placeholders = ",".join("?" for _ in tender_ids)
        with get_db() as conn:
            found = int(
                conn.execute(
                    f"SELECT COUNT(*) FROM tenders WHERE website_id=? AND id IN ({placeholders})",
                    (website_id, *tender_ids),
                ).fetchone()[0]
            )
        if found != len(tender_ids):
            raise HTTPException(400, "One or more selected tenders do not belong to this website")
    return _enqueue_job(
        "download_tenders",
        {
            "website_id": website_id,
            "target_db_ids": [] if body.all_tenders else tender_ids,
            "include_all": bool(body.all_tenders),
            "mode": mode,
            "source": "custom",
        },
    )


@app.post("/v1/websites/{website_id}/tenders/refresh-batch", response_model=JobStartResponse)
def refresh_tender_batch(website_id: int, body: BatchTenderDownloadRequest):
    tender_ids = sorted({int(value) for value in (body.tender_ids or []) if int(value) > 0})
    if not tender_ids:
        raise HTTPException(400, "Select at least one tender")
    placeholders = ",".join("?" for _ in tender_ids)
    with get_db() as conn:
        found = int(conn.execute(
            f"SELECT COUNT(*) FROM tenders WHERE website_id=? AND id IN ({placeholders})",
            (website_id, *tender_ids),
        ).fetchone()[0])
    if found != len(tender_ids):
        raise HTTPException(400, "One or more selected tenders do not belong to this website")
    return _enqueue_job("refresh_tender_details", {
        "website_id": website_id,
        "target_db_ids": tender_ids,
        "source": "custom",
    })


@app.put("/v1/websites/{website_id}/tenders/schedule-batch")
def schedule_tender_batch(website_id: int, body: BatchTenderScheduleRequest):
    tender_ids = sorted({int(value) for value in body.tender_ids if int(value) > 0})
    interval = int(body.interval_minutes)
    if not tender_ids:
        raise HTTPException(400, "Select at least one tender")
    if body.enabled and interval <= 0:
        raise HTTPException(400, "interval_minutes must be positive when scheduling is enabled")
    placeholders = ",".join("?" for _ in tender_ids)
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT id FROM tenders WHERE website_id=? AND id IN ({placeholders})",
            (website_id, *tender_ids),
        ).fetchall()
    found_ids = {int(row[0]) for row in rows}
    if found_ids != set(tender_ids):
        raise HTTPException(400, "One or more selected tenders do not belong to this website")
    for tender_db_id in tender_ids:
        core.ScraperBackend.set_tender_scrape_schedule(
            tender_db_id, interval, bool(body.enabled)
        )
    return {"ok": True, "updated": len(tender_ids)}


@app.post("/v1/websites/{website_id}/tenders/download-results", response_model=JobStartResponse)
def download_tender_results(website_id: int):
    return _enqueue_job("download_tender_results", {"website_id": website_id})


@app.post("/v1/websites/{website_id}/tenders/check-status", response_model=JobStartResponse)
def check_status(website_id: int):
    return _enqueue_job("check_status", {"website_id": website_id})


@app.post("/v1/websites/{website_id}/tenders/check-status-archived", response_model=JobStartResponse)
def check_status_archived(website_id: int):
    return _enqueue_job("check_status_archived", {"website_id": website_id})


@app.post("/v1/websites/{website_id}/tenders/archive-completed", response_model=JobStartResponse)
def archive_completed_tenders(website_id: int):
    return _enqueue_job("archive_completed_tenders", {"website_id": website_id})


@app.post("/v1/websites/{website_id}/tenders/push-to-cloud", response_model=JobStartResponse)
def push_to_cloud(website_id: int):
    return _enqueue_job("push_to_cloud", {"website_id": website_id})


@app.get("/v1/jobs/{job_id}")
def get_job(job_id: str):
    with _job_lock:
        job = dict(_jobs.get(job_id) or {})
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@app.get("/v1/logs/live", response_model=LiveLogsResponse)
def get_live_logs(
    limit: int = Query(400, ge=1, le=5000),
    since_seq: int = Query(0, ge=0),
):
    _sync_db_job_logs_to_live_buffer()
    with _live_log_lock:
        if since_seq > 0:
            selected = [t for t in _live_log_buffer if t[0] > int(since_seq)]
        else:
            selected = list(_live_log_buffer[-int(limit):])
        if len(selected) > int(limit):
            selected = selected[-int(limit):]
        next_seq = int(selected[-1][0]) if selected else int(_live_log_seq)
        lines = [txt for _seq, _ts, txt in selected]
        entries = [{"seq": _seq, "ts": _ts, "text": txt} for _seq, _ts, txt in selected]
    return {"lines": lines, "entries": entries, "next_seq": next_seq}


@app.get("/v1/captcha/pending", response_model=Optional[CaptchaPendingResponse])
def get_pending_captcha():
    now = time.time()
    with _captcha_lock:
        with get_db() as conn:
            conn.execute(
                "UPDATE captcha_requests SET status='expired' "
                "WHERE status='pending' AND expires_at<?",
                (now,),
            )
            row = conn.execute(
                "SELECT id, image_base64, context, created_at, expires_at, job_id "
                "FROM captcha_requests WHERE status='pending' "
                "ORDER BY created_at ASC LIMIT 1"
            ).fetchone()
            conn.commit()
    if not row:
        return None
    return {
        "request_id": str(row[0]),
        "image_base64": str(row[1] or ""),
        "context": str(row[2] or "captcha"),
        "created_at": float(row[3] or now),
        "expires_at": float(row[4] or now),
        "job_id": str(row[5] or ""),
    }


def _create_and_wait_for_captcha(job_id: str, image_data, context: str, timeout: float):
    request_id = str(uuid.uuid4())
    created = time.time()
    expires = created + max(1.0, float(timeout or _CAPTCHA_TTL_SECONDS))
    encoded = base64.b64encode(image_data).decode("ascii")
    with get_db() as conn:
        conn.execute(
            "INSERT INTO captcha_requests "
            "(id,job_id,context,image_base64,status,created_at,expires_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (request_id, job_id, str(context or "captcha"), encoded, "pending", created, expires),
        )
        conn.commit()

    while time.time() < expires:
        core.check_job_cancelled()
        with get_db() as conn:
            row = conn.execute(
                "SELECT status, response_text FROM captcha_requests WHERE id=?",
                (request_id,),
            ).fetchone()
        if not row:
            return None
        status = str(row[0] or "")
        if status == "answered":
            return str(row[1] or "")
        if status in {"expired", "cancelled"}:
            return None
        time.sleep(0.75)

    with get_db() as conn:
        conn.execute(
            "UPDATE captcha_requests SET status='expired' WHERE id=? AND status='pending'",
            (request_id,),
        )
        conn.commit()
    return None


def _expire_job_captchas(job_id: str) -> None:
    with get_db() as conn:
        conn.execute(
            "UPDATE captcha_requests SET status='cancelled' "
            "WHERE job_id=? AND status='pending'",
            (job_id,),
        )
        conn.commit()


@app.post("/v1/captcha/respond")
def submit_captcha(body: CaptchaSubmitRequest):
    text = str(body.text or "").strip()
    with _captcha_lock:
        with get_db() as conn:
            cur = conn.execute(
                "UPDATE captcha_requests SET status='answered', response_text=?, answered_at=? "
                "WHERE id=? AND status='pending' AND expires_at>=?",
                (text, time.time(), str(body.request_id), time.time()),
            )
            changed = int(cur.rowcount or 0)
            conn.commit()
        if changed != 1:
            raise HTTPException(404, "Captcha request not found or expired.")
    return {"ok": True}


# -- Projects --

def _path_eq(a: str, b: str) -> bool:
    if str(a or "").startswith("gdrive://") or str(b or "").startswith("gdrive://"):
        return str(a or "").strip() == str(b or "").strip()
    return os.path.normcase(os.path.normpath(str(a or ""))) == os.path.normcase(os.path.normpath(str(b or "")))


def _project_folder_leaf(title: str, source_tender_id: str) -> str:
    preferred = str(source_tender_id or "").strip() or str(title or "").strip()
    return core.sanitize_name(preferred, "Project")


def _normalize_tender_id(value: str) -> str:
    return str(value or "").strip().lower()


def _looks_like_tender_id(value: str) -> bool:
    txt = str(value or "").strip()
    if not txt:
        return False
    if re.search(r"\s", txt):
        return False
    if not re.search(r"\d", txt):
        return False
    return ("_" in txt) or ("-" in txt)


def _extract_tender_id_from_text(value: str) -> str:
    txt = str(value or "").strip()
    if not txt:
        return ""
    if _looks_like_tender_id(txt):
        return txt
    # Prefer token-like parts that resemble tender ids, e.g.
    # "Test ZZ_TEST_20260501_091349" -> "ZZ_TEST_20260501_091349"
    parts = re.split(r"\s+", txt)
    for part in parts:
        cand = str(part or "").strip("()[]{}.,;:")
        if _looks_like_tender_id(cand):
            return cand
    # Fallback: pick embedded id-like spans.
    m = re.search(r"([A-Za-z0-9]+(?:[_-][A-Za-z0-9]+){2,})", txt)
    if m:
        cand = str(m.group(1) or "").strip()
        if _looks_like_tender_id(cand):
            return cand
    return ""


def _projects_root_for_status(status: str) -> str:
    txt = str(status or "").strip().lower()
    if admin_providers.active_storage_provider().metadata()["provider"] == "google-drive":
        branch = "archived" if txt == "archived" else "active"
        return admin_providers.drive_storage.ensure_reference_path(f"projects/{branch}")
    if txt == "archived":
        return core._resolve_path("Archived Projects")
    return core._resolve_path(core.ROOT_FOLDER)


def _project_folder_preferred(title: str, source_tender_id: str, status: str = "Active") -> str:
    if admin_providers.active_storage_provider().metadata()["provider"] == "google-drive":
        branch = "archived" if str(status or "").strip().lower() == "archived" else "active"
        leaf = _project_folder_leaf(title, source_tender_id)
        return admin_providers.drive_storage.ensure_reference_path(
            f"projects/{branch}/{leaf}",
            children=("Ready Docs", "Tender Docs", "Working Docs"),
        )
    return core._resolve_path(os.path.join(_projects_root_for_status(status), _project_folder_leaf(title, source_tender_id)))


def _migrate_archived_projects_to_archive_root(conn: sqlite3.Connection) -> int:
    archived_root = _projects_root_for_status("Archived")
    remote = archived_root.startswith("gdrive://")
    if not remote:
        os.makedirs(archived_root, exist_ok=True)
    moved = 0
    rows = conn.execute(
        "SELECT id, COALESCE(title,'') as title, COALESCE(source_tender_id,'') as source_tender_id, "
        "COALESCE(folder_path,'') as folder_path "
        "FROM projects WHERE UPPER(TRIM(COALESCE(status,'')))='ARCHIVED'"
    ).fetchall()
    for row in rows:
        pid = int(row["id"])
        title = str(row["title"] or "")
        source_tender_id = str(row["source_tender_id"] or "")
        current = str(row["folder_path"] or "").strip()
        target = _project_folder_preferred(title, source_tender_id, "Archived")
        try:
            if remote:
                if current.startswith("gdrive://") and not _path_eq(current, target):
                    admin_providers.drive_storage.copy_folder_contents(current, target)
                if not _path_eq(current, target):
                    conn.execute("UPDATE projects SET folder_path=? WHERE id=?", (target, pid))
                    moved += 1
                continue
            if current and os.path.isdir(current) and not _path_eq(current, target):
                os.makedirs(os.path.dirname(target), exist_ok=True)
                final_target = target
                if os.path.exists(final_target):
                    final_target = f"{target}_{pid}"
                try:
                    shutil.move(current, final_target)
                except Exception:
                    core.ensure_project_standard_folders(final_target)
                    core.copy_tree_contents(current, final_target)
                target = final_target
            else:
                ensured = core.ensure_project_standard_folders(target)
                target = str(ensured.get("project_root", target) or target).strip()
            if not _path_eq(current, target):
                conn.execute("UPDATE projects SET folder_path=? WHERE id=?", (target, pid))
                moved += 1
        except Exception:
            # keep migration best-effort and non-blocking
            pass
    return moved


def _project_tender_docs_path(project_root: str) -> str:
    if str(project_root or "").startswith("gdrive://"):
        return admin_providers.drive_storage.ensure_child_reference(project_root, "Tender Docs")
    ensured = core.ensure_project_standard_folders(project_root)
    return str(ensured.get("tender_docs", "") or "").strip()


def _copy_downloaded_tender_docs_to_project(conn: sqlite3.Connection, source_tender_id: str, project_root: str) -> int:
    tid_raw = str(source_tender_id or "").strip()
    tid = tid_raw.lower()
    root = str(project_root or "").strip()
    if not tid or not root:
        return 0
    tender_docs = _project_tender_docs_path(root)
    if root.startswith("gdrive://"):
        try:
            source = admin_providers.drive_storage.folder_reference(
                core.ScraperBackend.get_setting("storage_prefix", "tenders/"),
                tid_raw,
                create=False,
            )
        except ValueError:
            return 0
        return admin_providers.drive_storage.copy_folder_contents(source, tender_docs)
    copied = 0

    # 1) Prefer tender folder paths from tenders table (best case: full tree copy).
    rows = conn.execute(
        "SELECT COALESCE(folder_path,'') AS folder_path "
        "FROM tenders WHERE LOWER(TRIM(COALESCE(tender_id,'')))=? "
        "ORDER BY CASE WHEN TRIM(COALESCE(folder_path,''))<>'' THEN 0 ELSE 1 END, "
        "COALESCE(is_downloaded,0) DESC, COALESCE(last_downloaded_at,'') DESC, id DESC",
        (tid,),
    ).fetchall()
    seen_src_dirs: set[str] = set()
    for row in rows:
        src = str(row["folder_path"] or "").strip()
        if not src:
            continue
        src = core._resolve_path(src)
        norm = os.path.normcase(os.path.normpath(src))
        if norm in seen_src_dirs:
            continue
        seen_src_dirs.add(norm)
        if os.path.isdir(src):
            copied += int(core.copy_tree_contents(src, tender_docs) or 0)

    # 2) Fallback: copy individual downloaded files from downloaded_files.local_path.
    file_rows = conn.execute(
        "SELECT COALESCE(local_path,'') AS local_path "
        "FROM downloaded_files WHERE LOWER(TRIM(COALESCE(tender_id,'')))=? "
        "ORDER BY COALESCE(downloaded_at,'') DESC, id DESC",
        (tid,),
    ).fetchall()
    for fr in file_rows:
        fpath = str(fr["local_path"] or "").strip()
        if not fpath:
            continue
        fpath = core._resolve_path(fpath)
        if not os.path.isfile(fpath):
            continue
        try:
            fname = os.path.basename(fpath)
            dst = os.path.join(tender_docs, fname)
            if not os.path.exists(dst):
                shutil.copy2(fpath, dst)
                copied += 1
        except Exception:
            continue

    # 3) Filesystem fallback: copy from conventional tender download folder
    # even when DB linkage is missing/stale.
    try:
        fallback_src = _find_download_folder_by_tender_id(tid_raw)
        if fallback_src and os.path.isdir(fallback_src):
            copied += int(core.copy_tree_contents(fallback_src, tender_docs) or 0)
        else:
            exact_src = core._resolve_path(os.path.join(core.BASE_DOWNLOAD_DIRECTORY, _safe_tender_folder_name(tid_raw)))
            if os.path.isdir(exact_src):
                copied += int(core.copy_tree_contents(exact_src, tender_docs) or 0)
    except Exception:
        pass

    return int(copied or 0)


def _sync_project_folder(
    conn: sqlite3.Connection,
    project_id: int,
    title: str,
    source_tender_id: str,
    folder_path: str,
    status: str = "Active",
) -> str:
    current = str(folder_path or "").strip()
    preferred = _project_folder_preferred(title, source_tender_id, status)
    chosen = preferred

    if chosen.startswith("gdrive://"):
        if current.startswith("gdrive://") and not _path_eq(current, chosen):
            admin_providers.drive_storage.copy_folder_contents(current, chosen)
        if not _path_eq(current, chosen):
            conn.execute("UPDATE projects SET folder_path=? WHERE id=?", (chosen, int(project_id)))
        return chosen

    ensured = core.ensure_project_standard_folders(chosen)
    chosen = str(ensured.get("project_root", "") or chosen).strip()

    if current and os.path.isdir(current) and not _path_eq(current, chosen):
        try:
            core.copy_tree_contents(current, chosen)
        except Exception:
            pass
        for name in (".bidmanager_project.json", ".bidmanager_checklist.json"):
            src = os.path.join(current, name)
            dst = os.path.join(chosen, name)
            try:
                if os.path.isfile(src):
                    shutil.copy2(src, dst)
            except Exception:
                pass

    if not _path_eq(current, chosen):
        conn.execute("UPDATE projects SET folder_path=? WHERE id=?", (chosen, int(project_id)))

    return chosen


@app.get("/v1/projects/root-folder")
def get_projects_root_folder(archived: bool = False):
    root = _projects_root_for_status("Archived" if archived else "Active")
    if not root.startswith("gdrive://"):
        os.makedirs(root, exist_ok=True)
    if archived:
        with get_db() as conn:
            _migrate_archived_projects_to_archive_root(conn)
            conn.commit()
    return {"root_folder": root}


@app.get("/v1/projects", response_model=List[ProjectOut])
def list_projects(search: str = "", status: str = ""):
    with get_db() as conn:
        if str(status or "").strip().lower() == "archived":
            _migrate_archived_projects_to_archive_root(conn)
        if str(status or "").strip().lower() in ("", "active"):
            deduped = _dedupe_projects_by_tender_id(conn)
            if int(deduped or 0) > 0:
                conn.commit()
        conditions = []
        params = []
        if search:
            conditions.append(
                "(title LIKE ? OR client_name LIKE ? OR COALESCE(source_tender_id,'') LIKE ?)"
            )
            q = f"%{search}%"
            params.extend([q, q, q])
        if status:
            conditions.append("UPPER(TRIM(COALESCE(status,'')))=UPPER(TRIM(?))")
            params.append(status)
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = conn.execute(
            f"SELECT id, title, client_name, COALESCE(source_tender_id,'') as source_tender_id, "
            f"COALESCE(project_value,'') as project_value, COALESCE(prebid,'') as prebid, "
            f"deadline, status, description, folder_path "
            f"FROM projects {where} ORDER BY id DESC",
            params,
        ).fetchall()
        out = []
        changed = False
        for r in rows:
            d = dict(r)
            synced = _sync_project_folder(
                conn,
                int(d["id"]),
                str(d.get("title") or ""),
                str(d.get("source_tender_id") or ""),
                str(d.get("folder_path") or ""),
                str(d.get("status") or "Active"),
            )
            if not _path_eq(str(d.get("folder_path") or ""), synced):
                d["folder_path"] = synced
                changed = True
            _write_project_metadata_file(
                synced,
                str(d.get("title") or ""),
                str(d.get("client_name") or ""),
                str(d.get("source_tender_id") or ""),
                str(d.get("project_value") or ""),
                str(d.get("prebid") or ""),
                str(d.get("deadline") or ""),
                str(d.get("description") or ""),
                str(d.get("status") or "Active"),
            )
            out.append(d)
        if changed:
            conn.commit()
    return out


@app.post("/v1/projects", response_model=ProjectOut)
def create_project(body: ProjectCreate):
    with get_db() as conn:
        source_tender_id = str(body.source_tender_id or "").strip()
        title = str(body.title or "").strip()
        client_name = str(body.client_name or "").strip()
        project_value = str(body.project_value or "").strip()
        prebid = str(body.prebid or "").strip()
        deadline = str(body.deadline or "").strip()
        description = str(body.description or "").strip()
        status = str(body.status or "Active").strip() or "Active"
        if source_tender_id:
            matched_tender, _ = _find_tender_with_files(conn, source_tender_id)
            if matched_tender:
                title = title or str(matched_tender.get("title") or "").strip()
                client_name = client_name or str(matched_tender.get("org_chain") or "").strip()
                project_value = project_value or str(matched_tender.get("tender_value") or "").strip()
                prebid = prebid or str(matched_tender.get("pre_bid_meeting_date") or "").strip()
                deadline = deadline or str(matched_tender.get("closing_date") or "").strip()
                description = description or str(matched_tender.get("work_description") or "").strip()

        existing = None
        if source_tender_id:
            existing = conn.execute(
                "SELECT id, COALESCE(title,'') as title, COALESCE(client_name,'') as client_name, "
                "COALESCE(source_tender_id,'') as source_tender_id, COALESCE(project_value,'') as project_value, "
                "COALESCE(prebid,'') as prebid, COALESCE(deadline,'') as deadline, COALESCE(description,'') as description, "
                "COALESCE(status,'Active') as status, COALESCE(folder_path,'') as folder_path "
                "FROM projects WHERE LOWER(TRIM(COALESCE(source_tender_id,'')))=LOWER(TRIM(?)) "
                "ORDER BY CASE WHEN UPPER(TRIM(COALESCE(status,'')))='ACTIVE' THEN 0 ELSE 1 END, id DESC LIMIT 1",
                (source_tender_id,),
            ).fetchone()
        if existing:
            pid = int(existing["id"])
            next_title = title or str(existing["title"] or "")
            next_client_name = client_name or str(existing["client_name"] or "")
            next_source_tender_id = source_tender_id or str(existing["source_tender_id"] or "")
            next_project_value = project_value or str(existing["project_value"] or "")
            next_prebid = prebid or str(existing["prebid"] or "")
            next_deadline = deadline or str(existing["deadline"] or "")
            next_description = description or str(existing["description"] or "")
            next_status = status or str(existing["status"] or "Active")
            conn.execute(
                "UPDATE projects SET title=?, client_name=?, source_tender_id=?, project_value=?, prebid=?, deadline=?, description=?, status=? WHERE id=?",
                (
                    next_title,
                    next_client_name,
                    next_source_tender_id,
                    next_project_value,
                    next_prebid,
                    next_deadline,
                    next_description,
                    next_status,
                    pid,
                ),
            )
            synced = _sync_project_folder(
                conn,
                pid,
                next_title,
                next_source_tender_id,
                str(existing["folder_path"] or ""),
                next_status,
            )
            if next_source_tender_id:
                _copy_downloaded_tender_docs_to_project(conn, next_source_tender_id, synced)
            _write_project_metadata_file(
                synced,
                next_title,
                next_client_name,
                next_source_tender_id,
                next_project_value,
                next_prebid,
                next_deadline,
                next_description,
                next_status,
            )
            conn.commit()
            row = conn.execute(
                "SELECT id, title, client_name, COALESCE(source_tender_id,'') as source_tender_id, "
                "COALESCE(project_value,'') as project_value, COALESCE(prebid,'') as prebid, "
                "deadline, status, description, folder_path FROM projects WHERE id=?",
                (pid,),
            ).fetchone()
            if row:
                out = dict(row)
                out["folder_path"] = synced
                return out
            raise HTTPException(500, "Failed to return existing project")

        preferred_root = _project_folder_preferred(title, source_tender_id, status)
        if preferred_root.startswith("gdrive://"):
            folder_path = preferred_root
        else:
            created = core.ensure_project_standard_folders(preferred_root)
            folder_path = str(created.get("project_root", "") or "").strip()

        c = conn.cursor()
        c.execute(
            "INSERT INTO projects (title, client_name, source_tender_id, project_value, prebid, deadline, description, status, folder_path) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (title, client_name, source_tender_id, project_value, prebid, deadline, description, status, folder_path),
        )
        conn.commit()
        pid = c.lastrowid
        row = conn.execute(
            "SELECT id, title, client_name, COALESCE(source_tender_id,'') as source_tender_id, "
            "COALESCE(project_value,'') as project_value, COALESCE(prebid,'') as prebid, "
            "deadline, status, description, folder_path FROM projects WHERE id=?",
            (pid,),
        ).fetchone()
        if row:
            row_dict = dict(row)
            synced = _sync_project_folder(
                conn,
                int(pid),
                str(row_dict.get("title") or ""),
                str(row_dict.get("source_tender_id") or ""),
                str(row_dict.get("folder_path") or ""),
                str(row_dict.get("status") or "Active"),
            )
            if str(row_dict.get("source_tender_id") or "").strip():
                _copy_downloaded_tender_docs_to_project(
                    conn,
                    str(row_dict.get("source_tender_id") or ""),
                    synced,
                )
            _write_project_metadata_file(
                synced,
                str(row_dict.get("title") or ""),
                str(row_dict.get("client_name") or ""),
                str(row_dict.get("source_tender_id") or ""),
                str(row_dict.get("project_value") or ""),
                str(row_dict.get("prebid") or ""),
                str(row_dict.get("deadline") or ""),
                str(row_dict.get("description") or ""),
                str(row_dict.get("status") or "Active"),
            )
            conn.commit()
            row_dict["folder_path"] = synced
            return row_dict
    raise HTTPException(500, "Failed to create project")


def _read_json_file(path: str):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _read_project_metadata(folder_path: str):
    folder = str(folder_path or "").strip()
    if not folder:
        return None
    for name in ("project_info.json", ".bidmanager_project.json"):
        meta = _read_json_file(os.path.join(folder, name))
        if isinstance(meta, dict):
            return meta
    return None


def _read_json_list_file(path: str):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else None
    except Exception:
        return None


def _write_project_metadata_file(
    folder_path: str,
    title: str,
    client_name: str,
    source_tender_id: str,
    project_value: str,
    prebid: str,
    deadline: str,
    description: str,
    status: str,
):
    folder = str(folder_path or "").strip()
    if not folder:
        return
    if folder.startswith("gdrive://"):
        # Project metadata is authoritative in Postgres. Avoid creating a fake local
        # directory whose name merely resembles a Drive URI.
        return
    os.makedirs(folder, exist_ok=True)
    payload = {
        "title": str(title or "").strip(),
        "client_name": str(client_name or "").strip(),
        "source_tender_id": str(source_tender_id or "").strip(),
        "project_value": str(project_value or "").strip(),
        "prebid": str(prebid or "").strip(),
        "deadline": str(deadline or "").strip(),
        "description": str(description or "").strip(),
        "status": str(status or "Active").strip() or "Active",
        "folder_path": folder,
        "updated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }
    meta_path = os.path.join(folder, "project_info.json")
    tmp_path = meta_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, meta_path)


def _merge_project_rows(conn: sqlite3.Connection, keep_id: int, drop_id: int):
    if int(keep_id) == int(drop_id):
        return
    keep_count = conn.execute(
        "SELECT COUNT(*) FROM checklist_items WHERE project_id=?",
        (int(keep_id),),
    ).fetchone()[0]
    next_sr = int(keep_count or 0) + 1
    drop_rows = conn.execute(
        "SELECT COALESCE(req_file_name,'') as req_file_name, COALESCE(description,'') as description, "
        "COALESCE(subfolder,'Main') as subfolder, COALESCE(linked_file_path,'') as linked_file_path, "
        "COALESCE(status,'Pending') as status "
        "FROM checklist_items WHERE project_id=? ORDER BY COALESCE(sr_no,0), id",
        (int(drop_id),),
    ).fetchall()
    for r in drop_rows:
        conn.execute(
            "INSERT INTO checklist_items (project_id, sr_no, req_file_name, description, subfolder, linked_file_path, status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                int(keep_id),
                next_sr,
                str(r["req_file_name"] or ""),
                str(r["description"] or ""),
                str(r["subfolder"] or "Main") or "Main",
                str(r["linked_file_path"] or ""),
                str(r["status"] or "Pending") or "Pending",
            ),
        )
        next_sr += 1
    conn.execute("DELETE FROM checklist_items WHERE project_id=?", (int(drop_id),))
    conn.execute("DELETE FROM projects WHERE id=?", (int(drop_id),))


def _dedupe_projects_by_tender_id(conn: sqlite3.Connection) -> int:
    rows = conn.execute(
        "SELECT id, COALESCE(title,'') as title, COALESCE(client_name,'') as client_name, "
        "COALESCE(source_tender_id,'') as source_tender_id, COALESCE(project_value,'') as project_value, "
        "COALESCE(prebid,'') as prebid, COALESCE(deadline,'') as deadline, COALESCE(description,'') as description, "
        "COALESCE(status,'Active') as status, COALESCE(folder_path,'') as folder_path "
        "FROM projects ORDER BY id DESC"
    ).fetchall()
    updated_or_deleted = 0

    # Canonicalize malformed tender ids (e.g. "Test ZZ_TEST_...") and fill
    # missing tender ids from title/folder leaf when possible.
    for r in rows:
        pid = int(r["id"])
        source = str(r["source_tender_id"] or "").strip()
        title = str(r["title"] or "").strip()
        folder_path = str(r["folder_path"] or "").strip()
        folder_leaf = os.path.basename(folder_path.rstrip("\\/")) if folder_path else ""
        inferred = ""
        if source:
            source_fix = _extract_tender_id_from_text(source)
            if source_fix and _normalize_tender_id(source_fix) != _normalize_tender_id(source):
                inferred = source_fix
        if not inferred and not source:
            inferred_title = _extract_tender_id_from_text(title)
            inferred_folder = _extract_tender_id_from_text(folder_leaf)
            if inferred_title:
                inferred = inferred_title
            elif inferred_folder:
                inferred = inferred_folder
        if inferred:
            try:
                conn.execute("UPDATE projects SET source_tender_id=? WHERE id=?", (inferred, pid))
                updated_or_deleted += 1
            except sqlite3.IntegrityError:
                existing = conn.execute(
                    "SELECT id FROM projects WHERE LOWER(TRIM(COALESCE(source_tender_id,'')))=LOWER(TRIM(?)) LIMIT 1",
                    (inferred,),
                ).fetchone()
                if existing and int(existing["id"]) != pid:
                    _merge_project_rows(conn, int(existing["id"]), pid)
                    updated_or_deleted += 1

    rows = conn.execute(
        "SELECT id, COALESCE(title,'') as title, COALESCE(client_name,'') as client_name, "
        "COALESCE(source_tender_id,'') as source_tender_id, COALESCE(project_value,'') as project_value, "
        "COALESCE(prebid,'') as prebid, COALESCE(deadline,'') as deadline, COALESCE(description,'') as description, "
        "COALESCE(status,'Active') as status, COALESCE(folder_path,'') as folder_path "
        "FROM projects ORDER BY id DESC"
    ).fetchall()

    grouped = {}
    for r in rows:
        source = str(r["source_tender_id"] or "").strip()
        if not source:
            continue
        key = _normalize_tender_id(source)
        grouped.setdefault(key, []).append(r)

    for key, group in grouped.items():
        if len(group) <= 1:
            continue

        def _rank(row):
            status = str(row["status"] or "").strip().lower()
            active_rank = 0 if status == "active" else 1
            filled = sum(
                1 for v in (
                    row["title"], row["client_name"], row["project_value"], row["prebid"], row["deadline"], row["description"]
                ) if str(v or "").strip()
            )
            return (active_rank, -filled, -int(row["id"]))

        ordered = sorted(group, key=_rank)
        keep = ordered[0]
        keep_id = int(keep["id"])
        keep_title = str(keep["title"] or "").strip()
        keep_client = str(keep["client_name"] or "").strip()
        keep_value = str(keep["project_value"] or "").strip()
        keep_prebid = str(keep["prebid"] or "").strip()
        keep_deadline = str(keep["deadline"] or "").strip()
        keep_desc = str(keep["description"] or "").strip()
        keep_status = str(keep["status"] or "Active").strip() or "Active"
        keep_folder = str(keep["folder_path"] or "").strip()

        for drop in ordered[1:]:
            drop_id = int(drop["id"])
            if not keep_title:
                keep_title = str(drop["title"] or "").strip()
            if not keep_client:
                keep_client = str(drop["client_name"] or "").strip()
            if not keep_value:
                keep_value = str(drop["project_value"] or "").strip()
            if not keep_prebid:
                keep_prebid = str(drop["prebid"] or "").strip()
            if not keep_deadline:
                keep_deadline = str(drop["deadline"] or "").strip()
            if not keep_desc:
                keep_desc = str(drop["description"] or "").strip()
            if not keep_folder:
                keep_folder = str(drop["folder_path"] or "").strip()
            _merge_project_rows(conn, keep_id, drop_id)
            updated_or_deleted += 1

        conn.execute(
            "UPDATE projects SET title=?, client_name=?, project_value=?, prebid=?, deadline=?, description=?, status=?, folder_path=? WHERE id=?",
            (
                keep_title,
                keep_client,
                keep_value,
                keep_prebid,
                keep_deadline,
                keep_desc,
                keep_status,
                keep_folder,
                keep_id,
            ),
        )
        updated_or_deleted += 1

    # Secondary dedupe: merge blank-source rows with populated-source rows
    # when titles match (common in legacy rows restored from folders).
    rows = conn.execute(
        "SELECT id, COALESCE(title,'') as title, COALESCE(client_name,'') as client_name, "
        "COALESCE(source_tender_id,'') as source_tender_id, COALESCE(project_value,'') as project_value, "
        "COALESCE(prebid,'') as prebid, COALESCE(deadline,'') as deadline, COALESCE(description,'') as description, "
        "COALESCE(status,'Active') as status, COALESCE(folder_path,'') as folder_path "
        "FROM projects ORDER BY id DESC"
    ).fetchall()
    by_title = {}
    for r in rows:
        t = str(r["title"] or "").strip().lower()
        if t:
            by_title.setdefault(t, []).append(r)
    for _title_key, group in by_title.items():
        if len(group) <= 1:
            continue
        with_source = [g for g in group if str(g["source_tender_id"] or "").strip()]
        without_source = [g for g in group if not str(g["source_tender_id"] or "").strip()]
        if not with_source or not without_source:
            continue
        keep = sorted(with_source, key=lambda x: -int(x["id"]))[0]
        keep_id = int(keep["id"])
        for drop in without_source:
            drop_id = int(drop["id"])
            if drop_id == keep_id:
                continue
            _merge_project_rows(conn, keep_id, drop_id)
            updated_or_deleted += 1

    return updated_or_deleted



def _find_tender_for_restore(conn: sqlite3.Connection, source_tender_id: str, title: str, folder_name: str):
    candidates = []
    for raw in (source_tender_id, title, folder_name):
        txt = str(raw or "").strip()
        if txt:
            candidates.append(txt)
    if not candidates:
        return None

    base_select = (
        "SELECT id, COALESCE(tender_id,'') as tender_id, COALESCE(title,'') as title, "
        "COALESCE(org_chain,'') as org_chain, COALESCE(tender_value,'') as tender_value, "
        "COALESCE(pre_bid_meeting_date,'') as pre_bid_meeting_date, COALESCE(closing_date,'') as closing_date, "
        "COALESCE(work_description,'') as work_description, COALESCE(is_archived,0) as is_archived "
        "FROM tenders "
    )

    for cand in candidates:
        row = conn.execute(
            base_select
            + "WHERE TRIM(LOWER(COALESCE(tender_id,'')))=TRIM(LOWER(?)) "
            "ORDER BY COALESCE(is_archived,0) ASC, COALESCE(is_downloaded,0) DESC, id DESC LIMIT 1",
            (cand,),
        ).fetchone()
        if row:
            return dict(row)

    for cand in candidates:
        row = conn.execute(
            base_select
            + "WHERE TRIM(LOWER(COALESCE(title,'')))=TRIM(LOWER(?)) "
            "ORDER BY COALESCE(is_archived,0) ASC, COALESCE(is_downloaded,0) DESC, id DESC LIMIT 1",
            (cand,),
        ).fetchone()
        if row:
            return dict(row)

    for cand in candidates:
        row = conn.execute(
            base_select
            + "WHERE INSTR(LOWER(COALESCE(tender_id,'')), LOWER(?)) > 0 "
            "OR INSTR(LOWER(?), LOWER(COALESCE(tender_id,''))) > 0 "
            "ORDER BY COALESCE(is_archived,0) ASC, COALESCE(is_downloaded,0) DESC, id DESC LIMIT 1",
            (cand, cand),
        ).fetchone()
        if row:
            return dict(row)
    return None


@app.api_route("/v1/projects/restore-from-folders", methods=["GET", "POST"], response_model=RestoreProjectsResponse)
def restore_projects_from_folders():
    if admin_providers.active_storage_provider().metadata()["provider"] == "google-drive":
        raise HTTPException(
            501,
            "Folder-based project restoration is a local-mode recovery tool; cloud projects are restored from Postgres.",
        )
    root_folder = core._resolve_path(core.ROOT_FOLDER)
    if not os.path.isdir(root_folder):
        raise HTTPException(400, f"Projects root folder not found: {root_folder}")

    scanned_folders = 0
    created_projects = 0
    updated_projects = 0
    restored_checklist_items = 0

    folders = [
        os.path.join(root_folder, name)
        for name in sorted(os.listdir(root_folder))
        if os.path.isdir(os.path.join(root_folder, name))
    ]

    with get_db() as conn:
        conn.execute("PRAGMA foreign_keys=ON")
        _dedupe_projects_by_tender_id(conn)
        for folder_path in folders:
            scanned_folders += 1
            folder_name = os.path.basename(folder_path)
            meta_path = os.path.join(folder_path, "project_info.json")
            snapshot_path = os.path.join(folder_path, ".bidmanager_checklist.json")
            meta = _read_project_metadata(folder_path) or {}

            title = str(meta.get("title", "") or "").strip()
            client_name = str(meta.get("client_name", "") or "").strip()
            source_tender_id = str(meta.get("source_tender_id", "") or "").strip()
            project_value = str(meta.get("project_value", "") or "").strip()
            prebid = str(meta.get("prebid", "") or "").strip()
            deadline = str(meta.get("deadline", "") or "").strip()
            description = str(meta.get("description", "") or "").strip()
            status = str(meta.get("status", "Active") or "Active").strip() or "Active"
            if not source_tender_id and _looks_like_tender_id(folder_name):
                source_tender_id = folder_name
            if not source_tender_id and _looks_like_tender_id(title):
                source_tender_id = title
            matched_tender = _find_tender_for_restore(conn, source_tender_id, title, folder_name)
            if matched_tender:
                source_tender_id = source_tender_id or str(matched_tender.get("tender_id") or "").strip()
                title = title or str(matched_tender.get("title") or "").strip()
                client_name = client_name or str(matched_tender.get("org_chain") or "").strip()
                project_value = project_value or str(matched_tender.get("tender_value") or "").strip()
                prebid = prebid or str(matched_tender.get("pre_bid_meeting_date") or "").strip()
                deadline = deadline or str(matched_tender.get("closing_date") or "").strip()
                description = description or str(matched_tender.get("work_description") or "").strip()
            if not title:
                title = folder_name

            existing = None
            source_existing = None
            if source_tender_id:
                source_existing = conn.execute(
                    "SELECT id, title, client_name, source_tender_id, project_value, prebid, deadline, description, status, folder_path "
                    "FROM projects WHERE LOWER(TRIM(COALESCE(source_tender_id,'')))=LOWER(TRIM(?)) LIMIT 1",
                    (source_tender_id,),
                ).fetchone()
                existing = source_existing
            if not existing:
                existing = conn.execute(
                    "SELECT id, title, client_name, source_tender_id, project_value, prebid, deadline, description, status, folder_path "
                    "FROM projects WHERE folder_path=? LIMIT 1",
                    (folder_path,),
                ).fetchone()
            if not existing:
                # Recover existing rows created without source_tender_id by matching
                # normalized folder leaf to title/folder leaf in DB.
                existing = conn.execute(
                    "SELECT id, title, client_name, source_tender_id, project_value, prebid, deadline, description, status, folder_path "
                    "FROM projects "
                    "WHERE LOWER(TRIM(COALESCE(title,'')))=LOWER(TRIM(?)) "
                    "OR LOWER(TRIM(COALESCE(folder_path,''))) LIKE LOWER(?) "
                    "ORDER BY id DESC LIMIT 1",
                    (folder_name, f"%{folder_name}"),
                ).fetchone()

            # If we have a canonical project by tender-id and also a "ghost"
            # project row for this folder (usually blank source_tender_id +
            # title==folder_name), merge ghost into canonical to prevent
            # duplicate rows after restore.
            if source_existing:
                ghost = conn.execute(
                    "SELECT id, title, client_name, source_tender_id, project_value, prebid, deadline, description, status, folder_path "
                    "FROM projects "
                    "WHERE id<>? AND (folder_path=? OR LOWER(TRIM(COALESCE(title,'')))=LOWER(TRIM(?))) "
                    "ORDER BY id DESC LIMIT 1",
                    (int(source_existing["id"]), folder_path, folder_name),
                ).fetchone()
                if ghost:
                    ghost_source = str(ghost["source_tender_id"] or "").strip()
                    if not ghost_source or _normalize_tender_id(ghost_source) == _normalize_tender_id(source_tender_id):
                        _merge_project_rows(conn, int(source_existing["id"]), int(ghost["id"]))
                        existing = conn.execute(
                            "SELECT id, title, client_name, source_tender_id, project_value, prebid, deadline, description, status, folder_path "
                            "FROM projects WHERE id=? LIMIT 1",
                            (int(source_existing["id"]),),
                        ).fetchone()

            if not existing:
                c = conn.cursor()
                c.execute(
                    "INSERT INTO projects (title, client_name, source_tender_id, project_value, prebid, deadline, description, status, folder_path) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        title,
                        client_name,
                        source_tender_id,
                        project_value,
                        prebid,
                        deadline,
                        description,
                        status,
                        folder_path,
                    ),
                )
                project_id = c.lastrowid
                created_projects += 1
            else:
                project_id = int(existing["id"])
                # Prefer metadata values when present; otherwise keep DB values.
                next_title = title or str(existing["title"] or "")
                next_client = client_name or str(existing["client_name"] or "")
                next_source = source_tender_id or str(existing["source_tender_id"] or "")
                next_value = project_value or str(existing["project_value"] or "")
                next_prebid = prebid or str(existing["prebid"] or "")
                next_deadline = deadline or str(existing["deadline"] or "")
                next_desc = description or str(existing["description"] or "")
                next_status = status or str(existing["status"] or "Active")
                conn.execute(
                    "UPDATE projects SET title=?, client_name=?, source_tender_id=?, project_value=?, prebid=?, deadline=?, description=?, status=?, folder_path=? "
                    "WHERE id=?",
                    (
                        next_title,
                        next_client,
                        next_source,
                        next_value,
                        next_prebid,
                        next_deadline,
                        next_desc,
                        next_status,
                        folder_path,
                        project_id,
                    ),
                )
                # Remove duplicate rows for the same tender id, keeping this project only.
                if next_source:
                    conn.execute(
                        "DELETE FROM checklist_items WHERE project_id IN ("
                        "SELECT id FROM projects WHERE id<>? AND LOWER(TRIM(COALESCE(source_tender_id,'')))=LOWER(TRIM(?))"
                        ")",
                        (project_id, next_source),
                    )
                    conn.execute(
                        "DELETE FROM projects WHERE id<>? AND LOWER(TRIM(COALESCE(source_tender_id,'')))=LOWER(TRIM(?))",
                        (project_id, next_source),
                    )
                title = next_title
                client_name = next_client
                source_tender_id = next_source
                project_value = next_value
                prebid = next_prebid
                deadline = next_deadline
                description = next_desc
                status = next_status
                updated_projects += 1

            synced_folder = _sync_project_folder(
                conn,
                int(project_id),
                title,
                source_tender_id,
                folder_path,
                status,
            )
            _write_project_metadata_file(
                synced_folder,
                title,
                client_name,
                source_tender_id,
                project_value,
                prebid,
                deadline,
                description,
                status,
            )

            try:
                core.ensure_project_standard_folders(synced_folder)
            except Exception:
                pass

            existing_count = conn.execute(
                "SELECT COUNT(*) FROM checklist_items WHERE project_id=?",
                (project_id,),
            ).fetchone()[0]

            if int(existing_count or 0) == 0 and os.path.isfile(snapshot_path):
                rows = _read_json_list_file(snapshot_path) or []
                sr_no = 1
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    req_file_name = str(row.get("req_file_name", "") or "").strip()
                    description_row = str(row.get("description", "") or "").strip()
                    subfolder = str(row.get("subfolder", "Main") or "Main").strip() or "Main"
                    linked = str(row.get("linked_file_path", "") or "").strip()
                    status_row = str(row.get("status", "Pending") or "Pending").strip() or "Pending"
                    if not req_file_name and not description_row:
                        continue
                    conn.execute(
                        "INSERT INTO checklist_items (project_id, sr_no, req_file_name, description, subfolder, linked_file_path, status) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (
                            project_id,
                            sr_no,
                            req_file_name,
                            description_row,
                            subfolder,
                            linked,
                            status_row,
                        ),
                    )
                    sr_no += 1
                    restored_checklist_items += 1

        conn.commit()

    return {
        "root_folder": root_folder,
        "scanned_folders": scanned_folders,
        "created_projects": created_projects,
        "updated_projects": updated_projects,
        "restored_checklist_items": restored_checklist_items,
    }


@app.get("/v1/projects/{project_id}", response_model=ProjectOut)
def get_project(project_id: int):
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, title, client_name, COALESCE(source_tender_id,'') as source_tender_id, "
            "COALESCE(project_value,'') as project_value, COALESCE(prebid,'') as prebid, "
            "deadline, status, description, folder_path FROM projects WHERE id=?",
            (project_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Project not found")
        data = dict(row)
        synced = _sync_project_folder(
            conn,
            int(data["id"]),
            str(data.get("title") or ""),
            str(data.get("source_tender_id") or ""),
            str(data.get("folder_path") or ""),
            str(data.get("status") or "Active"),
        )
        if not _path_eq(str(data.get("folder_path") or ""), synced):
            data["folder_path"] = synced
            conn.commit()
        return data


@app.post("/v1/projects/{project_id}/ensure-folder")
def ensure_project_folder(project_id: int):
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, COALESCE(title,'') as title, COALESCE(client_name,'') as client_name, "
            "COALESCE(source_tender_id,'') as source_tender_id, COALESCE(project_value,'') as project_value, "
            "COALESCE(prebid,'') as prebid, COALESCE(deadline,'') as deadline, COALESCE(description,'') as description, "
            "COALESCE(folder_path,'') as folder_path, COALESCE(status,'Active') as status "
            "FROM projects WHERE id=?",
            (project_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Project not found")
        data = dict(row)
        synced = _sync_project_folder(
            conn,
            int(data["id"]),
            str(data.get("title") or ""),
            str(data.get("source_tender_id") or ""),
            str(data.get("folder_path") or ""),
            str(data.get("status") or "Active"),
        )
        _write_project_metadata_file(
            synced,
            str(data.get("title") or ""),
            str(data.get("client_name") or ""),
            str(data.get("source_tender_id") or ""),
            str(data.get("project_value") or ""),
            str(data.get("prebid") or ""),
            str(data.get("deadline") or ""),
            str(data.get("description") or ""),
            str(data.get("status") or "Active"),
        )
        _dedupe_projects_by_tender_id(conn)
        conn.commit()
    return {"ok": True, "folder_path": synced}


@app.patch("/v1/projects/{project_id}")
def update_project(project_id: int, body: ProjectPatch):
    updates = []
    params = []
    for field in ["title", "client_name", "source_tender_id", "project_value", "prebid", "deadline", "description", "status", "folder_path"]:
        val = getattr(body, field, None)
        if val is not None:
            updates.append(f"{field}=?")
            params.append(val)
    if not updates:
        raise HTTPException(400, "Nothing to update")
    params.append(project_id)
    with get_db() as conn:
        incoming_source_tender_id = getattr(body, "source_tender_id", None)
        normalized_incoming_source = _normalize_tender_id(str(incoming_source_tender_id or ""))
        if normalized_incoming_source:
            conflict = conn.execute(
                "SELECT id FROM projects WHERE id<>? AND LOWER(TRIM(COALESCE(source_tender_id,'')))=LOWER(TRIM(?)) LIMIT 1",
                (project_id, normalized_incoming_source),
            ).fetchone()
            if conflict:
                raise HTTPException(409, "A project with this Tender ID already exists.")
        conn.execute(f"UPDATE projects SET {', '.join(updates)} WHERE id=?", params)
        row = conn.execute(
            "SELECT id, title, COALESCE(client_name,'') as client_name, COALESCE(source_tender_id,'') as source_tender_id, "
            "COALESCE(project_value,'') as project_value, COALESCE(prebid,'') as prebid, COALESCE(deadline,'') as deadline, "
            "COALESCE(description,'') as description, COALESCE(folder_path,'') as folder_path, COALESCE(status,'Active') as status "
            "FROM projects WHERE id=?",
            (project_id,),
        ).fetchone()
        if row:
            synced = _sync_project_folder(
                conn,
                int(row["id"]),
                str(row["title"] or ""),
                str(row["source_tender_id"] or ""),
                str(row["folder_path"] or ""),
                str(row["status"] or "Active"),
            )
            if str(row["source_tender_id"] or "").strip():
                _copy_downloaded_tender_docs_to_project(
                    conn,
                    str(row["source_tender_id"] or ""),
                    synced,
                )
            _write_project_metadata_file(
                synced,
                str(row["title"] or ""),
                str(row["client_name"] or ""),
                str(row["source_tender_id"] or ""),
                str(row["project_value"] or ""),
                str(row["prebid"] or ""),
                str(row["deadline"] or ""),
                str(row["description"] or ""),
                str(row["status"] or "Active"),
            )
        conn.commit()
    return {"ok": True}


@app.post("/v1/projects/{project_id}/archive")
def archive_project(project_id: int):
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, COALESCE(title,'') as title, COALESCE(client_name,'') as client_name, "
            "COALESCE(source_tender_id,'') as source_tender_id, COALESCE(project_value,'') as project_value, "
            "COALESCE(prebid,'') as prebid, COALESCE(deadline,'') as deadline, COALESCE(description,'') as description, "
            "COALESCE(folder_path,'') as folder_path, COALESCE(status,'Active') as status "
            "FROM projects WHERE id=?",
            (project_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Project not found")

        current = str(row["folder_path"] or "").strip()
        archived_dest = _project_folder_preferred(
            str(row["title"] or ""),
            str(row["source_tender_id"] or ""),
            "Archived",
        )

        if archived_dest.startswith("gdrive://"):
            if current.startswith("gdrive://") and not _path_eq(current, archived_dest):
                admin_providers.drive_storage.copy_folder_contents(current, archived_dest)
        elif current and not _path_eq(current, archived_dest) and os.path.isdir(current):
            os.makedirs(os.path.dirname(archived_dest), exist_ok=True)
            final_dest = archived_dest
            if os.path.exists(final_dest):
                final_dest = f"{archived_dest}_{int(project_id)}"
            try:
                shutil.move(current, final_dest)
            except Exception:
                core.ensure_project_standard_folders(final_dest)
                core.copy_tree_contents(current, final_dest)
            archived_dest = final_dest
        else:
            ensured = core.ensure_project_standard_folders(archived_dest)
            archived_dest = str(ensured.get("project_root", archived_dest) or archived_dest).strip()

        conn.execute(
            "UPDATE projects SET status='Archived', folder_path=? WHERE id=?",
            (archived_dest, project_id),
        )
        _write_project_metadata_file(
            archived_dest,
            str(row["title"] or ""),
            str(row["client_name"] or ""),
            str(row["source_tender_id"] or ""),
            str(row["project_value"] or ""),
            str(row["prebid"] or ""),
            str(row["deadline"] or ""),
            str(row["description"] or ""),
            "Archived",
        )
        conn.commit()
    return {"ok": True, "folder_path": archived_dest}


@app.delete("/v1/projects/{project_id}")
def delete_project(project_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM checklist_items WHERE project_id=?", (project_id,))
        conn.execute("DELETE FROM projects WHERE id=?", (project_id,))
        conn.commit()
    return {"ok": True}


# -- Checklist Items --

@app.get("/v1/projects/{project_id}/checklist", response_model=List[ChecklistItemOut])
def list_checklist(project_id: int):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, project_id, sr_no, req_file_name, description, subfolder, "
            "linked_file_path, status FROM checklist_items WHERE project_id=? ORDER BY sr_no",
            (project_id,),
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/v1/projects/{project_id}/checklist", response_model=ChecklistItemOut)
def create_checklist_item(project_id: int, body: ChecklistItemCreate):
    with get_db() as conn:
        exists = conn.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone()
        if not exists:
            raise HTTPException(404, "Project not found")

        if body.sr_no is None:
            row = conn.execute(
                "SELECT COALESCE(MAX(sr_no),0)+1 FROM checklist_items WHERE project_id=?",
                (project_id,),
            ).fetchone()
            sr_no = int(row[0] if row else 1)
        else:
            sr_no = int(body.sr_no)

        c = conn.cursor()
        c.execute(
            "INSERT INTO checklist_items (project_id, sr_no, req_file_name, description, subfolder, linked_file_path, status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                project_id,
                sr_no,
                body.req_file_name,
                body.description,
                body.subfolder,
                body.linked_file_path,
                body.status or "Pending",
            ),
        )
        conn.commit()
        item_id = c.lastrowid
        row = conn.execute(
            "SELECT id, project_id, sr_no, req_file_name, description, subfolder, linked_file_path, status "
            "FROM checklist_items WHERE id=?",
            (item_id,),
        ).fetchone()
    return dict(row)


@app.patch("/v1/checklist/{item_id}")
def update_checklist_item(item_id: int, body: ChecklistItemPatch):
    updates = []
    params = []
    for field in ["sr_no", "req_file_name", "description", "subfolder", "linked_file_path", "status"]:
        val = getattr(body, field, None)
        if val is not None:
            updates.append(f"{field}=?")
            params.append(val)
    if not updates:
        raise HTTPException(400, "Nothing to update")
    params.append(item_id)
    with get_db() as conn:
        row = conn.execute("SELECT 1 FROM checklist_items WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Checklist item not found")
        conn.execute(f"UPDATE checklist_items SET {', '.join(updates)} WHERE id=?", params)
        conn.commit()
    return {"ok": True}


@app.delete("/v1/checklist/{item_id}")
def delete_checklist_item(item_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT 1 FROM checklist_items WHERE id=?", (item_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Checklist item not found")
        conn.execute("DELETE FROM checklist_items WHERE id=?", (item_id,))
        conn.commit()
    return {"ok": True}


# -- Templates --

@app.get("/v1/templates", response_model=List[TemplateOut])
def list_templates(organization: str = ""):
    with get_db() as conn:
        if organization:
            rows = conn.execute(
                "SELECT id, template_no, organization, template_name, description, notes "
                "FROM checklist_templates WHERE organization LIKE ? ORDER BY organization, template_name",
                (f"%{organization}%",),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, template_no, organization, template_name, description, notes "
                "FROM checklist_templates ORDER BY organization, template_name"
            ).fetchall()
    return [dict(r) for r in rows]


@app.post("/v1/templates", response_model=TemplateOut)
def create_template(body: TemplateCreate):
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO checklist_templates (template_no, organization, template_name, description, notes) VALUES (?,?,?,?,?)",
            (body.template_no, body.organization.strip(), body.template_name.strip(), body.description, body.notes),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id, template_no, organization, template_name, description, notes FROM checklist_templates WHERE id=?",
            (cur.lastrowid,),
        ).fetchone()
    return dict(row)


@app.patch("/v1/templates/{template_id}", response_model=TemplateOut)
def update_template(template_id: int, body: TemplatePatch):
    with get_db() as conn:
        row = conn.execute("SELECT id FROM checklist_templates WHERE id=?", (template_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Template not found")
        fields = {k: v for k, v in body.dict().items() if v is not None}
        if fields:
            sets = ", ".join(f"{k}=?" for k in fields)
            conn.execute(f"UPDATE checklist_templates SET {sets} WHERE id=?", (*fields.values(), template_id))
            conn.commit()
        row = conn.execute(
            "SELECT id, template_no, organization, template_name, description, notes FROM checklist_templates WHERE id=?",
            (template_id,),
        ).fetchone()
    return dict(row)


@app.delete("/v1/templates/{template_id}")
def delete_template(template_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM checklist_templates WHERE id=?", (template_id,))
        conn.commit()
    return {"ok": True}


@app.get("/v1/templates/{template_id}/items", response_model=List[TemplateItemOut])
def list_template_items(template_id: int):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, template_id, sr_no, req_file_name, description, subfolder "
            "FROM checklist_template_items WHERE template_id=? ORDER BY sr_no, id",
            (template_id,),
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/v1/templates/{template_id}/items", response_model=TemplateItemOut)
def create_template_item(template_id: int, body: TemplateItemCreate):
    with get_db() as conn:
        tpl = conn.execute("SELECT id FROM checklist_templates WHERE id=?", (template_id,)).fetchone()
        if not tpl:
            raise HTTPException(404, "Template not found")
        if body.sr_no is None:
            row = conn.execute(
                "SELECT COALESCE(MAX(sr_no), 0) FROM checklist_template_items WHERE template_id=?", (template_id,)
            ).fetchone()
            sr_no = (row[0] or 0) + 1
        else:
            sr_no = body.sr_no
        cur = conn.execute(
            "INSERT INTO checklist_template_items (template_id, sr_no, req_file_name, description, subfolder) VALUES (?,?,?,?,?)",
            (template_id, sr_no, body.req_file_name, body.description, body.subfolder or "Ready Docs"),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id, template_id, sr_no, req_file_name, description, subfolder FROM checklist_template_items WHERE id=?",
            (cur.lastrowid,),
        ).fetchone()
    return dict(row)


@app.delete("/v1/template-items/{item_id}")
def delete_template_item(item_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM checklist_template_items WHERE id=?", (item_id,))
        conn.commit()
    return {"ok": True}


@app.post("/v1/projects/{project_id}/save-as-template", response_model=TemplateOut)
def save_project_as_template(project_id: int, body: SaveAsTemplateRequest):
    with get_db() as conn:
        proj = conn.execute("SELECT id FROM projects WHERE id=?", (project_id,)).fetchone()
        if not proj:
            raise HTTPException(404, "Project not found")
        cur = conn.execute(
            "INSERT INTO checklist_templates (template_no, organization, template_name, description, notes) VALUES (?,?,?,?,?)",
            (body.template_no, body.organization.strip(), body.template_name.strip(), body.description, body.notes),
        )
        tpl_id = cur.lastrowid
        items = conn.execute(
            "SELECT sr_no, req_file_name, description, subfolder FROM checklist_items WHERE project_id=? ORDER BY sr_no, id",
            (project_id,),
        ).fetchall()
        for item in items:
            conn.execute(
                "INSERT INTO checklist_template_items (template_id, sr_no, req_file_name, description, subfolder) VALUES (?,?,?,?,?)",
                (tpl_id, item["sr_no"], item["req_file_name"], item["description"], item["subfolder"]),
            )
        conn.commit()
        row = conn.execute(
            "SELECT id, template_no, organization, template_name, description, notes FROM checklist_templates WHERE id=?",
            (tpl_id,),
        ).fetchone()
    return dict(row)


@app.post("/v1/projects/{project_id}/apply-template/{template_id}")
def apply_template_to_project(project_id: int, template_id: int):
    with get_db() as conn:
        proj = conn.execute("SELECT id FROM projects WHERE id=?", (project_id,)).fetchone()
        if not proj:
            raise HTTPException(404, "Project not found")
        tpl = conn.execute("SELECT id FROM checklist_templates WHERE id=?", (template_id,)).fetchone()
        if not tpl:
            raise HTTPException(404, "Template not found")
        items = conn.execute(
            "SELECT sr_no, req_file_name, description, subfolder FROM checklist_template_items WHERE template_id=? ORDER BY sr_no, id",
            (template_id,),
        ).fetchall()
        existing_names = {
            str(r[0] or "").strip().lower()
            for r in conn.execute("SELECT req_file_name FROM checklist_items WHERE project_id=?", (project_id,)).fetchall()
        }
        max_sr = conn.execute(
            "SELECT COALESCE(MAX(sr_no), 0) FROM checklist_items WHERE project_id=?", (project_id,)
        ).fetchone()[0] or 0
        added = 0
        for item in items:
            name = str(item["req_file_name"] or "").strip()
            if name.lower() in existing_names:
                continue
            max_sr += 1
            conn.execute(
                "INSERT INTO checklist_items (project_id, sr_no, req_file_name, description, subfolder, status) VALUES (?,?,?,?,?,?)",
                (project_id, max_sr, item["req_file_name"], item["description"], item["subfolder"] or "Ready Docs", "Pending"),
            )
            if name:
                existing_names.add(name.lower())
            added += 1
        conn.commit()
    return {"ok": True, "added": added}


# -- Dashboard Stats --

@app.get("/v1/stats/dashboard", response_model=DashboardStats)
def dashboard_stats():
    with get_db() as conn:
        active = conn.execute(
            "SELECT COUNT(*) FROM tenders WHERE COALESCE(is_archived,0)=0"
        ).fetchone()[0]
        archived = conn.execute(
            "SELECT COUNT(*) FROM tenders WHERE COALESCE(is_archived,0)=1"
        ).fetchone()[0]
        projects = conn.execute(
            "SELECT COUNT(*) FROM projects WHERE status='Active'"
        ).fetchone()[0]
        bookmarked = conn.execute(
            "SELECT COUNT(*) FROM tenders WHERE COALESCE(is_bookmarked,0)=1 AND COALESCE(is_archived,0)=0"
        ).fetchone()[0]

        # Pipeline value
        rows = conn.execute(
            "SELECT tender_value FROM tenders WHERE COALESCE(is_archived,0)=0 AND COALESCE(is_downloaded,0)=1"
        ).fetchall()
        total_value = 0
        for r in rows:
            val = str(r[0] or "").replace(",", "").replace("Ã¢â€šÂ¹", "").strip()
            if val.isdigit():
                total_value += int(val)

        # Websites summary
        websites = []
        for w in conn.execute("SELECT id, name FROM websites").fetchall():
            org_count = conn.execute(
                "SELECT COUNT(*) FROM organizations WHERE website_id=?", (w["id"],)
            ).fetchone()[0]
            tender_count = conn.execute(
                "SELECT COUNT(*) FROM tenders WHERE website_id=? AND COALESCE(is_archived,0)=0",
                (w["id"],),
            ).fetchone()[0]
            selected_orgs = conn.execute(
                "SELECT COUNT(*) FROM organizations WHERE website_id=? AND is_selected=1",
                (w["id"],),
            ).fetchone()[0]
            websites.append({
                "id": w["id"], "name": w["name"],
                "orgs": org_count, "active_tenders": tender_count,
                "selected_orgs": selected_orgs,
            })

        # Upcoming deadlines (nearest 10)
        deadline_rows = conn.execute(
            "SELECT tender_id, title, closing_date, org_chain "
            "FROM tenders WHERE COALESCE(is_archived,0)=0 "
            "ORDER BY closing_date ASC LIMIT 10"
        ).fetchall()
        upcoming = [dict(r) for r in deadline_rows]

    return DashboardStats(
        active_tenders=active,
        archived_tenders=archived,
        active_projects=projects,
        bookmarked_tenders=bookmarked,
        total_pipeline_value=total_value,
        websites=websites,
        upcoming_deadlines=upcoming,
    )
# -- Settings --

@app.get("/v1/settings")
def get_settings():
    with get_db() as conn:
        rows = conn.execute("SELECT key, value FROM app_settings").fetchall()
    out = {r["key"]: r["value"] for r in rows}
    try:
        paths = core.load_app_paths_config()
        db_file = str(paths.get("db_file", "") or "")
        root_folder = str(paths.get("root_folder", "") or "")
        parent_dir = ""
        if db_file:
            parent_dir = os.path.dirname(db_file)
        if not parent_dir and root_folder:
            parent_dir = os.path.dirname(root_folder)
        parent_dir = core._resolve_path(parent_dir) if parent_dir else ""
        out.setdefault("parent_dir", parent_dir)
        out.setdefault("db_file", str(paths.get("db_file", "")))
        out.setdefault("projects_dir", str(paths.get("root_folder", "")))
        out.setdefault("download_dir", str(paths.get("download_folder", "")))
        out.setdefault("template_dir", str(paths.get("template_folder", "")))
        out.setdefault("update_directory", core._resolve_path(os.path.join(parent_dir, "Updates")) if parent_dir else "")
    except Exception:
        pass
    return security.redact_public_settings(out, cloud=security.is_cloud_environment())


@app.patch("/v1/settings")
def update_settings(body: dict):
    if security.is_cloud_environment() and any(
        key in body
        for key in ("parent_dir", "db_file", "projects_dir", "download_dir", "template_dir", "update_directory")
    ):
        raise HTTPException(400, "Filesystem paths are runtime-managed in staging and production.")
    with get_db() as conn:
        for key, value in body.items():
            conn.execute(
                "INSERT INTO app_settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (str(key), str(value)),
            )
        conn.commit()
    core.ScraperBackend.invalidate_settings_cache()
    # Keep filesystem path config in sync with app_paths.json used by scraper core.
    try:
        current = core.load_app_paths_config()
        parent_dir_raw = str(body.get("parent_dir", "") or "").strip()
        if parent_dir_raw:
            parent_dir = core._resolve_path(parent_dir_raw)
            db_file = core._resolve_path(os.path.join(parent_dir, "tender_manager.db"))
            root_folder = core._resolve_path(os.path.join(parent_dir, "My_Tender_Projects"))
            download_folder = core._resolve_path(os.path.join(parent_dir, "Tender_Downloads"))
            template_folder = core._resolve_path(os.path.join(parent_dir, "Checklist_Templates"))
            body["db_file"] = db_file
            body["projects_dir"] = root_folder
            body["download_dir"] = download_folder
            body["template_dir"] = template_folder
            body["update_directory"] = str(body.get("update_directory") or core._resolve_path(os.path.join(parent_dir, "Updates")))
        else:
            db_file = str(body.get("db_file", current.get("db_file", core.DB_FILE)) or current.get("db_file", core.DB_FILE))
            root_folder = str(body.get("projects_dir", current.get("root_folder", core.ROOT_FOLDER)) or current.get("root_folder", core.ROOT_FOLDER))
            download_folder = str(body.get("download_dir", current.get("download_folder", core.BASE_DOWNLOAD_DIRECTORY)) or current.get("download_folder", core.BASE_DOWNLOAD_DIRECTORY))
            template_folder = str(body.get("template_dir", current.get("template_folder", core.TEMPLATE_LIBRARY_FOLDER)) or current.get("template_folder", core.TEMPLATE_LIBRARY_FOLDER))
        core.save_app_paths_config(db_file, root_folder, download_folder, template_folder)
    except Exception:
        pass
    return {"ok": True}


def _server_storage_root() -> str:
    root = core._resolve_path(core.BASE_DOWNLOAD_DIRECTORY)
    os.makedirs(root, exist_ok=True)
    return root


def _resolve_storage_rel_path(rel_path: str) -> tuple[str, str]:
    root = _server_storage_root()
    rel = str(rel_path or "").strip().replace("\\", "/").strip("/")
    target = os.path.normpath(os.path.join(root, rel)) if rel else root
    root_norm = os.path.normcase(os.path.abspath(root))
    target_norm = os.path.normcase(os.path.abspath(target))
    if target_norm != root_norm and not target_norm.startswith(root_norm + os.sep):
        raise HTTPException(400, "Invalid path.")
    rel_norm = os.path.relpath(target, root)
    rel_out = "" if rel_norm in (".", "") else rel_norm.replace("\\", "/")
    return target, rel_out


@app.get("/v1/server/storage", response_model=StorageListResponse)
def list_server_storage(rel_path: str = "", limit: int = Query(default=3000, ge=1, le=10000)):
    provider = admin_providers.active_storage_provider()
    if provider.metadata()["provider"] == "google-drive":
        try:
            listing = provider.list_items(rel_path)
        except ValueError as exc:
            raise HTTPException(404, str(exc))
        rows = []
        for item in listing.get("folders", []):
            rows.append(
                {
                    "name": item.get("name"),
                    "rel_path": item.get("path"),
                    "is_dir": True,
                    "size_bytes": 0,
                    "modified_at": item.get("modified") or "",
                }
            )
        for item in listing.get("files", []):
            rows.append(
                {
                    "name": item.get("name"),
                    "rel_path": item.get("path"),
                    "is_dir": False,
                    "size_bytes": int(item.get("sizeBytes") or 0),
                    "modified_at": item.get("modified") or "",
                }
            )
        normalized = admin_providers.drive_storage.normalize_relative_path(rel_path)
        parent = "/".join(normalized.split("/")[:-1]) if normalized else ""
        return {
            "root_folder": f"gdrive://{os.getenv('GOOGLE_DRIVE_FOLDER_ID', '').strip()}",
            "current_rel_path": normalized,
            "parent_rel_path": parent,
            "items": rows[:limit],
        }
    root = _server_storage_root()
    target, rel_out = _resolve_storage_rel_path(rel_path)
    if not os.path.isdir(target):
        raise HTTPException(404, "Folder not found.")

    rows: list[dict] = []
    for name in sorted(os.listdir(target), key=lambda x: x.lower()):
        full = os.path.join(target, name)
        try:
            stat = os.stat(full)
        except Exception:
            continue
        is_dir = os.path.isdir(full)
        child_rel = os.path.relpath(full, root).replace("\\", "/")
        rows.append(
            {
                "name": name,
                "rel_path": child_rel if child_rel != "." else "",
                "is_dir": is_dir,
                "size_bytes": 0 if is_dir else int(stat.st_size or 0),
                "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            }
        )
        if len(rows) >= limit:
            break

    parent_rel = ""
    if rel_out:
        parent_rel = os.path.dirname(rel_out).replace("\\", "/")
        if parent_rel == ".":
            parent_rel = ""

    return {
        "root_folder": root,
        "current_rel_path": rel_out,
        "parent_rel_path": parent_rel,
        "items": rows,
    }


@app.delete("/v1/server/storage/folder")
def delete_server_storage_folder(body: StorageDeleteFolderRequest):
    provider = admin_providers.active_storage_provider()
    if provider.metadata()["provider"] == "google-drive":
        normalized = admin_providers.drive_storage.normalize_relative_path(body.rel_path)
        if not normalized:
            raise HTTPException(400, "Cannot delete root folder.")
        folder = admin_providers.drive_storage.resolve_path(normalized, require_folder=True)
        if not folder:
            raise HTTPException(404, "Folder not found.")
        try:
            provider.delete(normalized)
        except ValueError as exc:
            raise HTTPException(404, str(exc))
        return {
            "ok": True,
            "deleted_rel_path": normalized,
            "root_folder": f"gdrive://{os.getenv('GOOGLE_DRIVE_FOLDER_ID', '').strip()}",
        }
    target, rel_out = _resolve_storage_rel_path(body.rel_path)
    root = _server_storage_root()
    if not rel_out:
        raise HTTPException(400, "Cannot delete root folder.")
    if not os.path.isdir(target):
        raise HTTPException(404, "Folder not found.")
    try:
        shutil.rmtree(target)
    except Exception as e:
        raise HTTPException(500, f"Failed to delete folder: {e}")
    return {"ok": True, "deleted_rel_path": rel_out, "root_folder": root}


@app.post("/v1/server/storage/delete-older", response_model=StorageDeleteOlderResponse)
def delete_older_storage_files(body: StorageDeleteOlderRequest):
    days = max(1, int(body.days or 30))
    cutoff = datetime.now().timestamp() - (days * 24 * 60 * 60)

    deleted_files = 0
    deleted_dirs = 0
    provider = admin_providers.active_storage_provider()
    if provider.metadata()["provider"] == "google-drive":
        try:
            items = admin_providers.drive_storage.walk_folder(body.rel_path)
            folders = []
            for path, item in items:
                if item.get("mimeType") == admin_providers.drive_storage.DRIVE_FOLDER_MIME:
                    folders.append((path, item))
                    continue
                modified = str(item.get("modifiedTime") or "").replace("Z", "+00:00")
                try:
                    modified_ts = datetime.fromisoformat(modified).timestamp()
                except Exception:
                    continue
                if modified_ts < cutoff:
                    admin_providers.drive_storage._drive_service().files().delete(
                        fileId=item["id"], supportsAllDrives=True
                    ).execute()
                    deleted_files += 1
            for path, item in sorted(folders, key=lambda pair: pair[0].count("/"), reverse=True):
                if not admin_providers.drive_storage.list_folder(path):
                    admin_providers.drive_storage._drive_service().files().delete(
                        fileId=item["id"], supportsAllDrives=True
                    ).execute()
                    deleted_dirs += 1
            return {"deleted_files": deleted_files, "deleted_dirs": deleted_dirs}
        except ValueError as exc:
            raise HTTPException(404, str(exc))

    target, _rel_out = _resolve_storage_rel_path(body.rel_path)
    if not os.path.isdir(target):
        raise HTTPException(404, "Folder not found.")

    for root_dir, dirs, files in os.walk(target, topdown=False):
        for fname in files:
            fpath = os.path.join(root_dir, fname)
            try:
                if os.path.getmtime(fpath) < cutoff:
                    os.remove(fpath)
                    deleted_files += 1
            except Exception:
                continue
        for dname in dirs:
            dpath = os.path.join(root_dir, dname)
            try:
                if not os.listdir(dpath):
                    os.rmdir(dpath)
                    deleted_dirs += 1
            except Exception:
                continue

    return {"deleted_files": deleted_files, "deleted_dirs": deleted_dirs}


# -- Admin API --

ADMIN_CONFIG_KEYS = {
    "schedule_enabled": "false",
    "scrape_interval_minutes": "60",
    "portal_mahatenders": "true",
    "portal_etenders": "true",
    "portal_eprocure": "false",
    "max_concurrent_sessions": "1",
    "page_load_timeout_s": "45",
    "download_session_idle_min": "15",
    "retry_attempts": "3",
    "retry_backoff_s": "20",
    "headless": "true",
    "browser": "firefox",
    "rotate_user_agent": "true",
    "proxy_pool": "none",
    "captcha_ai_provider": "manual",
    "captcha_ai_model": "gemini-3.7-flash",
    "captcha_ai_api_key": "",
    "captcha_ai_endpoint": "",
    "captcha_max_attempts": "4",
    "captcha_confidence_min": "0.72",
    "captcha_manual_fallback": "true",
    "captcha_handover_after_attempts": "2",
    "captcha_manual_wait_s": "180",
    "captcha_alert_channel": "desktop",
    "captcha_on_no_answer": "requeue",
    "auto_download_documents": "true",
    "max_file_size_mb": "80",
    "allowed_extensions": "pdf, zip, rar, xls, xlsx, doc, docx",
    "gcs_bucket": "",
    "storage_prefix": "tenders/",
    "signed_url_ttl_min": "15",
    "dedupe_by_tender_id": "true",
    "job_ttl_minutes": "45",
    "max_queue_depth": "25",
    "poll_interval_ms": "1200",
    "read_only_mode": "false",
    "require_admin_key": "true",
    "scheduler_paused": "false",
    "drain_mode": "false",
    "archive_daily_enabled": "true",
    "archive_daily_hour": "20",
    "scheduler_downtime_from": "",
    "scheduler_downtime_to": "",
}

ADMIN_CONFIG_ALIASES = {}


class AdminConfigPatch(BaseModel):
    settings: dict


class AdminScrapeStart(BaseModel):
    website_id: int
    refresh_organizations: bool = True


class AdminCaptchaAnswer(BaseModel):
    answer: str = ""


class AdminCaptchaSkip(BaseModel):
    action: str = "requeue"


class AdminStorageFolder(BaseModel):
    prefix: str = ""
    name: str = ""


class AdminStorageDelete(BaseModel):
    path: str = ""


class AdminStorageSignedUrl(BaseModel):
    path: str = ""


def require_admin_key(
    request: Request,
    x_admin_key: Optional[str] = Header(default=None),
) -> None:
    expected = os.getenv("ADMIN_API_KEY", "").strip()
    if not expected:
        # Preserve zero-configuration local Electron/dev operation, but never
        # extend that exception to LAN callers or a Cloud Run deployment.
        if not security.is_cloud_environment() and _request_is_local(request):
            return
        raise HTTPException(503, "ADMIN_API_KEY is not configured on the backend.")
    query_key = request.query_params.get("admin_key") if request.url.path == "/admin/logs/stream" else ""
    provided = (x_admin_key or query_key or "").strip()
    if not security.secure_equals(provided, expected):
        raise HTTPException(401, "Invalid or missing admin key.")


def _validated_saved_custom_job(body: SavedCustomJobRequest) -> dict:
    owner = " ".join(str(body.owner_name or "").split())
    name = " ".join(str(body.name or "").split())
    job_type = str(body.job_type or "").strip().lower()
    mode = str(body.download_mode or "full").strip().lower()
    interval = max(0, int(body.interval_minutes or 0))
    schedule_mode = str(body.schedule_mode or "").strip().lower()
    if not schedule_mode:
        schedule_mode = "interval" if body.schedule_enabled else "manual"
    if schedule_mode not in {"manual", "once", "interval"}:
        raise HTTPException(400, "schedule_mode must be manual, once, or interval")
    schedule_enabled = schedule_mode != "manual"
    try:
        scheduled_for_at = max(0.0, float(body.scheduled_for_at or 0))
    except (TypeError, ValueError):
        raise HTTPException(400, "scheduled_for_at must be a Unix timestamp")
    if not owner or len(owner) > 100:
        raise HTTPException(400, "owner_name is required and must be at most 100 characters")
    if not name or len(name) > 160:
        raise HTTPException(400, "name is required and must be at most 160 characters")
    if job_type not in {"scrape", "download"}:
        raise HTTPException(400, "job_type must be scrape or download")
    if mode not in {"auto", "full", "update"}:
        raise HTTPException(400, "download_mode must be auto, full, or update")
    if schedule_mode == "interval" and interval <= 0:
        raise HTTPException(400, "A positive interval_minutes is required for a repeating job")
    now = time.time()
    if schedule_enabled and scheduled_for_at <= 0:
        scheduled_for_at = now + interval * 60 if schedule_mode == "interval" else 0
    if schedule_enabled and scheduled_for_at <= now:
        raise HTTPException(400, "Choose a scheduled date and time in the future")
    org_ids = sorted({int(value) for value in (body.org_ids or []) if int(value) > 0})
    tender_ids = sorted({int(value) for value in (body.tender_ids or []) if int(value) > 0})
    all_organizations = bool(body.all_organizations) and job_type == "scrape"
    with get_db() as conn:
        website = conn.execute("SELECT id FROM websites WHERE id=?", (int(body.website_id),)).fetchone()
        if not website:
            raise HTTPException(404, "Website not found")
        _selected_ids_by_website(conn, "organizations", org_ids, require_all=True)
        _selected_ids_by_website(conn, "tenders", tender_ids, require_all=True)
    if job_type == "scrape" and not org_ids and not all_organizations:
        raise HTTPException(400, "Select at least one organization, or choose to scrape the entire website")
    if job_type == "download" and not tender_ids:
        raise HTTPException(400, "Select at least one tender")
    return {
        "owner_name": owner, "name": name, "website_id": int(body.website_id),
        "job_type": job_type, "org_ids": org_ids, "tender_ids": tender_ids,
        "all_organizations": all_organizations, "all_tenders": False,
        "download_mode": mode, "schedule_enabled": schedule_enabled,
        "schedule_mode": schedule_mode, "interval_minutes": interval,
        "scheduled_for_at": scheduled_for_at,
    }


@app.get("/admin/bookmark-scrape/suppressed")
def list_bookmark_scrape_suppressed(_auth: None = Depends(require_admin_key)):
    # Websites where an admin deleted the auto-managed "Bookmarks · <site>" job.
    with get_db() as conn:
        rows = conn.execute(
            "SELECT b.website_id, COALESCE(w.name,''), b.suppressed_at "
            "FROM bookmark_scrape_suppressed b LEFT JOIN websites w ON w.id=b.website_id "
            "ORDER BY b.suppressed_at DESC"
        ).fetchall()
    return {"items": [
        {"website_id": int(r[0]), "website_name": str(r[1] or f"Website {int(r[0])}"),
         "suppressed_at": float(r[2] or 0)}
        for r in rows
    ]}


class BookmarkScrapeResumeRequest(BaseModel):
    website_id: int


@app.post("/admin/bookmark-scrape/resume")
def resume_bookmark_scrape(body: BookmarkScrapeResumeRequest, _auth: None = Depends(require_admin_key)):
    with get_db() as conn:
        conn.execute("DELETE FROM bookmark_scrape_suppressed WHERE website_id=?", (int(body.website_id),))
        conn.commit()
    try:
        import client_api
        client_api._reconcile_bookmark_jobs()
    except Exception:
        pass
    return {"ok": True}


@app.get("/admin/custom-jobs")
def list_saved_custom_jobs(owner: str, _auth: None = Depends(require_admin_key)):
    owner_name = " ".join(str(owner or "").split())
    with get_db() as conn:
        if owner_name in {"", "*", "all"}:
            rows = conn.execute(
                _SAVED_CUSTOM_JOB_SELECT + "ORDER BY updated_at DESC,id DESC"
            ).fetchall()
        else:
            rows = conn.execute(
                _SAVED_CUSTOM_JOB_SELECT + "WHERE owner_name=? ORDER BY updated_at DESC,id DESC",
                (owner_name,),
            ).fetchall()
    return {"jobs": [_saved_custom_job_from_row(row) for row in rows]}


class SavedJobScheduleRequest(BaseModel):
    enabled: bool


@app.post("/admin/custom-jobs/{saved_job_id}/schedule")
def set_saved_custom_job_schedule(
    saved_job_id: int, body: SavedJobScheduleRequest, _auth: None = Depends(require_admin_key)
):
    # Pause / resume a saved job without editing its targets. Used for the
    # auto-managed "Bookmarks" jobs, which are otherwise not editable.
    now = time.time()
    with get_db() as conn:
        row = conn.execute(
            "SELECT interval_minutes FROM saved_custom_jobs WHERE id=?", (int(saved_job_id),)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Saved custom job not found")
        if body.enabled:
            interval = int((dict(row).get("interval_minutes") if hasattr(row, "get") else row[0]) or 0) or 1440
            conn.execute(
                "UPDATE saved_custom_jobs SET schedule_enabled=1,schedule_mode='interval',"
                "interval_minutes=?,next_run_at=?,scheduled_for_at=?,updated_at=? WHERE id=?",
                (interval, now + interval * 60, now + interval * 60, now, int(saved_job_id)),
            )
        else:
            conn.execute(
                "UPDATE saved_custom_jobs SET schedule_enabled=0,updated_at=? WHERE id=?",
                (now, int(saved_job_id)),
            )
        conn.commit()
    return {"ok": True, "enabled": bool(body.enabled)}


@app.post("/admin/custom-jobs")
def create_saved_custom_job(body: SavedCustomJobRequest, _auth: None = Depends(require_admin_key)):
    value = _validated_saved_custom_job(body)
    now = time.time()
    next_run = value["scheduled_for_at"] if value["schedule_enabled"] else 0
    try:
        with get_db() as conn:
            # Auto-suffix _1, _2, … on a same-owner name collision instead of
            # rejecting — lets "Save as new" copy an edited job in one click.
            existing = {
                str(r[0]) for r in conn.execute(
                    "SELECT name FROM saved_custom_jobs WHERE owner_name=?",
                    (value["owner_name"],),
                ).fetchall()
            }
            name = value["name"]
            if name in existing:
                i = 1
                while f"{name}_{i}" in existing:
                    i += 1
                name = f"{name}_{i}"
            cur = conn.execute(
                "INSERT INTO saved_custom_jobs "
                "(owner_name,name,website_id,job_type,org_ids_json,tender_ids_json,all_organizations,"
                "all_tenders,download_mode,schedule_enabled,schedule_mode,interval_minutes,scheduled_for_at,"
                "next_run_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    value["owner_name"], name, value["website_id"], value["job_type"],
                    _json_dump(value["org_ids"]), _json_dump(value["tender_ids"]),
                    int(value["all_organizations"]), int(value["all_tenders"]), value["download_mode"],
                    int(value["schedule_enabled"]), value["schedule_mode"], value["interval_minutes"],
                    value["scheduled_for_at"], next_run, "admin", now, now,
                ),
            )
            _ = int(cur.lastrowid)
            _renumber_saved_custom_jobs(conn)
            saved_id = int(conn.execute(
                "SELECT id FROM saved_custom_jobs WHERE owner_name=? AND name=?",
                (value["owner_name"], name),
            ).fetchone()[0])
            conn.commit()
    except Exception as exc:
        if "unique" in str(exc).lower() or "duplicate" in str(exc).lower():
            raise HTTPException(409, "This user already has a saved job with that name")
        raise
    return {"ok": True, "id": saved_id, "name": name}


@app.put("/admin/custom-jobs/{saved_job_id}")
def update_saved_custom_job(saved_job_id: int, body: SavedCustomJobRequest, _auth: None = Depends(require_admin_key)):
    value = _validated_saved_custom_job(body)
    now = time.time()
    next_run = value["scheduled_for_at"] if value["schedule_enabled"] else 0
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE saved_custom_jobs SET name=?,website_id=?,job_type=?,org_ids_json=?,tender_ids_json=?,"
            "all_organizations=?,all_tenders=?,download_mode=?,schedule_enabled=?,interval_minutes=?,"
            "schedule_mode=?,scheduled_for_at=?,next_run_at=?,updated_at=? WHERE id=? AND owner_name=?",
            (
                value["name"], value["website_id"], value["job_type"], _json_dump(value["org_ids"]),
                _json_dump(value["tender_ids"]), int(value["all_organizations"]), int(value["all_tenders"]),
                value["download_mode"], int(value["schedule_enabled"]), value["interval_minutes"],
                value["schedule_mode"], value["scheduled_for_at"], next_run, now,
                int(saved_job_id), value["owner_name"],
            ),
        )
        changed = int(cur.rowcount or 0)
        conn.commit()
    if changed != 1:
        raise HTTPException(404, "Saved custom job not found for this user")
    return {"ok": True, "id": int(saved_job_id)}


@app.post("/admin/custom-jobs/{saved_job_id}/run")
def run_saved_custom_job(saved_job_id: int, owner: str, _auth: None = Depends(require_admin_key)):
    with get_db() as conn:
        row = conn.execute(
            "SELECT id FROM saved_custom_jobs WHERE id=? AND owner_name=?",
            (int(saved_job_id), " ".join(str(owner or "").split())),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Saved custom job not found for this user")
    return _enqueue_saved_custom_job(saved_job_id)


@app.delete("/admin/custom-jobs/{saved_job_id}")
def delete_saved_custom_job(saved_job_id: int, owner: str, _auth: None = Depends(require_admin_key)):
    owner_name = " ".join(str(owner or "").split())
    with get_db() as conn:
        pre = conn.execute(
            "SELECT COALESCE(created_by,'admin') AS created_by, website_id FROM saved_custom_jobs "
            "WHERE id=? AND (owner_name=? OR ?='*')",
            (int(saved_job_id), owner_name, owner_name),
        ).fetchone()
        cur = conn.execute(
            "DELETE FROM saved_custom_jobs WHERE id=? AND (owner_name=? OR ?='*')",
            (int(saved_job_id), owner_name, owner_name),
        )
        changed = int(cur.rowcount or 0)
        if changed == 1:
            created_by = str((pre[0] if pre is not None else "admin") or "admin")
            website_id = int((pre[1] if pre is not None else 0) or 0)
            if created_by == "user" and website_id:
                # An admin removing the auto-managed bookmark job = "stop
                # bookmark scraping for this website"; don't let the next sync
                # push recreate it until they Resume.
                conn.execute(
                    "INSERT OR REPLACE INTO bookmark_scrape_suppressed (website_id, suppressed_at) VALUES (?,?)",
                    (website_id, time.time()),
                )
            _renumber_saved_custom_jobs(conn)
        conn.commit()
    if changed != 1:
        raise HTTPException(404, "Saved custom job not found for this user")
    return {"ok": True}


def _renumber_saved_custom_jobs(conn) -> int:
    """Reassign saved_custom_jobs.id to a sequential 1..N range (in current id
    order) and reset the id sequence, so newly created jobs keep getting low
    ids instead of drifting upward after rows are deleted. Operates on an
    open connection and does NOT commit. No-ops (returns 0) when ids are
    already 1..N. Called automatically on every create/delete."""
    old_ids = [int(row[0]) for row in conn.execute("SELECT id FROM saved_custom_jobs ORDER BY id").fetchall()]
    if old_ids == list(range(1, len(old_ids) + 1)):
        return 0
    # Shift to a temp range first so intermediate ids can never collide with
    # either an old id still awaiting its turn or an already-assigned new id.
    offset = max(old_ids, default=0) + len(old_ids) + 1000
    for old_id in old_ids:
        conn.execute("UPDATE saved_custom_jobs SET id=? WHERE id=?", (old_id + offset, old_id))
    for new_id, old_id in enumerate(old_ids, start=1):
        conn.execute("UPDATE saved_custom_jobs SET id=? WHERE id=?", (new_id, old_id + offset))
    if db_compat.using_postgres():
        conn.execute(
            "SELECT setval(pg_get_serial_sequence('saved_custom_jobs', 'id'), ?, true)",
            (len(old_ids),),
        )
    elif conn.execute(
        "UPDATE sqlite_sequence SET seq=? WHERE name='saved_custom_jobs'", (len(old_ids),)
    ).rowcount == 0:
        conn.execute("INSERT INTO sqlite_sequence (name, seq) VALUES ('saved_custom_jobs', ?)", (len(old_ids),))
    return len(old_ids)


@app.post("/admin/custom-jobs/renumber")
def renumber_saved_custom_jobs(_auth: None = Depends(require_admin_key)):
    with get_db() as conn:
        renumbered = _renumber_saved_custom_jobs(conn)
        conn.commit()
    return {"ok": True, "renumbered": renumbered}


def _admin_provider_payload() -> dict:
    return admin_providers.active_providers()


def _coerce_setting(value: str):
    text = str(value or "")
    lower = text.strip().lower()
    if lower in {"true", "false"}:
        return lower == "true"
    if re.fullmatch(r"-?\d+", text.strip()):
        try:
            return int(text)
        except Exception:
            pass
    return text


def _admin_config_payload() -> dict:
    alias_by_key = {v: k for k, v in ADMIN_CONFIG_ALIASES.items()}
    keys = list(ADMIN_CONFIG_KEYS)
    placeholders = ", ".join("?" for _ in keys)
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT key, value FROM app_settings WHERE key IN ({placeholders})",
            keys,
        ).fetchall()
    stored_settings = {str(row["key"]): row["value"] for row in rows}
    settings = {}
    for key, default in ADMIN_CONFIG_KEYS.items():
        out_key = alias_by_key.get(key, key)
        if key == "captcha_ai_api_key":
            settings[out_key] = ""
        else:
            settings[out_key] = _coerce_setting(stored_settings.get(key, default))
    settings["captcha_ai_api_key_set"] = bool(
        os.getenv("CAPTCHA_AI_API_KEY", "").strip()
        or os.getenv("GOOGLE_API_KEY", "").strip()
        or str(stored_settings.get("captcha_ai_api_key", "") or "").strip()
    )
    # Authentication follows deployment policy and environment secrets, not a
    # mutable database flag. Keep the existing UI field aligned with reality.
    settings["require_admin_key"] = bool(os.getenv("ADMIN_API_KEY", "").strip()) or security.is_cloud_environment()
    return {"provider": "custom-api", "settings": settings, "providers": _admin_provider_payload()}


_JOB_KIND_BY_ACTION = {
    "fetch_organisations": "fetch",
    "fetch_tenders": "fetch",
    "fetch_tenders_selected": "fetch",
    "refresh_selected_tenders": "fetch",
    "refresh_tender_details": "fetch",
    "check_status": "fetch",
    "check_status_archived": "fetch",
    "archive_completed_tenders": "fetch",
    "push_to_cloud": "download",
    "download_tenders": "download",
    "refresh_and_download_tenders": "download",
    "download_tender_results": "download",
    "download_single_tender": "download",
}


def _job_website_label(website_id) -> str:
    if not website_id:
        return ""
    try:
        with get_db() as conn:
            row = conn.execute("SELECT name FROM websites WHERE id=?", (website_id,)).fetchone()
        return str(row[0]) if row else ""
    except Exception:
        return ""


def _job_tender_display(tender_db_id):
    if not tender_db_id:
        return "", ""
    try:
        with get_db() as conn:
            row = conn.execute(
                "SELECT tender_id, website_id FROM tenders WHERE id=?", (tender_db_id,)
            ).fetchone()
        if not row:
            return "", ""
        return str(row[0] or ""), _job_website_label(row[1])
    except Exception:
        return "", ""


def _admin_job_display_maps(jobs: list[dict]) -> tuple[dict[int, str], dict[int, tuple[str, int]]]:
    """Load all portal/tender labels needed by a jobs response in one DB visit."""
    website_ids: set[int] = set()
    tender_ids: set[int] = set()
    for job in jobs:
        try:
            if job.get("website_id") is not None:
                website_ids.add(int(job["website_id"]))
        except (TypeError, ValueError):
            pass
        try:
            if job.get("tender_id") is not None:
                tender_ids.add(int(job["tender_id"]))
        except (TypeError, ValueError):
            pass

    website_labels: dict[int, str] = {}
    tender_labels: dict[int, tuple[str, int]] = {}
    try:
        with get_db() as conn:
            if tender_ids:
                placeholders = ",".join("?" for _ in tender_ids)
                rows = conn.execute(
                    f"SELECT id,tender_id,website_id FROM tenders WHERE id IN ({placeholders})",
                    sorted(tender_ids),
                ).fetchall()
                for row in rows:
                    tender_db_id = int(row[0])
                    website_id = int(row[2]) if row[2] is not None else 0
                    tender_labels[tender_db_id] = (str(row[1] or ""), website_id)
                    if website_id:
                        website_ids.add(website_id)
            if website_ids:
                placeholders = ",".join("?" for _ in website_ids)
                rows = conn.execute(
                    f"SELECT id,name FROM websites WHERE id IN ({placeholders})",
                    sorted(website_ids),
                ).fetchall()
                website_labels = {int(row[0]): str(row[1] or "") for row in rows}
    except Exception:
        # Job status remains useful even if its optional display labels cannot be loaded.
        return {}, {}
    return website_labels, tender_labels


def _admin_job_payload(
    job_id: str,
    job: dict,
    website_labels: Optional[dict[int, str]] = None,
    tender_labels: Optional[dict[int, tuple[str, int]]] = None,
) -> dict:
    raw_status = str(job.get("status") or "unknown")
    status = "done" if raw_status == "completed" else raw_status
    action = job.get("action", "")
    if website_labels is None or tender_labels is None:
        tender_id_display, portal_from_tender = _job_tender_display(job.get("tender_id"))
        portal = portal_from_tender or _job_website_label(job.get("website_id"))
    else:
        try:
            tender_db_id = int(job.get("tender_id"))
        except (TypeError, ValueError):
            tender_db_id = 0
        tender_id_display, tender_website_id = tender_labels.get(tender_db_id, ("", 0))
        try:
            job_website_id = int(job.get("website_id"))
        except (TypeError, ValueError):
            job_website_id = 0
        portal = website_labels.get(tender_website_id, "") or website_labels.get(job_website_id, "")
    started_at = job.get("started_at")
    return {
        "id": job_id,
        "status": status,
        "action": action,
        "kind": _JOB_KIND_BY_ACTION.get(action, ""),
        "tenderId": tender_id_display,
        "portal": portal,
        "startedAt": int(started_at * 1000) if started_at else None,
        "progress": 100 if status == "done" else 0,
        "error": job.get("error", ""),
        "logs": job.get("logs", []),
        "provider": admin_providers.active_compute_provider().metadata()["provider"],
    }


def _pending_admin_captcha() -> Optional[dict]:
    pending = get_pending_captcha()
    if not pending:
        return None
    created = float(pending.get("created_at") or time.time())
    expires = float(pending.get("expires_at") or (created + _CAPTCHA_TTL_SECONDS))
    image_base64 = pending.get("image_base64", "")
    return {
        "id": pending.get("request_id"),
        "request_id": pending.get("request_id"),
        "jobId": pending.get("job_id") or "",
        "tenderId": "",
        "portal": pending.get("context") or "captcha",
        "image": f"data:image/png;base64,{image_base64}" if image_base64 else "",
        "image_base64": image_base64,
        "receivedAt": int(created * 1000),
        "expiresAt": int(expires * 1000),
        "reason": "Manual captcha required",
        "provider": admin_providers.active_compute_provider().metadata()["provider"],
    }


@app.get("/admin/providers")
def admin_providers_endpoint(_auth: None = Depends(require_admin_key)):
    return _admin_provider_payload()


@app.post("/admin/push-to-cloud", response_model=JobStartResponse)
def admin_push_to_cloud(_auth: None = Depends(require_admin_key)):
    return _enqueue_job("push_to_cloud", {})


def _public_client_user(row: Any, activity_count: int = 0) -> dict[str, Any]:
    data = dict(row)
    return {
        "id": int(data["id"]),
        "email": str(data.get("email") or ""),
        "display_name": str(data.get("display_name") or ""),
        "status": str(data.get("status") or "active"),
        "created_at": data.get("created_at"),
        "last_login_at": data.get("last_login_at"),
        "last_seen_at": data.get("last_seen_at"),
        "activity_count": activity_count,
        # Recoverable copy for the admin console; null for users whose password
        # predates the password_enc column or is otherwise not decryptable.
        "password": security.decrypt_password(data.get("password_enc")),
    }


@app.get("/admin/users")
def admin_list_users(_auth: None = Depends(require_admin_key)):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT u.id,u.email,u.display_name,u.status,u.created_at,u.last_login_at,u.last_seen_at,u.password_enc,"
            "(SELECT COUNT(*) FROM client_activity_log a WHERE a.user_id=u.id) AS activity_count "
            "FROM client_users u ORDER BY u.created_at DESC"
        ).fetchall()
    return {"items": [_public_client_user(row, int(dict(row).get("activity_count") or 0)) for row in rows]}


def _client_user_sync_view(conn, user_id: int) -> dict[str, Any]:
    """The user's whole-blob cloud sync (client_user_sync.data_json), resolved
    for the admin Users panel: counts, human-readable bookmark/project/template
    lists, tender column prefs, plus the raw blob for a full-fidelity view."""
    row = conn.execute(
        "SELECT data_json,updated_at FROM client_user_sync WHERE user_id=?", (user_id,)
    ).fetchone()
    try:
        blob = json.loads((dict(row).get("data_json") if row else None) or "{}")
    except (TypeError, ValueError):
        blob = {}
    if not isinstance(blob, dict):
        blob = {}

    bookmark_ids = []
    for value in (blob.get("bookmarks") or [])[:1000]:
        try:
            bookmark_ids.append(int(value))
        except (TypeError, ValueError):
            continue
    bookmarks = []
    if bookmark_ids:
        placeholders = ",".join("?" for _ in bookmark_ids)
        for t in conn.execute(
            "SELECT t.id,COALESCE(t.tender_id,'') AS tender_id,COALESCE(t.title,'') AS title,"
            "COALESCE(t.org_chain,'') AS org_chain,COALESCE(w.name,'') AS website_name "
            f"FROM tenders t LEFT JOIN websites w ON w.id=t.website_id WHERE t.id IN ({placeholders})",
            tuple(bookmark_ids),
        ).fetchall():
            bookmarks.append(dict(t))

    projects = [dict(p) for p in (blob.get("projects") or []) if isinstance(p, dict)]
    templates = [dict(x) for x in (blob.get("templates") or []) if isinstance(x, dict)]
    template_items = [dict(x) for x in (blob.get("templateItems") or []) if isinstance(x, dict)]
    checklist = [dict(x) for x in (blob.get("checklist") or []) if isinstance(x, dict)]
    bookmarked_orgs = [str(x) for x in (blob.get("bookmarkedOrgs") or [])]
    column_prefs = blob.get("tenderColumnPrefs") if isinstance(blob.get("tenderColumnPrefs"), dict) else {}

    return {
        "synced_at": float(dict(row).get("updated_at") or 0) if row else 0,
        "counts": {
            "bookmarks": len(blob.get("bookmarks") or []),
            "bookmarked_orgs": len(bookmarked_orgs),
            "projects": len(projects),
            "templates": len(templates),
            "template_items": len(template_items),
            "checklist": len(checklist),
            "has_column_prefs": bool(column_prefs),
        },
        "bookmarks": bookmarks,
        "bookmarked_orgs": bookmarked_orgs,
        "projects": [
            {
                "id": p.get("id"),
                "title": str(p.get("title") or ""),
                "status": str(p.get("status") or "Active"),
                "client_name": str(p.get("client_name") or ""),
            }
            for p in projects
        ],
        "templates": [
            {
                "id": x.get("id"),
                "organization": str(x.get("organization") or ""),
                "template_name": str(x.get("template_name") or x.get("description") or ""),
                "description": str(x.get("description") or ""),
            }
            for x in templates
        ],
        "checklist": [
            {
                "project_id": x.get("project_id"),
                "req_file_name": str(x.get("req_file_name") or ""),
                "subfolder": str(x.get("subfolder") or ""),
                "status": str(x.get("status") or ""),
            }
            for x in checklist[:500]
        ],
        "tender_column_prefs": column_prefs,
        "raw": blob,
    }


@app.get("/admin/users/{user_id}")
def admin_get_user(user_id: int, _auth: None = Depends(require_admin_key)):
    with get_db() as conn:
        row = conn.execute(
            "SELECT id,email,display_name,status,created_at,last_login_at,last_seen_at,password_enc "
            "FROM client_users WHERE id=?",
            (user_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "User not found.")
        activity_rows = conn.execute(
            "SELECT route,tender_id,created_at FROM client_activity_log "
            "WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
            (user_id,),
        ).fetchall()
        sync_view = _client_user_sync_view(conn, user_id)
    user = _public_client_user(row, len(activity_rows))
    user["recent_activity"] = [dict(item) for item in activity_rows]
    user["sync"] = sync_view
    return user


@app.post("/admin/users/{user_id}/reset-sync")
def admin_reset_user_sync(user_id: int, _auth: None = Depends(require_admin_key)):
    # Clears only the SERVER copy of this user's whole-blob sync
    # (client_user_sync). Their app keeps its local data and re-seeds the
    # server on its next change; a fresh install/login then pulls {}.
    with get_db() as conn:
        row = conn.execute("SELECT id FROM client_users WHERE id=?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(404, "User not found.")
        conn.execute("DELETE FROM client_user_sync WHERE user_id=?", (user_id,))
        conn.commit()
    return {"ok": True}


@app.post("/admin/users/{user_id}/suspend")
def admin_suspend_user(user_id: int, _auth: None = Depends(require_admin_key)):
    with get_db() as conn:
        row = conn.execute("SELECT id FROM client_users WHERE id=?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(404, "User not found.")
        conn.execute("UPDATE client_users SET status='suspended' WHERE id=?", (user_id,))
        # Revoke every active token immediately so suspension takes effect on
        # the client's very next request rather than at its next login.
        conn.execute(
            "UPDATE client_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",
            (time.time(), user_id),
        )
        conn.commit()
    return {"ok": True, "status": "suspended"}


@app.post("/admin/users/{user_id}/reactivate")
def admin_reactivate_user(user_id: int, _auth: None = Depends(require_admin_key)):
    with get_db() as conn:
        row = conn.execute("SELECT id FROM client_users WHERE id=?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(404, "User not found.")
        conn.execute("UPDATE client_users SET status='active' WHERE id=?", (user_id,))
        conn.commit()
    return {"ok": True, "status": "active"}


_PROCESS_START_TIME = time.time()


@app.get("/admin/health")
def admin_health(_auth: None = Depends(require_admin_key)):
    return {
        **admin_providers.active_compute_provider().health(),
        "uptimeSeconds": int(time.time() - _PROCESS_START_TIME),
        "providers": _admin_provider_payload(),
        "cloudPushConfigured": bool(os.getenv("CLOUD_PUSH_DATABASE_URL", "").strip()),
    }


@app.get("/admin/metrics")
def admin_metrics(_auth: None = Depends(require_admin_key)):
    _refresh_jobs_from_db_for_display()
    with _job_lock:
        jobs = list(_jobs.values())
    total = len(jobs)
    failed = len([j for j in jobs if j.get("status") == "failed"])
    running = len([j for j in jobs if j.get("status") == "running"])
    queued = len([j for j in jobs if j.get("status") == "queued"])
    return {
        "provider": admin_providers.active_compute_provider().metadata()["provider"],
        "jobsTotal": total,
        "jobsRunning": running,
        "jobsQueued": queued,
        "jobsFailed": failed,
        "jobsErrorRate": round((failed / total) * 100, 2) if total else 0,
        **_request_metrics_snapshot(),
        **_process_resource_snapshot(),
        "checkedAt": datetime.utcnow().isoformat() + "Z",
    }


@app.get("/admin/config")
def admin_get_config(_auth: None = Depends(require_admin_key)):
    return _admin_config_payload()


@app.put("/admin/config")
def admin_put_config(body: AdminConfigPatch, _auth: None = Depends(require_admin_key)):
    updates = []
    for key, value in dict(body.settings or {}).items():
        stored_key = ADMIN_CONFIG_ALIASES.get(key, key)
        if stored_key in ADMIN_CONFIG_KEYS and stored_key != "require_admin_key":
            # A blank key from the browser means "keep the existing secret".
            # Config responses never contain the stored key.
            if stored_key == "captcha_ai_api_key" and not str(value or "").strip():
                continue
            updates.append((stored_key, str(value)))

    # Reject a CAPTCHA-AI change that carries a bad Gemini key or model before it
    # is persisted, so the operator sees the problem at save time rather than
    # having every download quietly fall back to manual.
    _captcha_keys = {"captcha_ai_provider", "captcha_ai_api_key", "captcha_ai_model"}
    _incoming_captcha = {k: v for k, v in updates if k in _captcha_keys}
    if _incoming_captcha:
        effective = {
            "provider": core.ScraperBackend.get_setting("captcha_ai_provider", ""),
            "api_key": core.ScraperBackend.get_setting("captcha_ai_api_key", ""),
            "model": core.ScraperBackend.get_setting("captcha_ai_model", ""),
        }
        if "captcha_ai_provider" in _incoming_captcha:
            effective["provider"] = _incoming_captcha["captcha_ai_provider"]
        if "captcha_ai_api_key" in _incoming_captcha:
            effective["api_key"] = _incoming_captcha["captcha_ai_api_key"]
        if "captcha_ai_model" in _incoming_captcha:
            effective["model"] = _incoming_captcha["captcha_ai_model"]
        provider = str(effective["provider"] or "").strip().lower()
        if provider in {"gemini", "google", "google-gemini"}:
            effective["provider"] = "gemini"
            try:
                core.ScraperBackend.validate_captcha_ai_config(effective)
            except ValueError as exc:
                raise HTTPException(400, str(exc))

    if updates:
        with get_db() as conn:
            conn.executemany(
                "INSERT INTO app_settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                updates,
            )
            conn.commit()
        core.ScraperBackend.invalidate_settings_cache()
        changed_keys = {k for k, _ in updates}
        if changed_keys & {
            "captcha_ai_provider", "captcha_ai_api_key", "captcha_ai_model",
            "captcha_ai_endpoint", "headless", "browser",
        }:
            # A new captcha key/model or browser change only takes effect on a
            # fresh browser session.
            core.ScraperBackend.close_download_session()
    return _admin_config_payload()


@app.get("/admin/jobs")
def admin_jobs(
    status: str = Query("", max_length=40),
    _auth: None = Depends(require_admin_key),
):
    _refresh_jobs_from_db_for_display()
    _cleanup_expired_jobs()
    with _job_lock:
        jobs = [(job_id, dict(job)) for job_id, job in _jobs.items()]
    website_labels, tender_labels = _admin_job_display_maps([job for _, job in jobs])
    rows = [
        _admin_job_payload(job_id, job, website_labels, tender_labels)
        for job_id, job in jobs
    ]
    wanted = str(status or "").strip().lower()
    if wanted and wanted != "all":
        rows = [row for row in rows if str(row.get("status", "")).lower() == wanted]
    return {"provider": admin_providers.active_compute_provider().metadata()["provider"], "jobs": rows}


@app.post("/admin/jobs/scrape", response_model=JobStartResponse)
def admin_start_scrape(body: AdminScrapeStart, _auth: None = Depends(require_admin_key)):
    with get_db() as conn:
        website = conn.execute(
            "SELECT id FROM websites WHERE id=?",
            (int(body.website_id),),
        ).fetchone()
    if not website:
        raise HTTPException(404, "Website not found")
    if body.refresh_organizations:
        # Portal "Refresh organizations" only rebuilds the org list — it does not
        # chain a tender scrape. Tenders are scraped on demand from the
        # Organizations panel (fetch-selected).
        return _enqueue_job(
            "fetch_organisations",
            {
                "website_id": int(body.website_id),
                "source": "admin",
            },
        )
    return _enqueue_job(
        "fetch_tenders",
        {"website_id": int(body.website_id), "source": "admin"},
    )


@app.post("/admin/jobs/{job_id}/cancel")
def admin_cancel_job(job_id: str, _auth: None = Depends(require_admin_key)):
    with _job_lock:
        job = dict(_jobs.get(job_id) or {})
    if not job:
        raise HTTPException(404, "Job not found")
    if job.get("status") in {"queued", "running"}:
        future = _job_futures.get(job_id)
        if future and job.get("status") == "queued":
            future.cancel()
        job = _update_job(
            job_id,
            status="cancelled",
            cancel_requested=True,
            error="Cancelled by operator.",
            finished_at=time.time(),
            heartbeat_at=time.time(),
        ) or job
        _expire_job_captchas(job_id)
    return {"ok": True, "job": _admin_job_payload(job_id, job)}


@app.post("/admin/jobs/{job_id}/retry")
def admin_retry_job(job_id: str, _auth: None = Depends(require_admin_key)):
    with _job_lock:
        job = dict(_jobs.get(job_id) or {})
    if not job:
        raise HTTPException(404, "Job not found")
    if job.get("status") not in {"failed", "cancelled"}:
        raise HTTPException(409, "Only failed or cancelled jobs can be retried.")
    return _enqueue_job(job.get("action", ""), dict(job.get("payload") or {}))


@app.post("/admin/jobs/purge")
def admin_purge_jobs(_auth: None = Depends(require_admin_key)):
    removed = 0
    with _job_lock:
        for job_id in list(_jobs.keys()):
            if _jobs[job_id].get("status") in {"completed", "failed", "cancelled"}:
                del _jobs[job_id]
                removed += 1
    with get_db() as conn:
        conn.execute(
            "DELETE FROM captcha_requests WHERE job_id IN "
            "(SELECT id FROM background_jobs WHERE status IN ('completed','failed','cancelled'))"
        )
        conn.execute("DELETE FROM background_jobs WHERE status IN ('completed','failed','cancelled')")
        conn.commit()
    return {"ok": True, "removed": removed}


@app.get("/admin/logs/live")
def admin_live_logs(
    limit: int = Query(400, ge=1, le=5000),
    since_seq: int = Query(0, ge=0),
    _auth: None = Depends(require_admin_key),
):
    payload = get_live_logs(limit=limit, since_seq=since_seq)
    return {
        "provider": admin_providers.active_compute_provider().metadata()["provider"],
        **payload,
    }


@app.get("/admin/logs/stream")
def admin_log_stream(_auth: None = Depends(require_admin_key)):
    def events():
        next_seq = 0
        while True:
            payload = get_live_logs(limit=100, since_seq=next_seq)
            next_seq = int(payload.get("next_seq") or next_seq)
            for entry in payload.get("entries") or []:
                yield "data: " + json.dumps({
                    "line": entry["text"], "ts": entry["ts"], "seq": entry["seq"],
                }) + "\n\n"
            time.sleep(2)

    return StreamingResponse(events(), media_type="text/event-stream")


@app.get("/admin/captchas/pending")
def admin_pending_captchas(_auth: None = Depends(require_admin_key)):
    pending = _pending_admin_captcha()
    return {"provider": admin_providers.active_compute_provider().metadata()["provider"], "captchas": [pending] if pending else []}


@app.post("/admin/captchas/{captcha_id}/answer")
def admin_answer_captcha(captcha_id: str, body: AdminCaptchaAnswer, _auth: None = Depends(require_admin_key)):
    return submit_captcha(CaptchaSubmitRequest(request_id=captcha_id, text=body.answer))


@app.post("/admin/captchas/{captcha_id}/skip")
def admin_skip_captcha(captcha_id: str, body: AdminCaptchaSkip, _auth: None = Depends(require_admin_key)):
    action = str(body.action or "requeue").strip().lower()
    answer = "" if action == "abandon" else "__SKIP__"
    return submit_captcha(CaptchaSubmitRequest(request_id=captcha_id, text=answer))


@app.post("/admin/captchas/{captcha_id}/refresh")
def admin_refresh_captcha(captcha_id: str, _auth: None = Depends(require_admin_key)):
    # Known limitation: there's no hook into the paused Selenium session to trigger a
    # real portal-side reload of the captcha image, so this re-serves the same cached
    # image rather than faking a refresh.
    pending = _pending_admin_captcha()
    if not pending or pending.get("id") != captcha_id:
        raise HTTPException(404, "Captcha not found or already resolved")
    return {"id": pending["id"], "image": pending["image"]}


@app.get("/admin/captchas/stats")
def admin_captcha_stats(_auth: None = Depends(require_admin_key)):
    return {
        "provider": admin_providers.active_compute_provider().metadata()["provider"],
        "pending": 1 if _pending_admin_captcha() else 0,
        "manualFallback": _coerce_setting(core.ScraperBackend.get_setting("captcha_manual_fallback", "true")),
    }


@app.get("/admin/db/stats")
def admin_db_stats(_auth: None = Depends(require_admin_key)):
    return admin_providers.active_database_provider().stats()


@app.post("/admin/db/vacuum")
def admin_db_vacuum(_auth: None = Depends(require_admin_key)):
    try:
        return admin_providers.active_database_provider().vacuum()
    except Exception as exc:
        raise HTTPException(500, str(exc))


@app.post("/admin/db/backup")
def admin_db_backup(_auth: None = Depends(require_admin_key)):
    try:
        return admin_providers.active_database_provider().backup()
    except NotImplementedError as exc:
        raise HTTPException(501, str(exc))
    except Exception as exc:
        raise HTTPException(500, str(exc))


def _storage_backend_exc(exc: Exception) -> HTTPException:
    # A Drive/googleapiclient HttpError (or anything else non-ValueError) must
    # not escape as an unhandled 500 wrapped in an ASGI TaskGroup exception —
    # that tears the connection and the browser only sees "Failed to fetch".
    return HTTPException(502, f"Storage backend error: {exc}")


def _forget_deleted_downloads(path: str) -> None:
    # After a folder/file is removed from storage, drop its download-ledger
    # rows and clear the tender's downloaded flags so it no longer shows as
    # downloaded (and _resolve_download_mode stops trusting the stale ledger).
    try:
        prefix = str(
            core.ScraperBackend.get_setting("storage_prefix", "tenders/") or ""
        ).replace("\\", "/").strip("/")
        rel = str(path or "").replace("\\", "/").strip("/")
        if prefix:
            if rel == prefix or not rel.startswith(prefix + "/"):
                return
            rel = rel[len(prefix) + 1:]
        parts = [p for p in rel.split("/") if p]
        if not parts:
            return
        tid = parts[0]
        file_name = parts[-1] if len(parts) > 1 else ""
        canon = core.ScraperBackend.canonical_tender_id(tid)
        with get_db() as conn:
            if file_name:
                conn.execute(
                    "DELETE FROM downloaded_files "
                    "WHERE UPPER(TRIM(COALESCE(tender_id,'')))=? AND file_name=?",
                    (canon, file_name),
                )
                low = file_name.lower()
                is_main = (
                    low.startswith("tendernotice_") and low.endswith(".pdf")
                ) or low.endswith(".zip") or low.endswith(".rar")
                if is_main:
                    conn.execute(
                        "UPDATE tenders SET is_downloaded=0, download_status='partial' "
                        "WHERE UPPER(TRIM(COALESCE(tender_id,'')))=?",
                        (canon,),
                    )
            else:
                conn.execute(
                    "DELETE FROM downloaded_files "
                    "WHERE UPPER(TRIM(COALESCE(tender_id,'')))=?",
                    (canon,),
                )
                conn.execute(
                    "UPDATE tenders SET is_downloaded=0, download_status='deleted', "
                    "last_downloaded_at=NULL, initial_download_completed_at=NULL, "
                    "last_download_error='' WHERE UPPER(TRIM(COALESCE(tender_id,'')))=?",
                    (canon,),
                )
            conn.commit()
    except Exception as exc:  # bookkeeping only — never fail the delete
        core.log_to_gui(f"Could not update download ledger after delete of '{path}': {exc}")


@app.get("/admin/storage")
def admin_storage(prefix: str = Query("", max_length=500), _auth: None = Depends(require_admin_key)):
    try:
        return admin_providers.active_storage_provider().list_items(prefix)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise _storage_backend_exc(exc)


@app.get("/admin/storage/usage")
def admin_storage_usage(_auth: None = Depends(require_admin_key)):
    return admin_providers.active_storage_provider().usage()


@app.post("/admin/storage/folder")
def admin_storage_create_folder(body: AdminStorageFolder, _auth: None = Depends(require_admin_key)):
    try:
        return admin_providers.active_storage_provider().create_folder(body.prefix, body.name)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise _storage_backend_exc(exc)


@app.delete("/admin/storage")
def admin_storage_delete(body: AdminStorageDelete, _auth: None = Depends(require_admin_key)):
    try:
        result = admin_providers.active_storage_provider().delete(body.path)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except Exception as exc:
        raise _storage_backend_exc(exc)
    _forget_deleted_downloads(body.path)
    return result


@app.post("/admin/storage/signed-url")
def admin_storage_signed_url(
    body: AdminStorageSignedUrl,
    request: Request,
    x_admin_key: Optional[str] = Header(default=None),
    _auth: None = Depends(require_admin_key),
):
    try:
        base_url = str(request.base_url).rstrip("/")
        return admin_providers.active_storage_provider().signed_url(
            body.path, base_url=base_url, admin_key=x_admin_key or ""
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    except Exception as exc:
        raise _storage_backend_exc(exc)


@app.get("/admin/storage/download")
def admin_storage_download(
    request: Request,
    path: str = Query(..., max_length=1000),
    token: str = Query("", max_length=2000),
    x_admin_key: Optional[str] = Header(default=None),
):
    provider = admin_providers.active_storage_provider()
    is_drive = provider.metadata()["provider"] == "google-drive"
    try:
        normalized_path = (
            admin_providers.drive_storage.normalize_relative_path(path)
            if is_drive
            else str(path or "").replace("\\", "/").strip("/")
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if not security.verify_download_token(token, normalized_path):
        require_admin_key(request, x_admin_key)

    if is_drive:
        try:
            file_id = provider._drive_id_for_path(normalized_path)
            if not file_id:
                raise ValueError("File not found.")
            metadata, response = admin_providers.drive_storage.open_download(file_id)
        except ValueError as exc:
            raise HTTPException(404, str(exc))
        except Exception as exc:
            raise HTTPException(502, f"Google Drive download failed: {exc}")
        name = str(metadata.get("name") or "download")
        headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"}
        if metadata.get("size") is not None:
            headers["Content-Length"] = str(metadata["size"])
        return StreamingResponse(
            admin_providers.drive_storage.iter_download_response(response),
            media_type=str(metadata.get("mimeType") or "application/octet-stream"),
            headers=headers,
        )

    try:
        target = provider._resolve_local_target(path)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if not target.exists() or not target.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(str(target), filename=target.name)


@app.post("/admin/server/{action}")
def admin_server_action(action: str, _auth: None = Depends(require_admin_key)):
    normalized = str(action or "").strip().lower()
    compute = admin_providers.active_compute_provider().metadata()
    if normalized == "drain":
        core.ScraperBackend.set_setting("drain_mode", "true")
        with get_db() as conn:
            active = int(
                conn.execute(
                    "SELECT COUNT(*) FROM background_jobs WHERE status IN ('queued','running')"
                ).fetchone()[0]
            )
        if active == 0:
            core.ScraperBackend.set_setting("drain_mode", "false")
        return {
            "ok": True,
            "action": normalized,
            "draining": active > 0,
            "activeJobs": active,
            "provider": compute["provider"],
        }
    if normalized == "pause-scheduler":
        current = _coerce_setting(core.ScraperBackend.get_setting("scheduler_paused", "false"))
        core.ScraperBackend.set_setting("scheduler_paused", "false" if current else "true")
        return {"ok": True, "action": normalized, "paused": not bool(current), "provider": compute["provider"]}
    raise HTTPException(501, f"{action} is not supported for provider {compute['provider']} yet.")


# -- Health Check --

@app.get("/health")
def health():
    durable_storage = not storage_runtime.is_cloud_runtime() or bool(
        admin_providers.drive_storage and admin_providers.drive_storage.using_drive_storage()
    ) or storage_runtime.using_persistent_local_storage()
    payload = {
        "status": "ok" if durable_storage else "degraded",
        "version": core.APP_VERSION,
        "environment": security.deployment_environment(),
        "processRole": _process_role(),
        "jobExecutionEnabled": _job_execution_enabled(),
        "durableStorage": durable_storage,
    }
    # Electron uses the token to ensure it connected to the child process it
    # launched. Database paths and instance tokens have no place in public cloud
    # health responses.
    if not security.is_cloud_environment():
        payload["db"] = core.DB_FILE
        payload["instance_token"] = os.getenv("BIDMANAGER_INSTANCE_TOKEN", "")
        payload["scraperReady"] = bool(core.SCRAPER_AVAILABLE)
        if not core.SCRAPER_AVAILABLE:
            payload["scraperError"] = core.SCRAPER_IMPORT_ERROR
    return payload



if _job_execution_enabled():
    # Import the scraper stack (selenium/PIL/bs4/…) once at boot so the first
    # scraped tender doesn't pay the lazy-import cost mid-job.
    try:
        core.ensure_scraper_dependencies()
    except Exception:
        pass
    _load_and_recover_jobs(recover_running=True, submit_queued=True)
    _start_queue_poller()
    _start_scheduler()
else:
    _load_and_recover_jobs(recover_running=False, submit_queued=False)
_mount_frontend_if_available()

if __name__ == "__main__":
    import uvicorn
    # Defaults to 8090 (not 8000) so this standalone admin-console backend can run
    # side by side with the real backend/ service without a port clash.
    port = int(os.getenv("PORT") or os.getenv("BIDMANAGER_PORT", "8090"))
    reload_enabled = os.getenv("BIDMANAGER_RELOAD", "").strip().lower() in {"1", "true", "yes"}
    if reload_enabled:
        uvicorn.run("api_server:app", host="0.0.0.0", port=port, reload=True)
    else:
        uvicorn.run(app, host="0.0.0.0", port=port, reload=False)
