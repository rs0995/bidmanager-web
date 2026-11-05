"""Read-only, client-safe tender API.

The router in this module intentionally has no scraper, scheduler, configuration,
or write operations.  Its only POST endpoint creates a short-lived signed URL for
an existing downloaded file; it does not persist a request or start a download.
"""

from __future__ import annotations

import os
import hashlib
import shutil
import json
import re
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Literal, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

import admin_providers
import app_core as core
import org_access
import project_files
import security
import storage_runtime


router = APIRouter(prefix="/client", tags=["client"])
download_router = APIRouter(prefix="/client", tags=["client"])

MAX_PAGE_SIZE = 100
DEFAULT_PAGE_SIZE = 25
TENDER_SORT_COLUMNS = {
    "id": "t.id",
    "tender_id": "t.tender_id",
    "title": "t.title",
    "organization": "t.org_chain",
    "tender_value": "t.tender_value",
    "closing_date": "t.closing_date",
    "opening_date": "t.opening_date",
    "published_date": "t.published_date",
    "location": "t.location",
    "category": "t.tender_category",
    "status": "t.status",
}
DOCUMENT_SORT_COLUMNS = {
    "id": "d.id",
    "name": "d.file_name",
    "type": "d.file_type",
    "size": "d.file_size_bytes",
    "downloaded_at": "d.downloaded_at",
}


@contextmanager
def _get_db():
    # app_core patches sqlite3.connect with the Postgres compatibility layer when
    # DATABASE_URL is configured, so this works for both production and local dev.
    conn = core.sqlite3.connect(core.DB_FILE)
    conn.row_factory = core.sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _normalize_email(email: str) -> str:
    value = str(email or "").strip().lower()
    if not _EMAIL_RE.match(value):
        raise HTTPException(400, "Enter a valid email address.")
    return value


def _extract_tender_id(request: Request) -> Optional[int]:
    raw = request.path_params.get("tender_db_id")
    try:
        return int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


def require_client_user(request: Request, x_client_key: Optional[str] = Header(default=None)) -> int:
    token = str(x_client_key or "").strip()
    if not token:
        raise HTTPException(401, "Missing client token. Sign in again.")
    token_hash = security.hash_client_token(token)
    now = time.time()
    with _get_db() as conn:
        row = conn.execute(
            "SELECT u.id AS id, u.status AS status FROM client_tokens t "
            "JOIN client_users u ON u.id=t.user_id "
            "WHERE t.token_hash=? AND t.revoked_at IS NULL",
            (token_hash,),
        ).fetchone()
        if not row:
            raise HTTPException(401, "Invalid or expired client token. Sign in again.")
        data = dict(row)
        if str(data.get("status") or "") != "active":
            raise HTTPException(
                403, detail={"reason": "suspended", "message": "This account has been suspended."}
            )
        user_id = int(data["id"])
        conn.execute("UPDATE client_users SET last_seen_at=? WHERE id=?", (now, user_id))
        conn.execute(
            "INSERT INTO client_activity_log (user_id, route, tender_id, created_at) VALUES (?,?,?,?)",
            (user_id, request.url.path, _extract_tender_id(request), now),
        )
        conn.commit()
    return user_id


def _issue_token(conn: Any, user_id: int) -> str:
    token = security.new_client_token()
    conn.execute(
        "INSERT INTO client_tokens (user_id, token_hash, created_at) VALUES (?,?,?)",
        (user_id, security.hash_client_token(token), time.time()),
    )
    return token


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=200)
    display_name: str = Field("", max_length=200)
    # Optional: an "organisation" signup also creates the org, with this user
    # as its admin. Older apps send neither field and get an individual account.
    account_type: Literal["individual", "organisation"] = "individual"
    org_name: str = Field("", max_length=org_access.MAX_ORG_NAME)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


class AuthResponse(BaseModel):
    user_id: int
    email: str
    display_name: str
    token: str
    # Account type, org and section permissions (as GET /client/me).
    account: Optional[dict[str, Any]] = None


def _org_error(exc: org_access.OrgError) -> HTTPException:
    return HTTPException(exc.status, exc.message)


@router.post("/auth/register", response_model=AuthResponse)
def client_register(body: RegisterRequest) -> dict[str, Any]:
    email = _normalize_email(body.email)
    display_name = body.display_name.strip()
    if body.account_type == "organisation" and not body.org_name.strip():
        raise HTTPException(400, "Enter an organisation name.")
    now = time.time()
    with _get_db() as conn:
        existing = conn.execute("SELECT id FROM client_users WHERE LOWER(email)=?", (email,)).fetchone()
        if existing:
            raise HTTPException(409, "An account with this email already exists.")
        password_hash = security.hash_password(body.password)
        cur = conn.execute(
            "INSERT INTO client_users "
            "(email, password_hash, password_enc, display_name, status, created_at, last_login_at, last_seen_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (email, password_hash, security.encrypt_password(body.password),
             display_name, "active", now, now, now),
        )
        user_id = int(cur.lastrowid)
        token = _issue_token(conn, user_id)
        if body.account_type == "organisation":
            try:
                org_access.create_org(conn, user_id, body.org_name, now)
            except org_access.OrgError as exc:
                raise _org_error(exc)
        account = org_access.public_account(conn, org_access.get_account(conn, user_id))
        conn.commit()
    return {"user_id": user_id, "email": email, "display_name": display_name, "token": token,
            "account": account}


@router.post("/auth/login", response_model=AuthResponse)
def client_login(body: LoginRequest) -> dict[str, Any]:
    email = _normalize_email(body.email)
    now = time.time()
    with _get_db() as conn:
        row = conn.execute(
            "SELECT id,password_hash,display_name,status FROM client_users WHERE LOWER(email)=?",
            (email,),
        ).fetchone()
        data = dict(row) if row else {}
        if not row or not security.verify_password(body.password, str(data.get("password_hash") or "")):
            raise HTTPException(401, "Incorrect email or password.")
        if str(data.get("status") or "") != "active":
            raise HTTPException(
                403, detail={"reason": "suspended", "message": "This account has been suspended."}
            )
        user_id = int(data["id"])
        token = _issue_token(conn, user_id)
        conn.execute(
            "UPDATE client_users SET last_login_at=?, last_seen_at=? WHERE id=?", (now, now, user_id)
        )
        account = org_access.public_account(conn, org_access.get_account(conn, user_id))
        conn.commit()
    return {
        "user_id": user_id,
        "email": email,
        "display_name": str(data.get("display_name") or ""),
        "token": token,
        "account": account,
    }


@router.post("/auth/logout")
def client_logout(x_client_key: Optional[str] = Header(default=None)) -> dict[str, Any]:
    token = str(x_client_key or "").strip()
    if token:
        with _get_db() as conn:
            conn.execute(
                "UPDATE client_tokens SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL",
                (time.time(), security.hash_client_token(token)),
            )
            conn.commit()
    return {"ok": True}


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=8, max_length=200)


@router.post("/auth/change-password")
def client_change_password(
    body: ChangePasswordRequest, user_id: int = Depends(require_client_user)
) -> dict[str, Any]:
    with _get_db() as conn:
        row = conn.execute(
            "SELECT password_hash FROM client_users WHERE id=?", (user_id,)
        ).fetchone()
        data = dict(row) if row else {}
        if not row or not security.verify_password(body.current_password, str(data.get("password_hash") or "")):
            raise HTTPException(401, "Current password is incorrect.")
        new_hash = security.hash_password(body.new_password)
        conn.execute(
            "UPDATE client_users SET password_hash=?, password_enc=? WHERE id=?",
            (new_hash, security.encrypt_password(body.new_password), user_id),
        )
        conn.commit()
    return {"ok": True}


MAX_SYNC_PAYLOAD_BYTES = 2 * 1024 * 1024


class SyncPushRequest(BaseModel):
    data: dict[str, Any]
    # Optional per-collection removal deltas: ids/names the pushing client had
    # in the last blob the server gave it but has since deleted locally. Lets
    # the additive merge below honour a real removal without a client being
    # able to wipe a collection just by holding a stale/partial copy.
    removed: dict[str, Any] | None = None
    # The blob `updated_at` this client last pulled. Enables per-item
    # "any online edit beats an offline edit": an incoming change to an item
    # the server changed AFTER this timestamp is skipped. `None` = a legacy
    # client with no concurrency control (plain additive merge). `0` = "I have
    # no trustworthy baseline" -> the server's copy wins outright.
    base_updated_at: float | None = None


def _coerce_id_set(values: Any) -> set[int]:
    result = set()
    for value in values or []:
        try:
            result.add(int(value))
        except (TypeError, ValueError):
            continue
    return result


# A row's tender id as stored by the scraper (normalized_tender_id), falling
# back to the raw id for a row written without it.
_TENDER_KEY_SQL = "COALESCE(NULLIF(normalized_tender_id,''), UPPER(TRIM(tender_id)))"
_T_TENDER_KEY_SQL = "COALESCE(NULLIF(t.normalized_tender_id,''), UPPER(TRIM(t.tender_id)))"


def _canon_tender_id(value: Any) -> str:
    # Same normaliser as ScraperBackend.canonical_tender_id.
    return " ".join(str(value or "").split()).upper()


def _coerce_tender_id_set(values: Any) -> set[str]:
    return {key for key in (_canon_tender_id(v) for v in (values or [])) if key}


def _values(row: Any) -> tuple:
    # Positional values whether the connection returns tuples, Rows or dicts.
    return tuple(row.values()) if isinstance(row, dict) else tuple(row)


def _tender_ids_for_rows(conn, row_ids) -> dict[int, str]:
    """Row id -> canonical tender id, for the rows that exist."""
    ids = sorted({int(i) for i in row_ids})
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = [_values(r) for r in conn.execute(
        f"SELECT id, tender_id FROM tenders WHERE id IN ({placeholders})", tuple(ids)
    ).fetchall()]
    return {int(r[0]): _canon_tender_id(r[1]) for r in rows if _canon_tender_id(r[1])}


def _rows_for_tender_ids(conn, tender_ids) -> dict[str, int]:
    """Canonical tender id -> current row id, for the tenders that exist."""
    keys = sorted(_coerce_tender_id_set(tender_ids))
    if not keys:
        return {}
    placeholders = ",".join("?" for _ in keys)
    rows = [_values(r) for r in conn.execute(
        f"SELECT id, {_TENDER_KEY_SQL} FROM tenders WHERE {_TENDER_KEY_SQL} IN ({placeholders})",
        tuple(keys),
    ).fetchall()]
    return {str(r[1]): int(r[0]) for r in rows}


def _blob_bookmark_tender_ids(conn, blob: dict) -> set[str]:
    """A user's bookmarked tenders as tender ids. The tender id is the stored
    identity (bookmarkTenderIds); a blob from before it existed only has row
    ids, which are converted while their rows still exist."""
    if isinstance(blob.get("bookmarkTenderIds"), list):
        return _coerce_tender_id_set(blob.get("bookmarkTenderIds"))
    return set(_tender_ids_for_rows(conn, _coerce_id_set(blob.get("bookmarks"))).values())


def _is_blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip()) or value in ([], {})


def _dedupe_projects(blob: dict) -> dict:
    """A project added twice for the same tender (double tap, two devices,
    offline re-send) is kept once. Projects are matched by their source
    tender; ones without a tender are never merged.

    The earliest project id survives. Field values come from the copy changed
    most recently (the blob's own `_v` stamps), with blanks filled in from the
    other copies. Checklist rows of dropped copies are moved to the kept one."""
    projects = blob.get("projects")
    if not isinstance(projects, list):
        return blob
    stamps = (blob.get("_v") or {}).get("projects") or {}

    def _stamp(row: dict) -> float:
        try:
            return float(stamps.get(str(_row_id(row))) or 0)
        except (TypeError, ValueError):
            return 0.0

    groups: dict[str, list[dict]] = {}
    for row in projects:
        key = _canon_tender_id(row.get("source_tender_id")) if isinstance(row, dict) else ""
        if key:
            groups.setdefault(key, []).append(row)
    if all(len(rows) < 2 for rows in groups.values()):
        return blob

    kept_for: dict[str, dict] = {}
    remap: dict[Any, Any] = {}
    for key, rows in groups.items():
        if len(rows) < 2:
            continue
        # Python's sort is stable: equal stamps keep list order (later = newer).
        newest_first = sorted(rows, key=_stamp, reverse=True)
        merged = dict(newest_first[0])
        for other in newest_first[1:]:
            for field, value in other.items():
                if _is_blank(merged.get(field)) and not _is_blank(value):
                    merged[field] = value
        ids = [_row_id(r) for r in rows]
        keep_id = min(ids, key=lambda i: (not isinstance(i, int), i if isinstance(i, int) else 0, str(i)))
        merged["id"] = keep_id
        kept_for[key] = merged
        for rid in ids:
            if rid != keep_id:
                remap[rid] = keep_id

    out_projects: list = []
    emitted: set[str] = set()
    for row in projects:
        key = _canon_tender_id(row.get("source_tender_id")) if isinstance(row, dict) else ""
        if key in kept_for:
            if key not in emitted:
                out_projects.append(kept_for[key])
                emitted.add(key)
            continue
        out_projects.append(row)

    out = dict(blob)
    out["projects"] = out_projects
    checklist = blob.get("checklist")
    if remap and isinstance(checklist, list):
        merged_into = set(remap.values())
        moved: list = []
        seen: set[tuple] = set()
        for row in checklist:
            if isinstance(row, dict):
                field = "project_id" if "project_id" in row else "projectId" if "projectId" in row else None
                if field:
                    pid = row.get(field)
                    try:
                        pid = int(pid)
                    except (TypeError, ValueError):
                        pass
                    if pid in remap:
                        pid = remap[pid]
                        row = {**row, field: pid}
                    if pid in merged_into:
                        # Both copies may have listed the same required file: keep it once.
                        sig = (pid, str(row.get("req_file_name") or row.get("reqFileName") or ""),
                               str(row.get("subfolder") or ""))
                        if sig[1] and sig in seen:
                            continue
                        seen.add(sig)
            moved.append(row)
        out["checklist"] = moved
    return out


