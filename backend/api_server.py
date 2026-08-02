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
from datetime import datetime
from typing import Optional, List
from contextlib import contextmanager

from fastapi import FastAPI, HTTPException, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from starlette.routing import Route
from pydantic import BaseModel

# Import your existing backend logic
# Make sure app_core.py is in the same directory or on PYTHONPATH
import app_core as core

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


def _candidate_frontend_dirs() -> list[str]:
    base = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(base)
    candidates = [
        os.path.join(project_root, "frontend", "dist"),
        os.path.join(base, "frontend", "dist"),
        os.path.join(os.getcwd(), "frontend", "dist"),
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

class TenderPatch(BaseModel):
    is_downloaded: Optional[bool] = None
    is_bookmarked: Optional[bool] = None


class SingleTenderDownloadRequest(BaseModel):
    mode: str = "full"

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


class LiveLogsResponse(BaseModel):
    lines: List[str]
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
        sql = "SELECT id, website_id, name, tender_count, is_selected FROM organizations WHERE website_id=?"
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
            "tender_url, COALESCE(folder_path,'') as folder_path "
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
    if not updates:
        raise HTTPException(400, "Nothing to update")
    params.append(tender_db_id)
    with get_db() as conn:
        conn.execute(f"UPDATE tenders SET {', '.join(updates)} WHERE id=?", params)
        conn.commit()
    return {"ok": True}


@app.post("/v1/tenders/{tender_db_id}/archive")
def archive_tender(tender_db_id: int):
    core.ScraperBackend.archive_tender_logic(tender_db_id)
    return {"ok": True}


@app.api_route("/v1/tenders/{tender_db_id}/download", methods=["POST", "GET"], response_model=JobStartResponse)
def download_single_tender(
    tender_db_id: int,
    body: Optional[SingleTenderDownloadRequest] = None,
    mode: str = "full",
):
    mode_raw = str(body.mode or "").strip() if body is not None else str(mode or "").strip()
    mode = str(mode_raw or "full").strip().lower()
    if mode not in {"full", "update"}:
        raise HTTPException(400, "mode must be either 'full' or 'update'")
    job_id = _new_job_id()
    _jobs[job_id] = {"status": "queued", "action": "download_single_tender", "tender_id": tender_db_id, "mode": mode}
    t = threading.Thread(
        target=_run_job,
        args=(job_id, core.ScraperBackend.download_single_tender_logic, tender_db_id, mode),
        daemon=True,
    )
    t.start()
    return {"job_id": job_id, "status": "queued"}


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
        folders = core.ensure_project_standard_folders(synced_project_root)
        tender_docs = str(folders.get("tender_docs", "") or "").strip()

        active_tender = _find_active_tender(conn, source_tender_id)
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
        folders = core.ensure_project_standard_folders(synced_project_root)
        tender_docs = str(folders.get("tender_docs", "") or "").strip()

        active_tender = _find_active_tender(conn, source_tender_id)
        if not active_tender:
            conn.commit()
            return {"found": False, "source": "active_not_found", "tender": None, "files": []}

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

_jobs = {}
_job_counter = 0
_job_lock = threading.Lock()
_core_log_patch_lock = threading.Lock()
_captcha_lock = threading.Lock()
_pending_captcha: Optional[dict] = None
_CAPTCHA_TTL_SECONDS = 300
_live_log_lock = threading.Lock()
_live_log_seq = 0
_live_log_buffer: list[tuple[int, str]] = []
_LIVE_LOG_MAX = 20000


def _append_live_log(message: str) -> int:
    global _live_log_seq
    txt = str(message or "").strip()
    if not txt:
        with _live_log_lock:
            return int(_live_log_seq)
    with _live_log_lock:
        _live_log_seq += 1
        _live_log_buffer.append((int(_live_log_seq), txt))
        if len(_live_log_buffer) > _LIVE_LOG_MAX:
            del _live_log_buffer[: len(_live_log_buffer) - _LIVE_LOG_MAX]
        return int(_live_log_seq)


def _install_live_log_bridge_once():
    original = getattr(core, "log_to_gui", None)
    if not callable(original):
        return
    if getattr(original, "_bidmanager_live_bridge", False):
        return

    def _bridge_log_to_gui(message):
        _append_live_log(str(message or ""))
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
    global _pending_captcha
    with _captcha_lock:
        _pending_captcha = None
    try:
        _drain_queue_nowait(core.captcha_req_queue)
    except Exception:
        pass


def _new_job_id():
    global _job_counter
    with _job_lock:
        _job_counter += 1
        return f"job_{_job_counter}"


def _run_job(job_id, func, *args, **kwargs):
    logs: list[str] = []
    action = _jobs[job_id].get("action")
    original_log_to_gui = getattr(core, "log_to_gui", None)

    def _capture_log(message):
        msg = str(message)
        logs.append(msg)
        if callable(original_log_to_gui):
            original_log_to_gui(msg)

    try:
        _clear_captcha_state()
        _jobs[job_id]["status"] = "running"
        _jobs[job_id]["logs"] = logs
        with _core_log_patch_lock:
            if callable(original_log_to_gui):
                core.log_to_gui = _capture_log
            result = func(*args, **kwargs)
            if callable(original_log_to_gui):
                core.log_to_gui = original_log_to_gui

        org_fetch_failed = action == "fetch_organisations" and result is not True
        explicit_failed = result is False

        if explicit_failed or org_fetch_failed:
            _jobs[job_id]["status"] = "failed"
            _jobs[job_id]["error"] = logs[-1] if logs else "Operation failed."
        else:
            _jobs[job_id]["status"] = "completed"
            _jobs[job_id]["result"] = result
    except Exception as e:
        if callable(original_log_to_gui):
            core.log_to_gui = original_log_to_gui
        _jobs[job_id]["status"] = "failed"
        _jobs[job_id]["error"] = str(e)
    finally:
        _jobs[job_id]["logs"] = logs


@app.post("/v1/websites/{website_id}/organizations/fetch", response_model=JobStartResponse)
def fetch_organizations(website_id: int):
    job_id = _new_job_id()
    _jobs[job_id] = {"status": "queued", "action": "fetch_organisations"}
    t = threading.Thread(
        target=_run_job,
        args=(job_id, core.ScraperBackend.fetch_organisations_logic, website_id),
        daemon=True,
    )
    t.start()
    return {"job_id": job_id, "status": "queued"}


@app.post("/v1/websites/{website_id}/tenders/fetch", response_model=JobStartResponse)
def fetch_tenders(website_id: int):
    job_id = _new_job_id()
    _jobs[job_id] = {"status": "queued", "action": "fetch_tenders"}
    t = threading.Thread(
        target=_run_job,
        args=(job_id, core.ScraperBackend.fetch_tenders_logic, website_id),
        daemon=True,
    )
    t.start()
    return {"job_id": job_id, "status": "queued"}


@app.post("/v1/websites/{website_id}/tenders/fetch-selected", response_model=JobStartResponse)
def fetch_selected_tenders(website_id: int, body: FetchSelectedTendersRequest):
    org_ids = sorted({int(x) for x in body.org_ids if int(x) > 0})
    if not org_ids:
        raise HTTPException(400, "org_ids is required")
    job_id = _new_job_id()
    _jobs[job_id] = {"status": "queued", "action": "fetch_tenders_selected"}
    t = threading.Thread(
        target=_run_job,
        args=(job_id, core.ScraperBackend.fetch_tenders_logic, website_id),
        kwargs={"org_ids": org_ids},
        daemon=True,
    )
    t.start()
    return {"job_id": job_id, "status": "queued"}


@app.api_route("/v1/websites/{website_id}/tenders/download", methods=["POST", "GET"], response_model=JobStartResponse)
def download_tenders(website_id: int):
    job_id = _new_job_id()
    _jobs[job_id] = {"status": "queued", "action": "download_tenders"}
    t = threading.Thread(
        target=_run_job,
        args=(job_id, core.ScraperBackend.download_tenders_logic, website_id),
        daemon=True,
    )
    t.start()
    return {"job_id": job_id, "status": "queued"}


@app.post("/v1/websites/{website_id}/tenders/download-results", response_model=JobStartResponse)
def download_tender_results(website_id: int):
    job_id = _new_job_id()
    _jobs[job_id] = {"status": "queued", "action": "download_tender_results"}
    t = threading.Thread(
        target=_run_job,
        args=(job_id, core.ScraperBackend.download_tender_results_logic, website_id),
        daemon=True,
    )
    t.start()
    return {"job_id": job_id, "status": "queued"}


@app.post("/v1/websites/{website_id}/tenders/check-status", response_model=JobStartResponse)
def check_status(website_id: int):
    job_id = _new_job_id()
    _jobs[job_id] = {"status": "queued", "action": "check_status"}
    t = threading.Thread(
        target=_run_job,
        args=(job_id, core.ScraperBackend.check_tender_status_logic, website_id),
        daemon=True,
    )
    t.start()
    return {"job_id": job_id, "status": "queued"}


@app.post("/v1/websites/{website_id}/tenders/check-status-archived", response_model=JobStartResponse)
def check_status_archived(website_id: int):
    job_id = _new_job_id()
    _jobs[job_id] = {"status": "queued", "action": "check_status_archived"}
    t = threading.Thread(
        target=_run_job,
        args=(job_id, core.ScraperBackend.check_tender_status_logic, website_id),
        kwargs={"archived_only": True},
        daemon=True,
    )
    t.start()
    return {"job_id": job_id, "status": "queued"}


@app.post("/v1/websites/{website_id}/tenders/archive-completed", response_model=JobStartResponse)
def archive_completed_tenders(website_id: int):
    job_id = _new_job_id()
    _jobs[job_id] = {"status": "queued", "action": "archive_completed_tenders"}
    t = threading.Thread(
        target=_run_job,
        args=(job_id, core.ScraperBackend.archive_completed_tenders_logic, website_id),
        daemon=True,
    )
    t.start()
    return {"job_id": job_id, "status": "queued"}


@app.get("/v1/jobs/{job_id}")
def get_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@app.get("/v1/logs/live", response_model=LiveLogsResponse)
def get_live_logs(
    limit: int = Query(400, ge=1, le=5000),
    since_seq: int = Query(0, ge=0),
):
    with _live_log_lock:
        if since_seq > 0:
            selected = [(seq, line) for seq, line in _live_log_buffer if seq > int(since_seq)]
        else:
            selected = list(_live_log_buffer[-int(limit):])
        if len(selected) > int(limit):
            selected = selected[-int(limit):]
        next_seq = int(selected[-1][0]) if selected else int(_live_log_seq)
        lines = [line for _, line in selected]
    return {"lines": lines, "next_seq": next_seq}


@app.get("/v1/captcha/pending", response_model=Optional[CaptchaPendingResponse])
def get_pending_captcha():
    global _pending_captcha
    with _captcha_lock:
        if _pending_captcha is not None:
            ts = float(_pending_captcha.get("created_at") or 0.0)
            if ts and (time.time() - ts) > _CAPTCHA_TTL_SECONDS:
                _pending_captcha = None
            else:
                return _pending_captcha
        try:
            image_data = core.captcha_req_queue.get_nowait()
        except Exception:
            return None
        req = {
            "request_id": str(uuid.uuid4()),
            "image_base64": base64.b64encode(image_data).decode("ascii"),
            "context": "captcha",
            "created_at": time.time(),
        }
        _pending_captcha = req
        return req


@app.post("/v1/captcha/respond")
def submit_captcha(body: CaptchaSubmitRequest):
    global _pending_captcha
    text = str(body.text or "").strip()
    with _captcha_lock:
        current = _pending_captcha
        if not current or current.get("request_id") != str(body.request_id):
            raise HTTPException(404, "Captcha request not found or expired.")
        _pending_captcha = None
    core.captcha_res_queue.put(text)
    return {"ok": True}


# -- Projects --

def _path_eq(a: str, b: str) -> bool:
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
    if txt == "archived":
        return core._resolve_path("Archived Projects")
    return core._resolve_path(core.ROOT_FOLDER)


def _project_folder_preferred(title: str, source_tender_id: str, status: str = "Active") -> str:
    return core._resolve_path(os.path.join(_projects_root_for_status(status), _project_folder_leaf(title, source_tender_id)))


def _migrate_archived_projects_to_archive_root(conn: sqlite3.Connection) -> int:
    archived_root = _projects_root_for_status("Archived")
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
    ensured = core.ensure_project_standard_folders(project_root)
    return str(ensured.get("tender_docs", "") or "").strip()


def _copy_downloaded_tender_docs_to_project(conn: sqlite3.Connection, source_tender_id: str, project_root: str) -> int:
    tid_raw = str(source_tender_id or "").strip()
    tid = tid_raw.lower()
    root = str(project_root or "").strip()
    if not tid or not root:
        return 0
    tender_docs = _project_tender_docs_path(root)
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

        if current and not _path_eq(current, archived_dest) and os.path.isdir(current):
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
    return out


@app.patch("/v1/settings")
def update_settings(body: dict):
    with get_db() as conn:
        for key, value in body.items():
            conn.execute(
                "INSERT INTO app_settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (str(key), str(value)),
            )
        conn.commit()
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
    target, _rel_out = _resolve_storage_rel_path(body.rel_path)
    if not os.path.isdir(target):
        raise HTTPException(404, "Folder not found.")
    days = max(1, int(body.days or 30))
    cutoff = datetime.now().timestamp() - (days * 24 * 60 * 60)

    deleted_files = 0
    deleted_dirs = 0

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


# -- Health Check --

@app.get("/health")
def health():
    return {
        "status": "ok",
        "version": core.APP_VERSION,
        "db": core.DB_FILE,
        "instance_token": os.getenv("BIDMANAGER_INSTANCE_TOKEN", ""),
    }



_mount_frontend_if_available()

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT") or os.getenv("BIDMANAGER_PORT", "8000"))
    reload_enabled = os.getenv("BIDMANAGER_RELOAD", "").strip().lower() in {"1", "true", "yes"}
    if reload_enabled:
        uvicorn.run("api_server:app", host="0.0.0.0", port=port, reload=True)
    else:
        uvicorn.run(app, host="0.0.0.0", port=port, reload=False)