def _with_current_row_ids(conn, blob: dict) -> dict:
    """Fill the row-id handles in a blob from its tender ids against the
    current database, so they stay right after the tenders table is rebuilt
    (and older app builds that still read `bookmarks` keep working).
    Also collapses projects added twice for the same tender."""
    out = _dedupe_projects(dict(blob or {}))
    tender_ids = _blob_bookmark_tender_ids(conn, out)
    if tender_ids or "bookmarks" in out or "bookmarkTenderIds" in out:
        rows = _rows_for_tender_ids(conn, tender_ids)
        out["bookmarkTenderIds"] = sorted(tender_ids)
        out["bookmarks"] = sorted(rows.values())
    projects = out.get("projects")
    if isinstance(projects, list):
        linked = _rows_for_tender_ids(
            conn, [p.get("source_tender_id") for p in projects if isinstance(p, dict)]
        )
        refreshed = []
        for project in projects:
            if isinstance(project, dict) and _canon_tender_id(project.get("source_tender_id")):
                project = {
                    **project,
                    "source_tender_db_id": linked.get(_canon_tender_id(project.get("source_tender_id"))),
                }
            refreshed.append(project)
        out["projects"] = refreshed
    return out


# A bookmark keeps its target fresh with a recurring 24-hour scrape.
BOOKMARK_SCRAPE_INTERVAL_MINUTES = 1440


def _json_id_list(raw: Any) -> list[int]:
    try:
        values = json.loads(raw) if raw not in (None, "") else []
    except (TypeError, ValueError):
        return []
    out: list[int] = []
    for value in values or []:
        try:
            out.append(int(value))
        except (TypeError, ValueError):
            continue
    return out


def _bookmark_union(conn) -> tuple[dict[int, int], dict[int, int]]:
    """Union every client user's bookmarks across all sync blobs.

    Returns (tender_id -> distinct bookmarker count, org_id -> count). Org
    bookmarks stored only by name are resolved to ids here (name->id fallback).
    """
    tender_users: dict[int, set[Any]] = {}
    org_users_by_id: dict[int, set[Any]] = {}
    org_users_by_name: dict[str, set[Any]] = {}
    blobs: list[tuple[Any, dict]] = []
    for row in conn.execute("SELECT user_id, data_json FROM client_user_sync").fetchall():
        try:
            blobs.append((int(row[0]), json.loads(row[1] or "{}")))
        except (TypeError, ValueError):
            continue
    # An organisation's shared bookmarks count as one more bookmarker.
    blobs.extend((("org", org_id), blob) for org_id, blob in org_access.all_org_blobs(conn))
    for user_id, blob in blobs:
        if not isinstance(blob, dict):
            continue
        for tid in _rows_for_tender_ids(conn, _blob_bookmark_tender_ids(conn, blob)).values():
            tender_users.setdefault(tid, set()).add(user_id)
        for oid in _coerce_id_set(blob.get("bookmarkedOrgIds")):
            org_users_by_id.setdefault(oid, set()).add(user_id)
        for name in blob.get("bookmarkedOrgs") or []:
            name = str(name or "").strip()
            if name:
                org_users_by_name.setdefault(name, set()).add(user_id)
    if org_users_by_name:
        placeholders = ",".join("?" for _ in org_users_by_name)
        rows = conn.execute(
            f"SELECT id, name FROM organizations WHERE name IN ({placeholders})",
            tuple(org_users_by_name),
        ).fetchall()
        for oid, name in rows:
            org_users_by_id.setdefault(int(oid), set()).update(org_users_by_name.get(str(name), set()))
    return (
        {tid: len(users) for tid, users in tender_users.items()},
        {oid: len(users) for oid, users in org_users_by_id.items()},
    )


def _saved_job_coverage(conn) -> tuple[set[int], dict[int, set[int]], dict[int, set[int]]]:
    """Which orgs/tenders an active ADMIN saved_custom_job already keeps fresh.

    Returns (website_ids whose every org is covered by a scrape job,
    website_id -> covered org ids, website_id -> covered tender ids).
    Only admin-created jobs count — a user (bookmark-managed) job never
    "covers" a bookmark, it *is* the bookmark's job.
    """
    website_all_org_scrape: set[int] = set()
    scrape_orgs: dict[int, set[int]] = {}
    download_tenders: dict[int, set[int]] = {}
    rows = conn.execute(
        "SELECT website_id, job_type, org_ids_json, tender_ids_json, all_organizations "
        "FROM saved_custom_jobs WHERE schedule_enabled=1 AND schedule_mode IN ('once','interval') "
        "AND COALESCE(created_by,'admin')='admin'"
    ).fetchall()
    for website_id, job_type, org_ids_json, tender_ids_json, all_orgs in rows:
        website_id = int(website_id)
        if str(job_type) == "scrape":
            org_ids = _json_id_list(org_ids_json)
            if all_orgs and org_ids:
                # all_organizations alone only refreshes the org list; paired
                # with explicit orgs it scrapes every org's tenders too.
                website_all_org_scrape.add(website_id)
            scrape_orgs.setdefault(website_id, set()).update(org_ids)
        elif str(job_type) == "download":
            download_tenders.setdefault(website_id, set()).update(_json_id_list(tender_ids_json))
    return website_all_org_scrape, scrape_orgs, download_tenders


def _bookmark_wanted_orgs_by_website(conn) -> dict[int, set[int]]:
    """Per website, the set of org ids that client bookmarks want kept fresh:
    every bookmarked org, plus the parent org of every bookmarked tender."""
    tender_counts, org_counts = _bookmark_union(conn)
    wanted: dict[int, set[int]] = {}
    if org_counts:
        placeholders = ",".join("?" for _ in org_counts)
        for oid, website_id in conn.execute(
            f"SELECT id, website_id FROM organizations WHERE id IN ({placeholders})",
            tuple(org_counts),
        ).fetchall():
            wanted.setdefault(int(website_id or 0), set()).add(int(oid))
    if tender_counts:
        placeholders = ",".join("?" for _ in tender_counts)
        for website_id, org_id in conn.execute(
            f"SELECT t.website_id, o.id FROM tenders t "
            f"JOIN organizations o ON o.website_id=t.website_id AND o.name=t.org_chain "
            f"WHERE t.id IN ({placeholders})",
            tuple(tender_counts),
        ).fetchall():
            wanted.setdefault(int(website_id or 0), set()).add(int(org_id))
    wanted.pop(0, None)
    return wanted


def _reconcile_bookmark_jobs() -> None:
    """Keep one auto-managed 'Bookmarks · <site>' scrape job per website in
    saved_custom_jobs (created_by='user'), holding every bookmarked org not
    already covered by an admin scrape job. Never touches an admin job; never
    re-enables a paused user job; never recreates one an admin deleted (see
    bookmark_scrape_suppressed)."""
    now = time.time()
    interval_s = BOOKMARK_SCRAPE_INTERVAL_MINUTES * 60
    with _get_db() as conn:
        wanted = _bookmark_wanted_orgs_by_website(conn)
        all_org_sites, cov_orgs, _cov_tenders = _saved_job_coverage(conn)
        suppressed = {
            int(r[0]) for r in conn.execute(
                "SELECT website_id FROM bookmark_scrape_suppressed"
            ).fetchall()
        }
        existing = {
            int(r[1]): {"id": int(r[0])}
            for r in conn.execute(
                "SELECT id, website_id FROM saved_custom_jobs "
                "WHERE COALESCE(created_by,'admin')='user' AND job_type='scrape'"
            ).fetchall()
        }
        website_names = {
            int(r[0]): str(r[1] or f"Website {int(r[0])}")
            for r in conn.execute("SELECT id, name FROM websites").fetchall()
        }

        for website_id, job in list(existing.items()):
            if website_id not in wanted or website_id in suppressed:
                conn.execute("DELETE FROM saved_custom_jobs WHERE id=?", (job["id"],))
                existing.pop(website_id, None)

        for website_id, orgs in wanted.items():
            if website_id in suppressed:
                continue
            uncovered = (
                set() if website_id in all_org_sites
                else {oid for oid in orgs if oid not in cov_orgs.get(website_id, set())}
            )
            job = existing.get(website_id)
            if not uncovered:
                if job:
                    conn.execute("DELETE FROM saved_custom_jobs WHERE id=?", (job["id"],))
                continue
            org_ids_json = json.dumps(sorted(uncovered))
            if job:
                # Refresh coverage only — leave schedule_enabled / mode /
                # interval / next_run_at exactly as the admin's Pause left them.
                conn.execute(
                    "UPDATE saved_custom_jobs SET org_ids_json=?, all_organizations=0, "
                    "updated_at=? WHERE id=?",
                    (org_ids_json, now, job["id"]),
                )
            else:
                name = f"Bookmarks · {website_names.get(website_id, f'Website {website_id}')}"
                conn.execute(
                    "INSERT INTO saved_custom_jobs "
                    "(owner_name,name,website_id,job_type,org_ids_json,tender_ids_json,"
                    "all_organizations,all_tenders,download_mode,schedule_enabled,schedule_mode,"
                    "interval_minutes,scheduled_for_at,next_run_at,created_by,created_at,updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        "(bookmarks)", name, website_id, "scrape", org_ids_json, "[]",
                        0, 0, "full", 1, "interval",
                        BOOKMARK_SCRAPE_INTERVAL_MINUTES, now + interval_s, now + interval_s,
                        "user", now, now,
                    ),
                )
        conn.commit()


def _apply_bookmark_schedules(data: dict[str, Any]) -> None:
    # Side effect of a sync push: reconcile the auto-managed per-website
    # "Bookmarks" scrape job against the union of all users' bookmarks.
    # Best-effort — a failure here must never fail the sync push itself.
    try:
        _reconcile_bookmark_jobs()
    except Exception:
        pass


@router.get("/sync", dependencies=[Depends(require_client_user)])
def client_pull_sync(user_id: int = Depends(require_client_user)) -> dict[str, Any]:
    # An individual gets their own row; an org member gets the org's shared
    # data plus their own personal keys. Sections the user may not use are
    # left out (org_access.effective_blob).
    with _get_db() as conn:
        blob, updated_at, found = org_access.effective_blob(conn, user_id)
        if not found:
            return {"data": {}, "updated_at": 0}
        return {"data": _with_current_row_ids(conn, blob), "updated_at": updated_at}


# Collections in the sync blob that must merge ADDITIVELY across devices — a
# client holding only a subset (fresh install, was offline, dev origin) must
# never be able to shrink them just by pushing. Removals travel as an explicit
# `removed` delta instead.
# Tender bookmarks are stored as tender ids (bookmarkTenderIds); `bookmarks`
# (row ids) is derived from them on every read/write, never merged itself.
_SYNC_ID_SET_KEYS = ("bookmarkedOrgIds",)                     # integer ids
_SYNC_NAME_SET_KEYS = ("bookmarkedOrgs", "bookmarkTenderIds")  # strings
_SYNC_ROW_KEYS = ("projects", "checklist")              # list[dict] keyed by "id"


def _row_id(row: Any) -> Any:
    if isinstance(row, dict):
        try:
            return int(row.get("id"))
        except (TypeError, ValueError):
            return row.get("id")
    return None


_VERSION_PRUNE_SECONDS = 30 * 24 * 3600


def _prune_version_map(vmap: dict, now: float) -> dict:
    out: dict[str, dict] = {}
    for key, entries in (vmap or {}).items():
        kept = {
            item: ts for item, ts in (entries or {}).items()
            if isinstance(ts, (int, float)) and now - float(ts) <= _VERSION_PRUNE_SECONDS
        }
        if kept:
            out[key] = kept
    return out


def _prefs_newer_or_equal(incoming: Any, stored: Any) -> bool:
    """notificationPrefs carries its own `updatedAt` (ms, set when the user
    changes a toggle). Missing counts as 0, so an unstamped write never
    replaces a stamped one."""
    def _stamp(value: Any) -> float:
        try:
            return float((value or {}).get("updatedAt") or 0) if isinstance(value, dict) else 0.0
        except (TypeError, ValueError):
            return 0.0
    if not isinstance(stored, dict):
        return True
    return _stamp(incoming) >= _stamp(stored)


def _keep_server_file(incoming_row: dict, stored_row: Any) -> dict:
    """A checklist row's server_file (its uploaded file, project_files.py) is
    the server's: whatever a pushing device sends for it is replaced by the
    stored value, so a stale or older app can neither drop nor fake it."""
    row = {k: v for k, v in incoming_row.items() if k != "server_file"}
    if isinstance(stored_row, dict) and stored_row.get("server_file"):
        row["server_file"] = stored_row["server_file"]
    return row


def _merge_sync_blob(
    stored: dict, incoming: dict, removed: dict, conn,
    base_updated_at: float | None = None, now: float | None = None,
) -> dict:
    # `now` MUST be the same value client_push_sync writes as `updated_at`, so
    # an item stamped by this push has `_v ts == updated_at` and a later push
    # whose `base_updated_at` equals that `updated_at` is NOT treated as stale.
    now = time.time() if now is None else float(now)
    removed = dict(removed) if isinstance(removed, dict) else {}
    incoming = dict(incoming) if isinstance(incoming, dict) else {}
    stored = dict(stored or {})
    # Tender bookmarks travel as tender ids. A blob or an older app build that
    # only has row ids is converted here, while those rows still exist.
    if "bookmarkTenderIds" not in stored and "bookmarks" in stored:
        stored["bookmarkTenderIds"] = sorted(_blob_bookmark_tender_ids(conn, stored))
    if "bookmarkTenderIds" in incoming:
        incoming["bookmarkTenderIds"] = sorted(_coerce_tender_id_set(incoming.get("bookmarkTenderIds")))
    elif "bookmarks" in incoming:
        incoming["bookmarkTenderIds"] = sorted(
            _tender_ids_for_rows(conn, _coerce_id_set(incoming.get("bookmarks"))).values()
        )
    if "bookmarkTenderIds" in removed:
        removed["bookmarkTenderIds"] = sorted(_coerce_tender_id_set(removed.get("bookmarkTenderIds")))
    elif "bookmarks" in removed:
        removed["bookmarkTenderIds"] = sorted(
            _tender_ids_for_rows(conn, _coerce_id_set(removed.get("bookmarks"))).values()
        )
    incoming.pop("bookmarks", None)
    merged = {k: v for k, v in stored.items()}

    # Per-item "last changed" / "deleted at" clocks live inside the blob.
    versions: dict[str, dict] = {k: dict(v or {}) for k, v in (stored.get("_v") or {}).items()}
    deleted: dict[str, dict] = {k: dict(v or {}) for k, v in (stored.get("_deleted") or {}).items()}

    gated = base_updated_at is not None
    base = float(base_updated_at or 0)

    # Lost baseline: a client that declares base=0 while a real blob exists
    # can't be trusted to express deltas — the server's copy wins outright.
    meaningful = [k for k in (stored or {}) if not k.startswith("_")]
    if gated and base <= 0 and meaningful:
        return _with_current_row_ids(conn, merged)

    def _mk(x: Any) -> str:
        return str(x)

    def _online_changed(key: str, item: Any) -> bool:
        if not gated or base <= 0:
            return False
        mk = _mk(item)
        v = versions.get(key, {}).get(mk)
        d = deleted.get(key, {}).get(mk)
        return (isinstance(v, (int, float)) and float(v) > base) or (
            isinstance(d, (int, float)) and float(d) > base
        )

    def _stamp_add(key: str, item: Any) -> None:
        versions.setdefault(key, {})[_mk(item)] = now
        deleted.get(key, {}).pop(_mk(item), None)

    def _stamp_del(key: str, item: Any) -> None:
        deleted.setdefault(key, {})[_mk(item)] = now
        versions.get(key, {}).pop(_mk(item), None)

    # ── integer id sets ─────────────────────────────────────────────────
    for key in _SYNC_ID_SET_KEYS:
        if key not in incoming:
            continue
        cur = _coerce_id_set(stored.get(key))
        result = set(cur)
        for item in _coerce_id_set(incoming.get(key)) - cur:
            if _online_changed(key, item):
                continue
            result.add(item)
            _stamp_add(key, item)
        for item in _coerce_id_set(removed.get(key)):
            if _online_changed(key, item):
                continue
            result.discard(item)
            _stamp_del(key, item)
        merged[key] = sorted(result)

    # ── string name sets ────────────────────────────────────────────────
    for key in _SYNC_NAME_SET_KEYS:
        if key not in incoming:
            continue
        cur = {str(v) for v in (stored.get(key) or [])}
        result = set(cur)
        for item in {str(v) for v in (incoming.get(key) or [])} - cur:
            if _online_changed(key, item):
                continue
            result.add(item)
            _stamp_add(key, item)
        for item in {str(v) for v in (removed.get(key) or [])}:
            if _online_changed(key, item):
                continue
            result.discard(item)
            _stamp_del(key, item)
        merged[key] = sorted(result)

    # ── row collections keyed by "id" ──────────────────────────────────
    for key in _SYNC_ROW_KEYS:
        if key not in incoming:
            continue
        by_id: dict[Any, Any] = {}
        order: list[Any] = []
        for row in list(stored.get(key) or []):
            rid = _row_id(row)
            if rid not in by_id:
                order.append(rid)
            by_id[rid] = row
        for row in list(incoming.get(key) or []):
            rid = _row_id(row)
            if rid is None or _online_changed(key, rid):
                continue
            if key == "checklist" and isinstance(row, dict):
                row = _keep_server_file(row, by_id.get(rid))
            if rid not in by_id:
                order.append(rid)
            by_id[rid] = row
            _stamp_add(key, rid)
        for item in _coerce_id_set(removed.get(key)):
            if _online_changed(key, item):
                continue
            by_id.pop(item, None)
            _stamp_del(key, item)
        merged[key] = [by_id[rid] for rid in order if rid in by_id]

    for key, value in incoming.items():
        if key in _SYNC_ID_SET_KEYS or key in _SYNC_NAME_SET_KEYS or key in _SYNC_ROW_KEYS:
            continue
        if key.startswith("_"):
            continue
        if key == "notificationPrefs" and not _prefs_newer_or_equal(value, merged.get(key)):
            # A fresh install or older build would otherwise overwrite the
            # saved preferences with its own defaults (push silently stops).
            continue
        merged[key] = value  # key-preserving: incoming wins, omitted keys kept

    pruned_v = _prune_version_map(versions, now)
    pruned_del = _prune_version_map(deleted, now)
    if pruned_v:
        merged["_v"] = pruned_v
    else:
        merged.pop("_v", None)
    if pruned_del:
        merged["_deleted"] = pruned_del
    else:
        merged.pop("_deleted", None)

    # Supplement bookmarkedOrgIds with ids resolved from the merged names, so a
    # device that only sent names still contributes to the id set.
    names = merged.get("bookmarkedOrgs")
    if isinstance(names, list) and names and ("bookmarkedOrgs" in incoming or "bookmarkedOrgIds" in incoming):
        placeholders = ",".join("?" for _ in names)
        resolved = {
            int(r[0])
            for r in conn.execute(
                f"SELECT id FROM organizations WHERE name IN ({placeholders})",
                tuple(str(n) for n in names),
            ).fetchall()
        }
        gone = _coerce_id_set((removed or {}).get("bookmarkedOrgIds"))
        merged["bookmarkedOrgIds"] = sorted(
            (_coerce_id_set(merged.get("bookmarkedOrgIds")) | resolved) - gone
        )

    # Phantom cleanup: drop bookmarked org ids that no longer exist here.
    # Bookmarked tender ids are kept even when the tender isn't in the database
    # right now, so they reconnect when it returns (restore or re-scrape).
    ids = _coerce_id_set(merged.get("bookmarkedOrgIds"))
    if ids:
        placeholders = ",".join("?" for _ in ids)
        real = {
            int(r[0])
            for r in conn.execute(
                f"SELECT id FROM organizations WHERE id IN ({placeholders})", tuple(ids)
            ).fetchall()
        }
        if real != ids:
            merged["bookmarkedOrgIds"] = sorted(real)

    return _with_current_row_ids(conn, merged)


@router.put("/sync", dependencies=[Depends(require_client_user)])
def client_push_sync(body: SyncPushRequest, user_id: int = Depends(require_client_user)) -> dict[str, Any]:
    now = time.time()
    with _get_db() as conn:
        account = org_access.get_account(conn, user_id)
        stored, _stored_at, _found = org_access.read_user_blob(conn, user_id)
        # The server replaced this user's data (joined or left an org) after
        # this device last pulled: its copy is stale, so the server's wins.
        reset_at = stored.get(org_access.RESET_KEY)
        if (
            isinstance(reset_at, (int, float)) and body.base_updated_at is not None
            and float(body.base_updated_at) < float(reset_at)
        ):
            _blob, current_at, _f = org_access.effective_blob(conn, user_id, account)
            return {"ok": True, "updated_at": current_at}
        # Sections the user may not use are never written: the stored data
        # stays as it was until the section is turned back on.
        hidden = org_access.hidden_keys(account["permissions"])
        incoming = {
            k: v for k, v in (body.data if isinstance(body.data, dict) else {}).items() if k not in hidden
        }
        removed = {
            k: v for k, v in (body.removed if isinstance(body.removed, dict) else {}).items() if k not in hidden
        }
        # Additive merge with per-item concurrency: bookmark sets union (minus
        # an explicit `removed` delta), projects/checklist merge by id,
        # everything else keeps a key the client omitted. When the client
        # sends `base_updated_at`, an incoming change to an item the server
        # changed after that timestamp is skipped (online beats offline).
        if account["org_id"] is None:
            merged = _merge_sync_blob(stored, incoming, removed, conn, body.base_updated_at, now)
            _check_sync_size(merged)
            org_access.write_user_blob(conn, user_id, merged, now)
        else:
            # Org member: shared keys go to the org's pool, personal keys
            # (column/notification prefs) to their own row.
            shared_in = {k: v for k, v in incoming.items() if k in org_access.SHARED_KEYS}
            shared_rm = {k: v for k, v in removed.items() if k in org_access.SHARED_KEYS}
            org_stored, _org_at, _org_found = org_access.read_org_blob(conn, account["org_id"])
            merged = _merge_sync_blob(org_stored, shared_in, shared_rm, conn, body.base_updated_at, now)
            personal = _merge_sync_blob(
                stored,
                {k: v for k, v in incoming.items() if k not in org_access.SHARED_KEYS},
                {k: v for k, v in removed.items() if k not in org_access.SHARED_KEYS},
                conn, body.base_updated_at, now,
            )
            _check_sync_size(merged)
            _check_sync_size(personal)
            org_access.write_org_blob(conn, account["org_id"], merged, now)
            org_access.write_user_blob(conn, user_id, personal, now)
        # A checklist row this push removed takes its uploaded file with it.
        before = org_stored if account["org_id"] is not None else stored
        kept = {str(r.get("id")) for r in (merged.get("checklist") or []) if isinstance(r, dict)}
        gone = [
            r.get("id") for r in (before.get("checklist") or [])
            if isinstance(r, dict) and r.get("server_file") and str(r.get("id")) not in kept
        ]
        if gone:
            project_files.trash_items(conn, project_files.scope_for(account), gone, now)
        conn.commit()
    _apply_bookmark_schedules(merged)
    return {"ok": True, "updated_at": now}


def _check_sync_size(blob: dict) -> None:
    if len(json.dumps(blob, ensure_ascii=False).encode("utf-8")) > MAX_SYNC_PAYLOAD_BYTES:
        raise HTTPException(413, "Sync payload is too large.")


_ALERTABLE_CHANGED_FIELDS = {"closing_date", "status", "prebid_count", "corrigendum_count"}


def _compute_user_changes(
    conn: Any, user_id: int, since: float
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    """Core of the /changes diff, factored out so apns_push.py's scheduler pass
    can reuse the exact same comparison the polling endpoint below uses,
    instead of drifting out of sync with a second implementation."""
    tenders_changed: list[dict[str, Any]] = []
    new_by_org: dict[str, list[dict[str, Any]]] = {}
    # The org's bookmarks for a member; none at all without the bookmarks section.
    blob, _updated_at, _found = org_access.effective_blob(conn, user_id)
    tender_ids = sorted(_rows_for_tender_ids(conn, _blob_bookmark_tender_ids(conn, blob)).values())
    org_names = sorted(
        {str(n).strip() for n in (blob.get("bookmarkedOrgs") or []) if str(n).strip()}
    )

    if since > 0 and tender_ids:
        placeholders = ",".join("?" for _ in tender_ids)
        hist = conn.execute(
            f"SELECT tender_db_id, changed_fields FROM tender_history "
            f"WHERE tender_db_id IN ({placeholders}) AND scraped_at > ?",
            (*tender_ids, since),
        ).fetchall()
        fields_by_tender: dict[int, set[str]] = {}
        for tid, changed_fields in hist:
            try:
                names = json.loads(changed_fields or "[]")
            except (TypeError, ValueError):
                names = []
            fields_by_tender.setdefault(int(tid), set()).update(str(n) for n in names)
        hit_ids = [tid for tid, names in fields_by_tender.items() if names & _ALERTABLE_CHANGED_FIELDS]
        if hit_ids:
            ph2 = ",".join("?" for _ in hit_ids)
            rows = {
                int(r[0]): (str(r[1] or ""), str(r[2] or ""), str(r[3] or ""))
                for r in conn.execute(
                    f"SELECT id, title, status, tender_id FROM tenders WHERE id IN ({ph2})", tuple(hit_ids)
                ).fetchall()
            }
            for tid in hit_ids:
                title, status, portal_id = rows.get(tid, ("", "", ""))
                tenders_changed.append({
                    "id": tid,
                    "tender_id": portal_id,
                    "title": title,
                    "status": status,
                    "changed_fields": sorted(fields_by_tender[tid] & _ALERTABLE_CHANGED_FIELDS),
                })

    if since > 0 and org_names:
        placeholders = ",".join("?" for _ in org_names)
        rows = conn.execute(
            f"SELECT id, title, tender_id, org_chain FROM tenders "
            f"WHERE org_chain IN ({placeholders}) AND COALESCE(is_archived,0)=0 "
            f"AND COALESCE(first_seen_at,0) > ? ORDER BY COALESCE(first_seen_at,0)",
            (*org_names, since),
        ).fetchall()
        for r in rows:
            new_by_org.setdefault(str(r[3] or ""), []).append({
                "id": int(r[0]),
                "title": str(r[1] or ""),
                "tender_id": str(r[2] or ""),
            })

    return tenders_changed, new_by_org


# How far back the push pass looks for rows it hasn't handled. Far longer than a
# scrape takes to commit the rows it stamped; older rows are never pushed.
PUSH_EVENT_LOOKBACK_SECONDS = 48 * 3600


def _unhandled_push_events(
    conn: Any, now: float
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Recent new tenders (tenders rows) and tender changes (tender_history rows)
    the push pass hasn't handled yet -- by row, not by time: a row a scrape
    stamped before the last pass but committed after it is still here."""
    since = now - PUSH_EVENT_LOOKBACK_SECONDS
    new_events = [
        {"ref_id": int(r[0]), "title": str(r[1] or ""), "tender_id": str(r[2] or ""),
         "org": str(r[3] or ""), "at": float(r[4] or 0)}
        for r in map(_values, conn.execute(
            "SELECT t.id, t.title, t.tender_id, t.org_chain, t.first_seen_at FROM tenders t "
            "WHERE t.first_seen_at > ? AND COALESCE(t.is_archived,0)=0 "
            "AND NOT EXISTS (SELECT 1 FROM push_handled_events h "
            "WHERE h.kind='new' AND h.ref_id=t.id) "
            "ORDER BY t.first_seen_at, t.id",
            (since,),
        ).fetchall())
    ]
    change_events = []
    for r in map(_values, conn.execute(
        "SELECT h.id, h.tender_db_id, h.changed_fields, h.scraped_at FROM tender_history h "
        "WHERE h.scraped_at > ? AND NOT EXISTS (SELECT 1 FROM push_handled_events p "
        "WHERE p.kind='change' AND p.ref_id=h.id) "
        "ORDER BY h.scraped_at, h.id",
        (since,),
    ).fetchall()):
        try:
            names = json.loads(r[2] or "[]")
        except (TypeError, ValueError):
            names = []
        change_events.append({
            "ref_id": int(r[0]), "tender_db_id": int(r[1]), "at": float(r[3] or 0),
            # Every row is handled; only these fields make a push.
            "fields": {str(n) for n in names} & _ALERTABLE_CHANGED_FIELDS,
        })
    return new_events, change_events


def _user_push_changes(
    conn: Any, blob: dict, floor: float,
    new_events: list[dict[str, Any]], change_events: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    """One user's share of the unhandled events (their bookmarked tenders and
    organisations, after `floor` -- when the device registered), shaped like
    _compute_user_changes' result."""
    tender_ids = set(_rows_for_tender_ids(conn, _blob_bookmark_tender_ids(conn, blob)).values())
    org_names = {str(n).strip() for n in (blob.get("bookmarkedOrgs") or []) if str(n).strip()}

    fields_by_tender: dict[int, set[str]] = {}
    for e in change_events:
        if e["fields"] and e["at"] > floor and e["tender_db_id"] in tender_ids:
            fields_by_tender.setdefault(e["tender_db_id"], set()).update(e["fields"])
    tenders_changed: list[dict[str, Any]] = []
    if fields_by_tender:
        ids = list(fields_by_tender)
        placeholders = ",".join("?" for _ in ids)
        rows = {
            int(r[0]): (str(r[1] or ""), str(r[2] or ""), str(r[3] or ""))
            for r in map(_values, conn.execute(
                f"SELECT id, title, status, tender_id FROM tenders WHERE id IN ({placeholders})",
                tuple(ids),
            ).fetchall())
        }
        for tid in ids:
            title, status, portal_id = rows.get(tid, ("", "", ""))
            tenders_changed.append({
                "id": tid,
                "tender_id": portal_id,
                "title": title,
                "status": status,
                "changed_fields": sorted(fields_by_tender[tid]),
            })

    new_by_org: dict[str, list[dict[str, Any]]] = {}
    for e in new_events:
        if e["at"] > floor and e["org"] in org_names:
            new_by_org.setdefault(e["org"], []).append(
                {"id": e["ref_id"], "title": e["title"], "tender_id": e["tender_id"]}
            )
    return tenders_changed, new_by_org


def _mark_push_events_handled(
    conn: Any, new_events: list[dict[str, Any]], change_events: list[dict[str, Any]], now: float
) -> None:
    """Records the events as handled (never pushed again) and forgets ones too old
    to come up again."""
    rows = [("new", e["ref_id"], now) for e in new_events] + [
        ("change", e["ref_id"], now) for e in change_events
    ]
    if rows:
        conn.executemany(
            "INSERT INTO push_handled_events (kind, ref_id, handled_at) VALUES (?,?,?) "
            "ON CONFLICT(kind, ref_id) DO NOTHING",
            rows,
        )
    conn.execute(
        "DELETE FROM push_handled_events WHERE handled_at < ?",
        (now - 2 * PUSH_EVENT_LOOKBACK_SECONDS,),
    )
    conn.commit()


@router.get("/changes", dependencies=[Depends(require_client_user)])
def client_changes(
    since: float = Query(0.0, ge=0),
    user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    """Server-recorded changes to this user's bookmarked tenders/orgs since `since`.

    `since` is an epoch seconds value the client got back as `now` on its last
    call. The first call (since=0) returns nothing but a fresh `now`, so clients
    don't alert on the whole back-catalogue.
    """
    now = time.time()
    with _get_db() as conn:
        tenders_changed, new_by_org = _compute_user_changes(conn, user_id, since)
    return {"now": now, "tenders": tenders_changed, "new_by_org": new_by_org}


class RegisterPushTokenRequest(BaseModel):
    token: str = Field(min_length=8, max_length=512)
    platform: str = "ios"
    # Which app registered the token: BM Pro sends neither field, so its rows
    # keep 'bmpro'/'production'. Bidwise sends app='bidwise' and the APNs
    # environment of the build (a Debug build's token is a sandbox token).
    app: str = "bmpro"
    environment: str = "production"


@router.post("/push-token")
def client_register_push_token(
    body: RegisterPushTokenRequest,
    user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    # A device token can migrate between accounts (sign out, sign in as someone
    # else on the same phone) -- UPSERT on the token itself (unique index) so a
    # stale row under a previous user is reassigned rather than duplicated.
    now = time.time()
    token = body.token.strip()
    app = (body.app or "bmpro").strip().lower()
    if app not in ("bmpro", "bidwise"):
        raise HTTPException(status_code=400, detail="Unknown app.")
    environment = (body.environment or "production").strip().lower()
    if environment not in ("production", "sandbox"):
        raise HTTPException(status_code=400, detail="Unknown environment.")
    with _get_db() as conn:
        conn.execute(
            # last_pushed_at starts at `now`, not the column default of 0 --
            # api_server.py's push pass treats since=0 as "brand new, don't
            # flood with the whole history" and skips the diff entirely on a
            # device's first pass. Seeding it with 0 would mean anything that
            # appears in the few seconds/minutes between registration and
            # that first pass falls into that same since=0 gap and is
            # silently never sent, even though it's not history -- it
            # happened after registration. Only matters on first INSERT
            # (a re-registration via ON CONFLICT below keeps the existing
            # cursor, same as today).
            "INSERT INTO client_push_tokens "
            "(user_id, token, platform, app, apns_env, created_at, last_seen_at, last_pushed_at) "
            "VALUES (?,?,?,?,?,?,?,?) "
            "ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id, platform=excluded.platform, "
            "app=excluded.app, apns_env=excluded.apns_env, last_seen_at=excluded.last_seen_at",
            (user_id, token, body.platform.strip() or "ios", app, environment, now, now, now),
        )
        conn.commit()
    return {"ok": True}


@router.delete("/push-token")
def client_unregister_push_token(
    body: RegisterPushTokenRequest,
    user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    with _get_db() as conn:
        conn.execute(
            "DELETE FROM client_push_tokens WHERE token=? AND user_id=?",
            (body.token.strip(), user_id),
        )
        conn.commit()
    return {"ok": True}


class SyncBadgeRequest(BaseModel):
    count: int = Field(ge=0)
    # Bidwise: organisations whose "new tenders" alert is still unread. Their
    # pending grouped pushes are kept; the rest are dropped, so the next new
    # tender under them starts a fresh notification (and badge). BM Pro omits it.
    unread_orgs: Optional[list[str]] = None


@router.put("/badge")
def client_sync_badge(
    body: SyncBadgeRequest,
    user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    # The app tells the server its real current unread count whenever it
    # changes locally (see alerts.js) so api_server.py's push pass -- which
    # otherwise just increments badge_count by 1 on every push it sends --
    # has an accurate baseline to climb from instead of drifting upward
    # forever once the user has actually read something. Applies to every
    # device this user has registered, not just the one making the call, so
    # a multi-device user sees the same number everywhere.
    with _get_db() as conn:
        conn.execute(
            "UPDATE client_push_tokens SET badge_count=? WHERE user_id=?",
            (body.count, user_id),
        )
        if body.unread_orgs is not None or body.count == 0:
            keep = set(body.unread_orgs or []) if body.count else set()
            rows = conn.execute(
                "SELECT id, pending_orgs FROM client_push_tokens WHERE user_id=?", (user_id,)
            ).fetchall()
            for row_id, raw in rows:
                try:
                    pending = json.loads(raw or "{}")
                except (TypeError, ValueError):
                    pending = {}
                kept = {org: v for org, v in pending.items() if org in keep}
                if kept != pending:
                    conn.execute(
                        "UPDATE client_push_tokens SET pending_orgs=? WHERE id=?",
                        (json.dumps(kept), row_id),
                    )
        conn.commit()
    return {"ok": True}


class CaptchaAnswerRequest(BaseModel):
    text: str = Field(max_length=200)


@router.get("/captcha/pending")
def client_captcha_pending(
    user_id: int = Depends(require_client_user),
) -> Optional[dict[str, Any]]:
    with _get_db() as conn:
        row = conn.execute(
            "SELECT id, image_base64, context FROM captcha_requests "
            "WHERE user_id=? AND status='pending' ORDER BY created_at ASC LIMIT 1",
            (user_id,),
        ).fetchone()
    if not row:
        return None
    return {"request_id": str(row[0]), "image_base64": str(row[1] or ""), "context": str(row[2] or "captcha")}


@router.post("/captcha/{captcha_id}/answer")
def client_answer_captcha(
    captcha_id: str,
    body: CaptchaAnswerRequest,
    user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    # Scoped to this user's own row, then handed to the exact same
    # submit_captcha() the admin console's /admin/captchas/{id}/answer uses --
    # its atomic "WHERE status='pending'" UPDATE is what makes this safe to
    # race against the admin desktop console answering the same CAPTCHA:
    # whichever call executes first wins, the other gets a 404 here same as
    # it would there.
    with _get_db() as conn:
        row = conn.execute(
            "SELECT id FROM captcha_requests WHERE id=? AND user_id=? AND status='pending'",
            (captcha_id, user_id),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Captcha request not found or already resolved.")
    import api_server  # deferred: api_server imports this module at load time
    return api_server.submit_captcha(api_server.CaptchaSubmitRequest(request_id=captcha_id, text=body.text))


def _page_meta(page: int, page_size: int, total: int) -> dict[str, int]:
    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "pages": (total + page_size - 1) // page_size if total else 0,
    }


def _public_base_url(request: Optional[Request]) -> str:
    """Base URL the client reached us on (honours Caddy's X-Forwarded-Proto)."""
    if request is None:
        return ""
    base = str(request.base_url).rstrip("/")
    proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    if proto in {"http", "https"} and "://" in base:
        base = f"{proto}://{base.split('://', 1)[1]}"
    return base


def _client_tender_url(tender_url: str, base_url: str) -> str:
    """nProcure tender pages only open via a form POST, so hand clients the server's
    hand-off page (/portal/nprocure/tender/<id>) instead of the raw portal URL."""
    if base_url and "nprocure.com" in tender_url:
        from scrapers import nprocure
        path = nprocure.open_link_path(tender_url)
        if path:
            return f"{base_url}{path}"
    return tender_url


def _public_tender(row: Any, base_url: str = "") -> dict[str, Any]:
    data = dict(row)
    return {
        "id": int(data["id"]),
        "website_id": int(data["website_id"]),
        "website_name": str(data.get("website_name") or ""),
        "website_url": str(data.get("website_url") or ""),
        "organization": str(data.get("org_chain") or ""),
        "tender_id": str(data.get("tender_id") or ""),
        "title": str(data.get("title") or ""),
        "work_description": str(data.get("work_description") or ""),
        "tender_value": str(data.get("tender_value") or ""),
        "emd": str(data.get("emd") or ""),
        "closing_date": str(data.get("closing_date") or ""),
        "opening_date": str(data.get("opening_date") or ""),
        "published_date": str(data.get("published_date") or ""),
        "pre_bid_meeting_date": str(data.get("pre_bid_meeting_date") or ""),
        "location": str(data.get("location") or ""),
        "category": str(data.get("tender_category") or ""),
        "status": str(data.get("status") or ""),
        "is_archived": bool(data.get("is_archived")),
        "has_documents": int(data.get("document_count") or 0) > 0,
        "document_count": int(data.get("document_count") or 0),
        "prebid_count": int(data.get("prebid_count") or 0),
        "corrigendum_count": int(data.get("corrigendum_count") or 0),
        "last_update_checked_at": float(data.get("last_update_checked_at") or 0) or None,
        "last_status_checked_at": float(data.get("last_status_checked_at") or 0) or None,
        "tender_url": _client_tender_url(str(data.get("tender_url") or ""), base_url),
    }


def _tender_select() -> str:
    return (
        "SELECT t.id,t.website_id,COALESCE(w.name,'') AS website_name,"
        "COALESCE(w.url,'') AS website_url,"
        "COALESCE(t.org_chain,'') AS org_chain,COALESCE(t.tender_id,'') AS tender_id,"
        "COALESCE(t.title,'') AS title,COALESCE(t.work_description,'') AS work_description,"
        "COALESCE(t.tender_value,'') AS tender_value,COALESCE(t.emd,'') AS emd,"
        "COALESCE(t.closing_date,'') AS closing_date,COALESCE(t.opening_date,'') AS opening_date,"
        "COALESCE(t.published_date,'') AS published_date,"
        "COALESCE(t.pre_bid_meeting_date,'') AS pre_bid_meeting_date,"
        "COALESCE(t.location,'') AS location,COALESCE(t.tender_category,'') AS tender_category,"
        "COALESCE(t.status,'') AS status,COALESCE(t.is_archived,0) AS is_archived,"
        "COALESCE(t.tender_url,'') AS tender_url,"
        "COALESCE(t.prebid_count,0) AS prebid_count,"
        "COALESCE(t.corrigendum_count,0) AS corrigendum_count,"
        "COALESCE(t.last_update_checked_at,0) AS last_update_checked_at,"
        "COALESCE(t.last_status_checked_at,0) AS last_status_checked_at,"
        "(SELECT COUNT(*) FROM downloaded_files d WHERE "
        "d.tender_db_id=t.id OR (d.tender_db_id IS NULL AND "
        "UPPER(TRIM(COALESCE(d.tender_id,'')))=UPPER(TRIM(COALESCE(t.tender_id,''))))) "
        "AS document_count FROM tenders t LEFT JOIN websites w ON w.id=t.website_id"
    )


def _tender_filters(
    *,
    query: str = "",
    website_id: Optional[int] = None,
    archived: Optional[bool] = None,
    status: str = "",
    organization: str = "",
    location: str = "",
    category: str = "",
    has_documents: Optional[bool] = None,
    scope: Optional[tuple[str, list[Any]]] = None,
) -> tuple[list[str], list[Any]]:
    # Tenders of a portal that has been deleted are left out, so a removed
    # portal disappears from the apps even if some rows were left behind.
    conditions: list[str] = ["t.website_id IN (SELECT id FROM websites)"]
    params: list[Any] = []
    if scope is not None:
        # The sections this user may see (_tender_scope).
        conditions.append(scope[0])
        params.extend(scope[1])
    if query:
        pattern = f"%{query.strip().lower()}%"
        fields = (
            "t.tender_id", "t.title", "t.work_description", "t.org_chain",
            "t.location", "t.tender_category", "t.status",
        )
        conditions.append("(" + " OR ".join(f"LOWER(COALESCE({field},'')) LIKE ?" for field in fields) + ")")
        params.extend([pattern] * len(fields))
    if website_id is not None:
        conditions.append("t.website_id=?")
        params.append(website_id)
    if archived is not None:
        conditions.append("COALESCE(t.is_archived,0)=?")
        params.append(int(archived))
    if status:
        conditions.append("LOWER(COALESCE(t.status,''))=?")
        params.append(status.strip().lower())
    for column, value in (
        ("t.org_chain", organization),
        ("t.location", location),
        ("t.tender_category", category),
    ):
        if value:
            conditions.append(f"LOWER(COALESCE({column},'')) LIKE ?")
            params.append(f"%{value.strip().lower()}%")
    if has_documents is not None:
        exists = (
            "EXISTS (SELECT 1 FROM downloaded_files d WHERE d.tender_db_id=t.id OR "
            "(d.tender_db_id IS NULL AND UPPER(TRIM(COALESCE(d.tender_id,'')))="
            "UPPER(TRIM(COALESCE(t.tender_id,'')))))"
        )
        conditions.append(exists if has_documents else f"NOT {exists}")
    return conditions, params


def _tender_scope(conn: Any, user_id: Optional[int], alias: str = "t") -> Optional[tuple[str, list[Any]]]:
    """SQL (and params) limiting tenders to the sections this user may see:
    active / archived tenders, their (or their org's) bookmarked tenders and
    organisations, and the tenders of their projects. None = no limit, which
    is every user with both tender sections on (every existing account)."""
    if user_id is None:
        return None
    account = org_access.get_account(conn, user_id)
    perms = account["permissions"]
    if perms["active"] and perms["archived"]:
        return None
    blob, _updated_at, _found = org_access.effective_blob(conn, user_id, account)
    archived = f"COALESCE({alias}.is_archived,0)"
    parts: list[str] = []
    params: list[Any] = []
    if perms["active"]:
        parts.append(f"{archived}=0")
    if perms["archived"]:
        parts.append(f"{archived}=1")
    keys: set[str] = set()
    if perms["bookmarks"]:
        keys |= _blob_bookmark_tender_ids(conn, blob)
        names = sorted({str(n).strip() for n in (blob.get("bookmarkedOrgs") or []) if str(n).strip()})
        if names:
            parts.append(f"{alias}.org_chain IN ({','.join('?' for _ in names)})")
            params.extend(names)
    if perms["projects"]:
        keys |= {
            _canon_tender_id(p.get("source_tender_id"))
            for p in (blob.get("projects") or []) if isinstance(p, dict)
        } - {""}
    if keys:
        key_sql = f"COALESCE(NULLIF({alias}.normalized_tender_id,''), UPPER(TRIM({alias}.tender_id)))"
        parts.append(f"{key_sql} IN ({','.join('?' for _ in keys)})")
        params.extend(sorted(keys))
    if not parts:
        return "1=0", []
    return "(" + " OR ".join(parts) + ")", params


def _require_tender_access(conn: Any, user_id: int, tender_db_id: int) -> None:
    """404 (as for a missing tender) when the tender is outside the user's sections."""
    scope = _tender_scope(conn, user_id)
    if scope is None:
        return
    if not conn.execute(
        f"SELECT 1 FROM tenders t WHERE t.id=? AND {scope[0]}", (tender_db_id, *scope[1])
    ).fetchone():
        raise HTTPException(404, "Tender not found.")


def _require_section(user_id: int, section: str) -> None:
    with _get_db() as conn:
        allowed = org_access.get_account(conn, user_id)["permissions"].get(section, True)
    if not allowed:
        raise HTTPException(403, detail={
            "reason": "section_forbidden", "section": section,
            "message": "Your account doesn't have access to this section.",
        })


def _list_tender_payload(
    *,
    page: int,
    page_size: int,
    sort_by: str,
    sort_order: str,
    base_url: str = "",
    user_id: Optional[int] = None,
    **filters: Any,
) -> dict[str, Any]:
    sort_column = TENDER_SORT_COLUMNS[sort_by]
    direction = "DESC" if sort_order == "desc" else "ASC"
    offset = (page - 1) * page_size
    with _get_db() as conn:
        conditions, params = _tender_filters(**filters, scope=_tender_scope(conn, user_id))
        where_sql = f" WHERE {' AND '.join(conditions)}" if conditions else ""
        total = int(conn.execute(f"SELECT COUNT(*) FROM tenders t{where_sql}", params).fetchone()[0])
        rows = conn.execute(
            f"{_tender_select()}{where_sql} "
            f"ORDER BY {sort_column} {direction},t.id {direction} LIMIT ? OFFSET ?",
            [*params, page_size, offset],
        ).fetchall()
    return {"items": [_public_tender(row, base_url) for row in rows], **_page_meta(page, page_size, total)}


class DownloadRequest(BaseModel):
    document_id: int = Field(gt=0)


@router.get("/health", dependencies=[Depends(require_client_user)])
def client_health() -> dict[str, Any]:
    try:
        with _get_db() as conn:
            conn.execute("SELECT 1").fetchone()
    except Exception:
        raise HTTPException(503, "Client data service is unavailable.")
    return {"status": "ok", "version": core.APP_VERSION, "read_only": True}


@router.get("/tenders", dependencies=[Depends(require_client_user)])
def client_tenders(
    request: Request,
    q: str = Query("", max_length=200),
    website_id: Optional[int] = Query(None, gt=0),
    archived: Optional[bool] = None,
    status: str = Query("", max_length=100),
    organization: str = Query("", max_length=200),
    location: str = Query("", max_length=200),
    category: str = Query("", max_length=200),
    has_documents: Optional[bool] = None,
    sort_by: Literal[tuple(TENDER_SORT_COLUMNS)] = "closing_date",
    sort_order: Literal["asc", "desc"] = "asc",
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    return _list_tender_payload(
        query=q, website_id=website_id, archived=archived, status=status,
        organization=organization, location=location, category=category,
        has_documents=has_documents, sort_by=sort_by, sort_order=sort_order,
        page=page, page_size=page_size, base_url=_public_base_url(request), user_id=user_id,
    )


@router.get("/search", dependencies=[Depends(require_client_user)])
def client_search(
    request: Request,
    q: str = Query(..., min_length=1, max_length=200),
    website_id: Optional[int] = Query(None, gt=0),
    archived: Optional[bool] = None,
    sort_by: Literal[tuple(TENDER_SORT_COLUMNS)] = "closing_date",
    sort_order: Literal["asc", "desc"] = "asc",
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    return _list_tender_payload(
        query=q, website_id=website_id, archived=archived, sort_by=sort_by,
        sort_order=sort_order, page=page, page_size=page_size, base_url=_public_base_url(request),
        user_id=user_id,
    )


def _public_organization(
    row: Any, covered_org_ids: Optional[set[int]] = None, full_websites: Optional[set[int]] = None,
) -> dict[str, Any]:
    data = dict(row)
    org_id = int(data["id"])
    website_id = int(data["website_id"])
    has_saved_job = bool(
        (full_websites and website_id in full_websites)
        or (covered_org_ids and org_id in covered_org_ids)
    )
    return {
        "id": org_id,
        "website_id": website_id,
        "website_name": str(data.get("website_name") or ""),
        "name": str(data.get("name") or ""),
        "tenders_url": str(data.get("tenders_url") or ""),
        "tender_count": int(data.get("tender_count") or 0),
        "scrape_enabled": bool(data.get("scrape_enabled")),
        "has_saved_job": has_saved_job,
        "last_scraped_at": float(data.get("last_scraped_at") or 0),
        # Was this org found on the site's own organisation-list page during
        # the most recent scrape of its website (fetch_organisations_logic)?
        # Distinct from scrape_enabled (an admin's per-org auto-scrape
        # toggle) — this reflects whether the org still exists on the site
        # at all. Intentionally still returned when false: clients need the
        # row present to grey it out / sink it to the bottom of a bookmarked
        # list rather than have it silently vanish.
        "is_available": bool(data.get("is_available", 1)),
    }


def _org_scrape_coverage(conn: Any, website_ids: list[int]) -> tuple[set[int], set[int]]:
    """(org ids specifically targeted, website ids where every org is
    covered) by an active saved_custom_jobs scrape row — admin-configured or
    the auto-managed 24h "Bookmarks · <site>" job (see
    _reconcile_bookmark_jobs), either counts. Mirrors _saved_job_coverage's
    rule (same file): an all_organizations=1 job only actually fetches each
    org's individual tenders (for every org on the site) when it ALSO has
    explicit org_ids selected — see _enqueue_saved_custom_job in
    api_server.py; without org_ids it just refreshes the org list/counts, so
    it doesn't count as coverage for anyone. Used to hide "Request tenders"
    for orgs that are already kept fresh."""
    website_ids = sorted({int(w) for w in website_ids if w is not None})
    if not website_ids:
        return set(), set()
    placeholders = ",".join("?" for _ in website_ids)
    rows = conn.execute(
        f"SELECT website_id,org_ids_json,all_organizations FROM saved_custom_jobs "
        f"WHERE job_type='scrape' AND website_id IN ({placeholders})",
        website_ids,
    ).fetchall()
    org_ids: set[int] = set()
    full_websites: set[int] = set()
    for row in rows:
        data = dict(row)
        website_id = int(data["website_id"])
        row_org_ids = _json_id_list(data.get("org_ids_json"))
        if bool(data.get("all_organizations")) and row_org_ids:
            full_websites.add(website_id)
        org_ids.update(row_org_ids)
    return org_ids, full_websites


def _org_tender_counts(conn, website_ids, archived: bool) -> dict[tuple[int, str], int]:
    """Tenders actually in the database per (website_id, lower-cased org name),
    active or archived. organizations.tender_count is the portal's own figure
    from its org-list page, so it can't show tenders missing here. Orgs match
    on the tender's org chain, as the tender list's organization filter does."""
    website_ids = sorted({int(w) for w in website_ids if w is not None})
    if not website_ids:
        return {}
    placeholders = ",".join("?" for _ in website_ids)
    rows = conn.execute(
        "SELECT website_id,LOWER(TRIM(COALESCE(org_chain,''))) AS org_key,COUNT(*) AS n "
        f"FROM tenders WHERE website_id IN ({placeholders}) AND COALESCE(is_archived,0)=? "
        "GROUP BY website_id,LOWER(TRIM(COALESCE(org_chain,'')))",
        [*website_ids, 1 if archived else 0],
    ).fetchall()
    return {(int(r[0]), str(r[1])): int(r[2]) for r in rows}


def _organization_scope(conn: Any, user_id: int, archived: bool) -> Optional[tuple[str, list[Any]]]:
    """The organisations list is part of the active (or, with archived=true,
    the archived) tenders section. Without it, a user only sees their
    bookmarked organisations (with the bookmarks section) or none."""
    account = org_access.get_account(conn, user_id)
    perms = account["permissions"]
    if perms["archived" if archived else "active"]:
        return None
    if perms["bookmarks"]:
        blob, _updated_at, _found = org_access.effective_blob(conn, user_id, account)
        names = sorted({str(n).strip() for n in (blob.get("bookmarkedOrgs") or []) if str(n).strip()})
        if names:
            return f"o.name IN ({','.join('?' for _ in names)})", names
    return "1=0", []


@router.get("/organizations", dependencies=[Depends(require_client_user)])
def client_organizations(
    q: str = Query("", max_length=200),
    website_id: Optional[int] = Query(None, gt=0),
    archived: Optional[bool] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    conditions: list[str] = ["o.website_id IN (SELECT id FROM websites)"]
    params: list[Any] = []
    with _get_db() as conn:
        org_scope = _organization_scope(conn, user_id, bool(archived))
    if org_scope is not None:
        conditions.append(org_scope[0])
        params.extend(org_scope[1])
    if archived:
        # Only organisations that have archived tenders (matched on the tender's
        # org chain, as the tender list's organization filter does).
        conditions.append(
            "EXISTS (SELECT 1 FROM tenders t WHERE t.website_id=o.website_id "
            "AND COALESCE(t.is_archived,0)=1 "
            "AND LOWER(TRIM(COALESCE(t.org_chain,'')))=LOWER(TRIM(COALESCE(o.name,''))))"
        )
    if q:
        conditions.append("LOWER(COALESCE(o.name,'')) LIKE ?")
        params.append(f"%{q.strip().lower()}%")
    if website_id is not None:
        conditions.append("o.website_id=?")
        params.append(website_id)
    where_sql = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    select_sql = (
        "SELECT o.id,o.website_id,COALESCE(w.name,'') AS website_name,"
        "COALESCE(o.name,'') AS name,COALESCE(o.tenders_url,'') AS tenders_url,"
        "COALESCE(o.scrape_enabled,0) AS scrape_enabled,"
        "COALESCE(o.last_scraped_at,0) AS last_scraped_at,"
        "COALESCE(o.is_available,1) AS is_available "
        "FROM organizations o LEFT JOIN websites w ON w.id=o.website_id"
    )
    offset = (page - 1) * page_size
    with _get_db() as conn:
        total = int(conn.execute(f"SELECT COUNT(*) FROM organizations o{where_sql}", params).fetchone()[0])
        rows = conn.execute(
            f"{select_sql}{where_sql} ORDER BY o.name ASC,o.id ASC LIMIT ? OFFSET ?",
            [*params, page_size, offset],
        ).fetchall()
        covered_org_ids, full_websites = _org_scrape_coverage(conn, [dict(r)["website_id"] for r in rows])
        counts = _org_tender_counts(conn, [dict(r)["website_id"] for r in rows], bool(archived))
    items = []
    for row in rows:
        data = dict(row)
        data["tender_count"] = counts.get(
            (int(data["website_id"]), str(data.get("name") or "").strip().lower()), 0
        )
        items.append(_public_organization(data, covered_org_ids, full_websites))
    return {
        "items": items,
        **_page_meta(page, page_size, total),
    }


def _find_tender(conn: Any, tender_db_id: int) -> Any:
    row = conn.execute(f"{_tender_select()} WHERE t.id=?", (tender_db_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Tender not found.")
    return row


class ResolveTendersRequest(BaseModel):
    tender_ids: list[str] = Field(default_factory=list, max_length=2000)


@router.post("/tenders/resolve", dependencies=[Depends(require_client_user)])
def client_resolve_tenders(
    body: ResolveTendersRequest, request: Request, user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    """Tender id (the portal's, the one identity the apps store) -> the current
    tender, including its row `id` handle for the other /tenders/{id} routes.
    Ids not in the database right now (or outside the user's sections) are
    simply absent from the result."""
    keys = sorted(_coerce_tender_id_set(body.tender_ids))
    if not keys:
        return {"tenders": {}}
    base_url = _public_base_url(request)
    placeholders = ",".join("?" for _ in keys)
    with _get_db() as conn:
        scope = _tender_scope(conn, user_id)
        scope_sql, scope_params = (f" AND {scope[0]}", scope[1]) if scope else ("", [])
        rows = conn.execute(
            f"{_tender_select()} WHERE {_T_TENDER_KEY_SQL} IN ({placeholders}){scope_sql}",
            (*keys, *scope_params),
        ).fetchall()
        out = {}
        for row in rows:
            tender = _public_tender(row, base_url)
            out[_canon_tender_id(tender.get("tender_id"))] = tender
    return {"tenders": out}


@router.get("/tenders/{tender_db_id}", dependencies=[Depends(require_client_user)])
def client_tender_detail(
    tender_db_id: int, request: Request, user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    with _get_db() as conn:
        tender = _find_tender(conn, tender_db_id)
        _require_tender_access(conn, user_id, tender_db_id)
        return _public_tender(tender, _public_base_url(request))


def _document_condition() -> str:
    return (
        "(d.tender_db_id=? OR (d.tender_db_id IS NULL AND "
        "UPPER(TRIM(COALESCE(d.tender_id,'')))=?))"
    )


def _document_downloadable(data: dict[str, Any]) -> bool:
    reference = str(data.get("local_path") or "").strip()
    return bool(data.get("drive_file_id") or reference)


def _public_document(row: Any) -> dict[str, Any]:
    data = dict(row)
    return {
        "id": int(data["id"]),
        "name": str(data.get("file_name") or ""),
        "type": str(data.get("file_type") or "document"),
        "size_bytes": int(data.get("file_size_bytes") or 0),
        "downloaded_at": str(data.get("downloaded_at") or ""),
        "status": str(data.get("download_status") or "complete"),
        "downloadable": _document_downloadable(data),
    }


@router.get("/tenders/{tender_db_id}/documents", dependencies=[Depends(require_client_user)])
def client_tender_documents(
    tender_db_id: int,
    file_type: str = Query("", max_length=100),
    sort_by: Literal[tuple(DOCUMENT_SORT_COLUMNS)] = "downloaded_at",
    sort_order: Literal["asc", "desc"] = "desc",
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    direction = "DESC" if sort_order == "desc" else "ASC"
    offset = (page - 1) * page_size
    with _get_db() as conn:
        tender = _find_tender(conn, tender_db_id)
        _require_tender_access(conn, user_id, tender_db_id)
        canonical_id = str(dict(tender).get("tender_id") or "").strip().upper()
        condition = _document_condition()
        params: list[Any] = [tender_db_id, canonical_id]
        if file_type:
            condition += " AND LOWER(COALESCE(d.file_type,''))=?"
            params.append(file_type.strip().lower())
        total = int(conn.execute(f"SELECT COUNT(*) FROM downloaded_files d WHERE {condition}", params).fetchone()[0])
        rows = conn.execute(
            "SELECT d.id,d.file_name,d.file_type,d.file_size_bytes,d.downloaded_at,"
            "d.download_status,d.local_path,d.drive_file_id FROM downloaded_files d "
            f"WHERE {condition} ORDER BY {DOCUMENT_SORT_COLUMNS[sort_by]} {direction},d.id {direction} "
            "LIMIT ? OFFSET ?",
            [*params, page_size, offset],
        ).fetchall()
    return {"items": [_public_document(row) for row in rows], **_page_meta(page, page_size, total)}


def _document_row(conn: Any, tender_db_id: int, document_id: int) -> Any:
    tender = _find_tender(conn, tender_db_id)
    canonical_id = str(dict(tender).get("tender_id") or "").strip().upper()
    row = conn.execute(
        "SELECT d.id,d.file_name,d.file_type,d.file_size_bytes,d.downloaded_at,"
        "d.download_status,d.local_path,d.drive_file_id FROM downloaded_files d "
        f"WHERE d.id=? AND {_document_condition()}",
        (document_id, tender_db_id, canonical_id),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Document not found for this tender.")
    return row


def _download_reference(data: dict[str, Any]) -> tuple[str, str]:
    drive_id = str(data.get("drive_file_id") or "").strip()
    local_path = str(data.get("local_path") or "").strip()
    if not drive_id and local_path.startswith("gdrive://"):
        drive_id = local_path[len("gdrive://"):].split("/", 1)[0]
    if drive_id:
        return "drive", drive_id
    if not local_path:
        raise HTTPException(404, "The document file is not available.")
    root = Path(core.BASE_DOWNLOAD_DIRECTORY).resolve()
    raw = Path(local_path)
    target = raw.resolve() if raw.is_absolute() else (root / raw).resolve()
    if target != root and root not in target.parents:
        raise HTTPException(404, "The document file is not available.")
    if not target.is_file():
        raise HTTPException(404, "The document file is not available.")
    return "local", str(target)


def _document_token_subject(document_id: int, kind: str, reference: str) -> str:
    # The signed payload is URL-safe base64 rather than encryption. Hash the
    # storage reference so decoding a token cannot reveal a Drive ID/local path.
    digest = hashlib.sha256(str(reference).encode("utf-8")).hexdigest()
    return f"client-document:{document_id}:{kind}:{digest}"


@router.post("/tenders/{tender_db_id}/download-request", dependencies=[Depends(require_client_user)])
def client_download_request(
    tender_db_id: int, body: DownloadRequest, request: Request,
    user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    with _get_db() as conn:
        data = dict(_document_row(conn, tender_db_id, body.document_id))
        _require_tender_access(conn, user_id, tender_db_id)
    kind, reference = _download_reference(data)
    ttl_minutes = core.setting_int("signed_url_ttl_min", 15, minimum=1, maximum=60)
    subject = _document_token_subject(body.document_id, kind, reference)
    token, expires = security.create_download_token(subject, ttl_minutes * 60)
    base_url = str(request.base_url).rstrip("/")
    return {
        "document_id": body.document_id,
        "url": f"{base_url}/client/documents/{body.document_id}/download?token={quote(token)}",
        "expires_at": datetime.fromtimestamp(expires, timezone.utc).isoformat(),
    }


class RequestDownloadResponse(BaseModel):
    job_id: str
    status: str
    # False when an identical in-flight job for this tender was reused
    # (the server dedupes per tender regardless of mode) instead of queued.
    created: bool = True
    mode: str = "full"


class RequestDownloadBody(BaseModel):
    # "full" (default) downloads everything not already stored, as the
    # first-ever download for a tender does. "update" is the cheap incremental
    # mode -- refreshes the portal's corrigendum/pre-bid counts over plain HTTP
    # and only starts a browser download if something new exists. "redownload"
    # is "full" with the skip-if-already-stored check disabled, for files that
    # were saved but are empty/corrupt. Any other value falls back to "full"
    # rather than erroring, so an old/mismatched client build never breaks
    # this call.
    mode: str = "full"


@router.post(
    "/tenders/{tender_db_id}/request-download",
    response_model=RequestDownloadResponse,
)
def client_request_tender_download(
    tender_db_id: int,
    body: RequestDownloadBody = RequestDownloadBody(),
    user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    # A tender may not have any downloaded_files rows yet, so there is nothing
    # for /download-request to sign. This kicks off the same scrape+download
    # job the admin console uses for a single tender (api_server._enqueue_job,
    # action "download_single_tender") and the client polls its status below.
    with _get_db() as conn:
        tender = _find_tender(conn, tender_db_id)
        _require_tender_access(conn, user_id, tender_db_id)
    # The download job itself refuses archived tenders, but only after being
    # queued and retried three times -- turning every such request into a
    # failed job. Refuse here instead so nothing is queued.
    if int(dict(tender).get("is_archived") or 0):
        raise HTTPException(409, "This tender is archived; its documents can no longer be fetched from the portal.")
    import api_server  # deferred: api_server imports this module at load time

    mode = body.mode if body.mode in {"update", "redownload"} else "full"
    result = api_server._enqueue_job(
        "download_single_tender",
        # user_id lets the job-completion handler push a real APNs
        # notification to whoever actually requested this (see _run_job in
        # api_server.py) -- only set when this call created the job itself;
        # a second client that joins an existing in-flight job via dedupe
        # just relies on its own client-side poll instead, same as before.
        {"tender_db_id": tender_db_id, "mode": mode, "source": "client", "requested_by_user_id": user_id},
    )
    created = bool(result.get("created", True))
    try:
        api_server._append_live_log(
            f"[client] user #{user_id} requested '{mode}' download for tender #{tender_db_id} -> "
            f"job {str(result['job_id'])[:8]} ({'queued new job' if created else 'joined existing in-flight job'})"
        )
    except Exception:
        pass
    return {
        "job_id": str(result["job_id"]),
        "status": str(result["status"]),
        "created": created,
        "mode": mode,
    }


@router.post(
    "/tenders/{tender_db_id}/fetch-status",
    response_model=RequestDownloadResponse,
)
def client_fetch_tender_status(
    tender_db_id: int,
    user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    # Same "fetch status" job the admin console runs for an archived tender: reads
    # the portal's Tender Stage and, for result stages, downloads the result files
    # (file_type "result"). Progress is polled with /download-status like a
    # download job; the app then re-reads the tender and its documents.
    with _get_db() as conn:
        _find_tender(conn, tender_db_id)
        _require_tender_access(conn, user_id, tender_db_id)
    import api_server  # deferred: api_server imports this module at load time

    result = api_server._enqueue_job(
        "fetch_tender_status_single",
        # requested_by_user_id routes a CAPTCHA this job raises to the user's
        # own Captcha screen (see _create_and_wait_for_captcha).
        {"tender_db_id": tender_db_id, "source": "client", "requested_by_user_id": user_id},
    )
    created = bool(result.get("created", True))
    try:
        api_server._append_live_log(
            f"[client] user #{user_id} requested status fetch for tender #{tender_db_id} -> "
            f"job {str(result['job_id'])[:8]} ({'queued new job' if created else 'joined existing in-flight job'})"
        )
    except Exception:
        pass
    return {
        "job_id": str(result["job_id"]),
        "status": str(result["status"]),
        "created": created,
        "mode": "status",
    }


def _find_organization(conn: Any, org_id: int) -> Any:
    row = conn.execute(
        "SELECT id,website_id,COALESCE(last_scraped_at,0) AS last_scraped_at FROM organizations WHERE id=?",
        (org_id,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Organization not found.")
    return row


@router.post(
    "/organizations/{org_id}/request-tenders",
    dependencies=[Depends(require_client_user)],
    response_model=RequestDownloadResponse,
)
def client_request_org_tenders(org_id: int, user_id: int = Depends(require_client_user)) -> dict[str, Any]:
    _require_section(user_id, "active")
    # One-time manual scrape for an org whose tenders haven't been fetched
    # in the last 24h. Goes straight into background_jobs via _enqueue_job
    # (action "fetch_tenders_selected", same as the admin console's one-off
    # "fetch-selected" route) and never touches saved_custom_jobs, so it
    # can't accidentally create a recurring schedule. Coverage by a saved
    # job no longer blocks this — organizations.last_scraped_at is stamped
    # by the scraper itself only when an org's individual tenders were
    # actually fetched (app_core.py, never by a bare org-list/count refresh),
    # so a still-due org stays requestable even if a job already covers it.
    # This is a defense-in-depth backstop — the desktop client is expected
    # to decide this itself from the same field and not call this endpoint
    # at all while within the cooldown.
    with _get_db() as conn:
        org = dict(_find_organization(conn, org_id))
    last_scraped_at = float(org.get("last_scraped_at") or 0)
    if last_scraped_at and (time.time() - last_scraped_at) < 86400:
        # Structured detail (not just a string) so a client whose own local
        # cache was stale can rebuild its friendly cooldown message from this
        # live timestamp instead of showing this raw text to the user.
        raise HTTPException(429, detail={
            "message": "This organization's tenders were fetched less than 24 hours ago.",
            "last_scraped_at": last_scraped_at,
        })
    import api_server  # deferred: api_server imports this module at load time

    result = api_server._enqueue_job(
        "fetch_tenders_selected",
        {"website_id": org["website_id"], "org_ids": [org_id], "download_after": False, "source": "custom"},
    )
    return {"job_id": str(result["job_id"]), "status": str(result["status"])}


@router.get("/organizations/{org_id}/request-tenders-status", dependencies=[Depends(require_client_user)])
def client_org_request_status(org_id: int, job_id: str = Query(..., min_length=1)) -> dict[str, Any]:
    with _get_db() as conn:
        row = conn.execute(
            "SELECT status,error,payload_json FROM background_jobs WHERE id=?", (job_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Request job not found.")
    data = dict(row)
    try:
        payload = json.loads(data.get("payload_json") or "{}")
    except (TypeError, ValueError):
        payload = {}
    if org_id not in (payload.get("org_ids") or []):
        raise HTTPException(404, "Request job not found.")
    status = str(data.get("status") or "")
    return {
        "job_id": job_id,
        "status": status,
        "error": str(data.get("error") or "") if status == "failed" else "",
    }


@router.get("/tenders/{tender_db_id}/download-status", dependencies=[Depends(require_client_user)])
def client_tender_download_status(
    tender_db_id: int, job_id: str = Query(..., min_length=1),
    user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    with _get_db() as conn:
        _require_tender_access(conn, user_id, tender_db_id)
        row = conn.execute(
            "SELECT status,error,payload_json FROM background_jobs WHERE id=?", (job_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Download job not found.")
    data = dict(row)
    try:
        payload = json.loads(data.get("payload_json") or "{}")
    except (TypeError, ValueError):
        payload = {}
    if int(payload.get("tender_db_id") or 0) != tender_db_id:
        raise HTTPException(404, "Download job not found.")
    status = str(data.get("status") or "")
    return {
        "job_id": job_id,
        "status": status,
        "error": str(data.get("error") or "") if status == "failed" else "",
    }


@download_router.get("/documents/{document_id}/download", include_in_schema=False)
def client_document_download(document_id: int, token: str = Query(..., min_length=20)):
    with _get_db() as conn:
        row = conn.execute(
            "SELECT id,file_name,local_path,drive_file_id FROM downloaded_files WHERE id=?",
            (document_id,),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Document not found.")
    data = dict(row)
    kind, reference = _download_reference(data)
    if not security.verify_download_token(token, _document_token_subject(document_id, kind, reference)):
        raise HTTPException(401, "Invalid or expired download token.")
    return _stored_file_response(kind, reference, str(data.get("file_name") or f"document-{document_id}"))


def _stored_file_response(kind: str, reference: str, file_name: str):
    """Stream a stored file (Drive or local) as an attachment download."""
    disposition = f"attachment; filename*=UTF-8''{quote(file_name)}"
    if kind == "drive":
        try:
            metadata, response = admin_providers.drive_storage.open_download(reference)
        except (RuntimeError, ValueError) as exc:
            raise HTTPException(404, str(exc))
        media_type = str(metadata.get("mimeType") or "application/octet-stream")
        return StreamingResponse(
            admin_providers.drive_storage.iter_download_response(response),
            media_type=media_type,
            headers={"Content-Disposition": disposition, "Cache-Control": "private, no-store"},
        )
    return FileResponse(
        reference,
        filename=file_name,
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/websites", dependencies=[Depends(require_client_user)])
def client_websites() -> list[dict[str, Any]]:
    """Every portal on the server, straight from the websites table, so the
    apps show a newly added portal at once (even with nothing scraped yet)
    and drop a deleted one, instead of inferring portals from fetched rows."""
    with _get_db() as conn:
        rows = conn.execute(
            "SELECT id, COALESCE(name,''), COALESCE(url,'') FROM websites ORDER BY LOWER(COALESCE(name,'')), id"
        ).fetchall()
    return [{"id": int(r[0]), "name": str(r[1]), "url": str(r[2])} for r in rows]


@router.get("/stats", dependencies=[Depends(require_client_user)])
def client_stats(user_id: int = Depends(require_client_user)) -> dict[str, Any]:
    with _get_db() as conn:
        # Counts only cover the tenders the user's sections allow.
        scope = _tender_scope(conn, user_id)
        scope_where, scope_and, scope_params = (
            (f" WHERE {scope[0]}", f" AND {scope[0]}", list(scope[1])) if scope else ("", "", [])
        )
        row = conn.execute(
            "SELECT COUNT(*) AS total,"
            "SUM(CASE WHEN COALESCE(is_archived,0)=0 THEN 1 ELSE 0 END) AS active,"
            "SUM(CASE WHEN COALESCE(is_archived,0)=1 THEN 1 ELSE 0 END) AS archived,"
            f"COUNT(DISTINCT website_id) AS websites FROM tenders t{scope_where}",
            scope_params,
        ).fetchone()
        if scope:
            document_count = int(conn.execute(
                f"SELECT COUNT(*) FROM downloaded_files d WHERE d.tender_db_id IN "
                f"(SELECT t.id FROM tenders t WHERE {scope[0]})",
                scope_params,
            ).fetchone()[0])
        else:
            document_count = int(conn.execute("SELECT COUNT(*) FROM downloaded_files").fetchone()[0])
        categories = conn.execute(
            "SELECT COALESCE(tender_category,'') AS category,COUNT(*) AS count FROM tenders t "
            f"WHERE TRIM(COALESCE(tender_category,''))!=''{scope_and} GROUP BY tender_category "
            "ORDER BY count DESC,tender_category ASC LIMIT 10",
            scope_params,
        ).fetchall()
    data = dict(row)
    return {
        "total_tenders": int(data.get("total") or 0),
        "active_tenders": int(data.get("active") or 0),
        "archived_tenders": int(data.get("archived") or 0),
        "websites": int(data.get("websites") or 0),
        "documents": document_count,
        "top_categories": [
            {"category": str(item["category"]), "count": int(item["count"])} for item in categories
        ],
    }


# ── accounts & organisations ───────────────────────────────────────────
# Every account is an individual until it creates or joins an organisation
# (org_access.py). An org's admin manages its members from these routes; the
# server operator has the same controls under /admin/orgs (api_server.py).

class CreateOrgRequest(BaseModel):
    name: str = Field(min_length=1, max_length=org_access.MAX_ORG_NAME)


class JoinOrgRequest(BaseModel):
    join_code: str = Field(min_length=4, max_length=32)
    note: str = Field("", max_length=500)


class SectionPermissions(BaseModel):
    # Omitted sections keep their current setting.
    active: Optional[bool] = None
    archived: Optional[bool] = None
    bookmarks: Optional[bool] = None
    projects: Optional[bool] = None
    portal_search: Optional[bool] = None


class ApproveJoinRequest(BaseModel):
    # Sections for the new member; omitted = the defaults (portal_search off).
    permissions: Optional[SectionPermissions] = None


class MemberRoleRequest(BaseModel):
    role: Literal["admin", "member"]


class DelinkRequest(BaseModel):
    # True: keep the org's bookmarked tenders/organisations in their own
    # account (projects, checklists and templates stay with the org).
    # False: their account is wiped completely.
    retain: bool


JOIN_DISCARD_WARNING = (
    "When an admin approves this request, the projects, bookmarks and checklists "
    "now in your account are discarded and you use the organisation's data instead."
)


def _org_op(fn) -> Any:
    """Run an org_access operation on one connection, commit it, and turn its
    validation errors into HTTP errors."""
    with _get_db() as conn:
        try:
            result = fn(conn)
        except org_access.OrgError as exc:
            raise _org_error(exc)
        conn.commit()
    return result


def _admin_org_id(conn: Any, user_id: int) -> int:
    account = org_access.get_account(conn, user_id)
    if account["org_id"] is None or account["role"] != "admin":
        raise org_access.OrgError(403, "Only an organisation admin can do this.")
    return int(account["org_id"])


def _permission_changes(body: Optional[SectionPermissions]) -> Optional[dict[str, Any]]:
    return body.model_dump(exclude_none=True) if body is not None else None


@router.get("/me")
def client_me(user_id: int = Depends(require_client_user)) -> dict[str, Any]:
    """The signed-in account: type (individual / organisation), org and role,
    and which sections the apps should show."""
    with _get_db() as conn:
        row = conn.execute(
            "SELECT email, display_name FROM client_users WHERE id=?", (user_id,)
        ).fetchone()
        account = org_access.public_account(conn, org_access.get_account(conn, user_id))
    return {
        "user_id": user_id,
        "email": str(row[0] or "") if row else "",
        "display_name": str(row[1] or "") if row else "",
        **account,
    }


@router.post("/org")
def client_create_org(body: CreateOrgRequest, user_id: int = Depends(require_client_user)) -> dict[str, Any]:
    """An individual creates an organisation and becomes its admin; their
    current data becomes the organisation's."""
    return _org_op(lambda conn: org_access.org_detail(conn, org_access.create_org(conn, user_id, body.name)))


@router.post("/org/join-requests")
def client_request_join(body: JoinOrgRequest, user_id: int = Depends(require_client_user)) -> dict[str, Any]:
    request = _org_op(lambda conn: org_access.request_join(conn, user_id, body.join_code, body.note))
    return {"request": request, "warning": JOIN_DISCARD_WARNING}


@router.get("/org/join-requests/mine")
def client_my_join_request(user_id: int = Depends(require_client_user)) -> dict[str, Any]:
    with _get_db() as conn:
        org_access.ensure_schema(conn)
        return {"request": org_access.pending_request_for_user(conn, user_id)}


@router.delete("/org/join-requests/mine")
def client_cancel_join_request(user_id: int = Depends(require_client_user)) -> dict[str, Any]:
    _org_op(lambda conn: org_access.cancel_request(conn, user_id))
    return {"ok": True}


@router.get("/org")
def client_org(user_id: int = Depends(require_client_user)) -> dict[str, Any]:
    """Org admin: the organisation, its members and pending join requests."""
    return _org_op(lambda conn: org_access.org_detail(conn, _admin_org_id(conn, user_id)))


@router.put("/org")
def client_rename_org(body: CreateOrgRequest, user_id: int = Depends(require_client_user)) -> dict[str, Any]:
    def run(conn):
        org_id = _admin_org_id(conn, user_id)
        org_access.rename_org(conn, org_id, body.name)
        return org_access.org_detail(conn, org_id)
    return _org_op(run)


@router.post("/org/join-code/regenerate")
def client_regenerate_join_code(user_id: int = Depends(require_client_user)) -> dict[str, Any]:
    code = _org_op(lambda conn: org_access.regenerate_join_code(conn, _admin_org_id(conn, user_id)))
    return {"join_code": code}


@router.get("/org/join-requests")
def client_org_join_requests(user_id: int = Depends(require_client_user)) -> dict[str, Any]:
    items = _org_op(lambda conn: org_access.pending_requests_for_org(conn, _admin_org_id(conn, user_id)))
    return {"items": items}


@router.post("/org/join-requests/{request_id}/approve")
def client_approve_join_request(
    request_id: int, body: ApproveJoinRequest = ApproveJoinRequest(),
    user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    request = _org_op(lambda conn: org_access.decide_request(
        conn, _admin_org_id(conn, user_id), request_id, True, f"user:{user_id}",
        _permission_changes(body.permissions),
    ))
    return {"request": request}


@router.post("/org/join-requests/{request_id}/reject")
def client_reject_join_request(request_id: int, user_id: int = Depends(require_client_user)) -> dict[str, Any]:
    request = _org_op(lambda conn: org_access.decide_request(
        conn, _admin_org_id(conn, user_id), request_id, False, f"user:{user_id}",
    ))
    return {"request": request}


@router.put("/org/members/{member_id}/permissions")
def client_set_member_permissions(
    member_id: int, body: SectionPermissions, user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    perms = _org_op(lambda conn: org_access.set_permissions(
        conn, member_id, _permission_changes(body), org_id=_admin_org_id(conn, user_id),
    ))
    return {"user_id": member_id, "permissions": perms}


@router.put("/org/members/{member_id}/role")
def client_set_member_role(
    member_id: int, body: MemberRoleRequest, user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    _org_op(lambda conn: org_access.set_role(conn, _admin_org_id(conn, user_id), member_id, body.role))
    return {"user_id": member_id, "role": body.role}


@router.post("/org/members/{member_id}/delink")
def client_delink_member(
    member_id: int, body: DelinkRequest, user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    _org_op(lambda conn: org_access.delink(conn, _admin_org_id(conn, user_id), member_id, body.retain))
    return {"ok": True, "user_id": member_id, "retained": body.retain}


# ── portal search ──────────────────────────────────────────────────────
# A user searches a tender ID on a NIC portal's Tender Status page. The server
# runs it as a background job (app_core.portal_search_tender_logic): a hit
# updates the tender for everyone (or adds it to the current list / archive by
# stage). Each user keeps their own search history (client_portal_searches).
# Needs the user's portal_search section (off by default).

PORTAL_SEARCH_HISTORY_LIMIT = 200


class PortalSearchRequest(BaseModel):
    website_id: int = Field(gt=0)
    tender_id: str = Field(min_length=3, max_length=120)


def _portal_search_portals(conn: Any) -> list[dict[str, Any]]:
    """NIC portals that have a Tender Status page."""
    return [
        {"id": int(r[0]), "name": str(r[1] or ""), "url": str(r[2] or "")}
        for r in conn.execute(
            "SELECT id, COALESCE(name,''), COALESCE(url,'') FROM websites "
            "WHERE TRIM(COALESCE(status_url,''))!='' AND COALESCE(portal_type,'nic')!='nprocure' "
            "ORDER BY LOWER(COALESCE(name,'')), id"
        ).fetchall()
    ]


def _finish_portal_search(conn: Any, row: dict[str, Any]) -> dict[str, Any]:
    """Copy a finished job's outcome into a pending history row."""
    if row["status"] != "pending" or not row.get("job_id"):
        return row
    job = conn.execute(
        "SELECT status, result_json, error FROM background_jobs WHERE id=?", (row["job_id"],)
    ).fetchone()
    if not job:
        update = {"status": "failed", "error": "The search is no longer available. Try again."}
    else:
        job_status = str(job[0] or "")
        row["job_status"] = job_status
        if job_status == "completed":
            try:
                result = json.loads(job[1] or "{}")
            except (TypeError, ValueError):
                result = {}
            result = result if isinstance(result, dict) else {}
            if result.get("found"):
                update = {
                    "status": "found",
                    "stage": str(result.get("stage") or ""),
                    "tender_db_id": result.get("tender_db_id"),
                    "created": 1 if result.get("created") else 0,
                    "is_archived": 1 if result.get("is_archived") else 0,
                }
            else:
                update = {"status": "not_found"}
        elif job_status in ("failed", "cancelled"):
            update = {"status": "failed", "error": str(job[2] or "The search did not finish.")}
        else:
            return row
    update["finished_at"] = time.time()
    columns = sorted(update)
    conn.execute(
        f"UPDATE client_portal_searches SET {', '.join(f'{c}=?' for c in columns)} WHERE id=?",
        (*[update[c] for c in columns], row["id"]),
    )
    conn.commit()
    row.update(update)
    return row


_PORTAL_SEARCH_SELECT = (
    "SELECT s.id, s.website_id, COALESCE(w.name,''), s.tender_id, s.job_id, s.status, s.stage, "
    "s.tender_db_id, s.created, s.is_archived, s.error, s.created_at, s.finished_at "
    "FROM client_portal_searches s LEFT JOIN websites w ON w.id=s.website_id"
)
_PORTAL_SEARCH_COLUMNS = (
    "id", "website_id", "website_name", "tender_id", "job_id", "status", "stage",
    "tender_db_id", "created", "is_archived", "error", "created_at", "finished_at",
)


def _public_portal_search(conn: Any, user_id: int, raw: Any, base_url: str) -> dict[str, Any]:
    row = _finish_portal_search(conn, dict(zip(_PORTAL_SEARCH_COLUMNS, _values(raw))))
    tender = None
    if row["status"] == "found" and row.get("tender_db_id"):
        try:
            found = _find_tender(conn, int(row["tender_db_id"]))
            _require_tender_access(conn, user_id, int(row["tender_db_id"]))
            tender = _public_tender(found, base_url)
        except HTTPException:
            tender = None  # deleted since, or outside the user's sections
    return {
        "id": int(row["id"]),
        "website_id": int(row["website_id"]),
        "website_name": str(row["website_name"] or ""),
        "tender_id": str(row["tender_id"] or ""),
        "job_id": row.get("job_id"),
        # pending (see job_status: queued / running) / found / not_found / failed
        "status": row["status"],
        "job_status": row.get("job_status") or ("completed" if row["status"] != "pending" else "queued"),
        "stage": row.get("stage") or None,
        "tender_db_id": int(row["tender_db_id"]) if row.get("tender_db_id") else None,
        # True: the search added the tender; False: it updated an existing one.
        "created": None if row.get("created") is None else bool(row["created"]),
        "is_archived": None if row.get("is_archived") is None else bool(row["is_archived"]),
        "error": row.get("error") or None,
        "created_at": float(row["created_at"] or 0),
        "finished_at": float(row["finished_at"]) if row.get("finished_at") else None,
        "tender": tender,
    }


@router.get("/portal-search/portals")
def client_portal_search_portals(user_id: int = Depends(require_client_user)) -> dict[str, Any]:
    with _get_db() as conn:
        allowed = org_access.get_account(conn, user_id)["permissions"].get("portal_search", False)
        return {"allowed": bool(allowed), "items": _portal_search_portals(conn) if allowed else []}


@router.post("/portal-search")
def client_portal_search(
    body: PortalSearchRequest, request: Request, user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    _require_section(user_id, "portal_search")
    tender_id = " ".join(body.tender_id.split())
    with _get_db() as conn:
        if body.website_id not in {p["id"] for p in _portal_search_portals(conn)}:
            raise HTTPException(400, "This portal can't be searched. Choose a NIC portal.")
    import api_server  # deferred: api_server imports this module at load time

    result = api_server._enqueue_job(
        "portal_search_tender",
        # requested_by_user_id routes a CAPTCHA to this user's Captcha screen.
        {"website_id": body.website_id, "tender_id": tender_id, "source": "client",
         "requested_by_user_id": user_id},
    )
    with _get_db() as conn:
        cur = conn.execute(
            "INSERT INTO client_portal_searches (user_id, website_id, tender_id, job_id, status, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (user_id, body.website_id, tender_id, str(result["job_id"]), "pending", time.time()),
        )
        search_id = int(cur.lastrowid)
        conn.commit()
        raw = conn.execute(f"{_PORTAL_SEARCH_SELECT} WHERE s.id=?", (search_id,)).fetchone()
        search = _public_portal_search(conn, user_id, raw, _public_base_url(request))
    try:
        api_server._append_live_log(
            f"[client] user #{user_id} portal search '{tender_id}' on website #{body.website_id} -> "
            f"job {str(result['job_id'])[:8]}"
        )
    except Exception:
        pass
    return {"search": search, "job_id": str(result["job_id"]), "created": bool(result.get("created", True))}


@router.get("/portal-search/history")
def client_portal_search_history(
    request: Request, limit: int = Query(50, ge=1, le=PORTAL_SEARCH_HISTORY_LIMIT),
    user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    """This user's searches, newest first. Pending ones are brought up to date."""
    _require_section(user_id, "portal_search")
    base_url = _public_base_url(request)
    with _get_db() as conn:
        rows = conn.execute(
            f"{_PORTAL_SEARCH_SELECT} WHERE s.user_id=? ORDER BY s.created_at DESC, s.id DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return {"items": [_public_portal_search(conn, user_id, r, base_url) for r in rows]}


@router.delete("/portal-search/history")
def client_clear_portal_search_history(user_id: int = Depends(require_client_user)) -> dict[str, Any]:
    with _get_db() as conn:
        org_access.ensure_schema(conn)
        conn.execute("DELETE FROM client_portal_searches WHERE user_id=?", (user_id,))
        conn.commit()
    return {"ok": True}


@router.delete("/portal-search/history/{search_id}")
def client_delete_portal_search(search_id: int, user_id: int = Depends(require_client_user)) -> dict[str, Any]:
    with _get_db() as conn:
        org_access.ensure_schema(conn)
        conn.execute("DELETE FROM client_portal_searches WHERE id=? AND user_id=?", (search_id, user_id))
        conn.commit()
    return {"ok": True}


@router.get("/portal-search/{search_id}")
def client_portal_search_status(
    search_id: int, request: Request, user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    """Poll one search (the user's own only)."""
    with _get_db() as conn:
        org_access.ensure_schema(conn)
        raw = conn.execute(
            f"{_PORTAL_SEARCH_SELECT} WHERE s.id=? AND s.user_id=?", (search_id, user_id)
        ).fetchone()
        if not raw:
            raise HTTPException(404, "Search not found.")
        return {"search": _public_portal_search(conn, user_id, raw, _public_base_url(request))}


# ── project checklist files ────────────────────────────────────────────
# A file attached to a checklist row is uploaded here and shared with every
# platform of the account (or member of the org) through the row's
# server_file field. One file per row: the first upload wins, a later one
# gets 409 with the kept file. See project_files.py.

_UPLOAD_CHUNK = 1024 * 1024


def _project_file_for_user(conn: Any, user_id: int, file_id: int) -> tuple[dict[str, Any], str]:
    """The active file, if it belongs to this user's (or their org's) projects."""
    account = org_access.get_account(conn, user_id)
    scope = project_files.scope_for(account)
    row = project_files.get_file(conn, file_id)
    if not row or row["scope"] != scope or row["status"] != "active":
        raise HTTPException(404, "File not found.")
    return row, scope


def _project_file_subject(file_id: int, kind: str, reference: str) -> str:
    digest = hashlib.sha256(str(reference).encode("utf-8")).hexdigest()
    return f"client-project-file:{file_id}:{kind}:{digest}"


def _slug(value: Any) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or "")).strip("._") or "project"


@router.post("/project-files")
def client_upload_project_file(
    checklist_item_id: str = Form(..., min_length=1, max_length=100),
    project_id: str = Form("", max_length=100),
    device: str = Form("", max_length=40),
    file: UploadFile = File(...),
    user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    """Attach a file to a checklist row. The row must already be on the
    server (push /client/sync first). 409 {reason: "file_exists", file} when
    the row already has a file: the first upload wins."""
    _require_section(user_id, "projects")
    now = time.time()
    file_name = project_files.safe_file_name(file.filename)
    with _get_db() as conn:
        account = org_access.get_account(conn, user_id)
        scope = project_files.scope_for(account)
        blob, _updated_at, _found = org_access.effective_blob(conn, user_id, account)
        item = project_files.find_checklist_row(blob, checklist_item_id)
        if item is None:
            raise HTTPException(404, detail={
                "reason": "row_not_found",
                "message": "This checklist row isn't on the server yet. Sync, then try again.",
            })
        item_key = str(item.get("id"))
        project_key = str(item.get("project_id") or project_id or "")
        project_files.drop_stale_reservation(conn, scope, item_key, now)
        try:
            cur = conn.execute(
                "INSERT INTO client_project_files (scope, project_id, checklist_item_id, file_name, "
                "mime_type, uploaded_by, uploaded_device, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                (scope, project_key, item_key, file_name, str(file.content_type or ""), user_id,
                 str(device or "").strip()[:40], "uploading", now),
            )
            file_id = int(cur.lastrowid)
            conn.commit()
        except core.sqlite3.IntegrityError:
            existing = project_files.active_file(conn, scope, item_key)
            if existing and existing["status"] == "active":
                raise HTTPException(409, detail={
                    "reason": "file_exists",
                    "message": "Another device attached a file to this row first.",
                    "file": project_files.public_file(existing),
                })
            raise HTTPException(409, detail={
                "reason": "upload_in_progress",
                "message": "A file for this row is being uploaded from another device. Try again shortly.",
            })

    # Store the bytes outside the DB connection (an upload can take a while).
    max_bytes = core.setting_int("max_file_size_mb", 80, minimum=1, maximum=2048) * 1024 * 1024
    folder = os.path.join(
        core.BASE_DOWNLOAD_DIRECTORY, "project-files", project_files.scope_slug(scope),
        _slug(project_key), str(file_id),
    )
    local_path = os.path.join(folder, file_name)
    digest = hashlib.sha256()
    size = 0
    try:
        os.makedirs(folder, exist_ok=True)
        with open(local_path, "wb") as out:
            while True:
                chunk = file.file.read(_UPLOAD_CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(413, f"The file is larger than {max_bytes // (1024 * 1024)} MB.")
                digest.update(chunk)
                out.write(chunk)
        if size == 0:
            raise HTTPException(400, "The file is empty.")
        stored = storage_runtime.active_document_storage().persist(
            local_path,
            f"{project_files.scope_slug(scope)}/{_slug(project_key)}/{file_id}",
            "project_file",
            project_files.FILE_PREFIX,
        )
        if stored.remove_local_copy:
            shutil.rmtree(folder, ignore_errors=True)
    except BaseException:
        # Free the row for the next attempt and drop any partial file.
        with _get_db() as conn:
            conn.execute("DELETE FROM client_project_files WHERE id=?", (file_id,))
            conn.commit()
        shutil.rmtree(folder, ignore_errors=True)
        raise

    done = time.time()
    with _get_db() as conn:
        conn.execute(
            "UPDATE client_project_files SET status='active', storage_ref=?, size_bytes=?, sha256=?, "
            "uploaded_at=? WHERE id=?",
            (stored.reference, size, digest.hexdigest(), done, file_id),
        )
        row = project_files.get_file(conn, file_id)
        project_files.set_server_file(conn, scope, item_key, project_files.server_file_entry(row), done)
        conn.commit()
    return {"file": project_files.public_file(row)}


@router.get("/project-files")
def client_project_files(
    project_id: Optional[str] = Query(None, max_length=100), user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    _require_section(user_id, "projects")
    with _get_db() as conn:
        scope = project_files.scope_for(org_access.get_account(conn, user_id))
        return {"items": [project_files.public_file(r) for r in project_files.list_files(conn, scope, project_id)]}


@router.post("/project-files/{file_id}/download-request")
def client_project_file_download_request(
    file_id: int, request: Request, user_id: int = Depends(require_client_user),
) -> dict[str, Any]:
    _require_section(user_id, "projects")
    with _get_db() as conn:
        row, _scope = _project_file_for_user(conn, user_id, file_id)
    kind, reference = _download_reference({"local_path": row["storage_ref"]})
    ttl_minutes = core.setting_int("signed_url_ttl_min", 15, minimum=1, maximum=60)
    token, expires = security.create_download_token(
        _project_file_subject(file_id, kind, reference), ttl_minutes * 60
    )
    base_url = str(request.base_url).rstrip("/")
    return {
        "file": project_files.public_file(row),
        "url": f"{base_url}/client/project-files/{file_id}/download?token={quote(token)}",
        "expires_at": datetime.fromtimestamp(expires, timezone.utc).isoformat(),
    }


@download_router.get("/project-files/{file_id}/download", include_in_schema=False)
def client_project_file_download(file_id: int, token: str = Query(..., min_length=20)):
    with _get_db() as conn:
        org_access.ensure_schema(conn)
        row = project_files.get_file(conn, file_id)
    if not row or row["status"] != "active":
        raise HTTPException(404, "File not found.")
    kind, reference = _download_reference({"local_path": row["storage_ref"]})
    if not security.verify_download_token(token, _project_file_subject(file_id, kind, reference)):
        raise HTTPException(401, "Invalid or expired download token.")
    return _stored_file_response(kind, reference, row["file_name"])


@router.delete("/project-files/{file_id}")
def client_delete_project_file(file_id: int, user_id: int = Depends(require_client_user)) -> dict[str, Any]:
    """Remove a row's file (to replace it: delete, then upload the new one)."""
    _require_section(user_id, "projects")
    now = time.time()
    with _get_db() as conn:
        row, scope = _project_file_for_user(conn, user_id, file_id)
        project_files.trash_file(conn, row, now)
        project_files.set_server_file(conn, scope, row["checklist_item_id"], None, now)
        conn.commit()
    return {"ok": True}
