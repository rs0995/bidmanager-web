"""Read-only, client-safe tender API.

The router in this module intentionally has no scraper, scheduler, configuration,
or write operations.  Its only POST endpoint creates a short-lived signed URL for
an existing downloaded file; it does not persist a request or start a download.
"""

from __future__ import annotations

import os
import hashlib
import json
import re
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Literal, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

import admin_providers
import app_core as core
import security


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


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


class AuthResponse(BaseModel):
    user_id: int
    email: str
    display_name: str
    token: str


@router.post("/auth/register", response_model=AuthResponse)
def client_register(body: RegisterRequest) -> dict[str, Any]:
    email = _normalize_email(body.email)
    display_name = body.display_name.strip()
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
        conn.commit()
    return {"user_id": user_id, "email": email, "display_name": display_name, "token": token}


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
        conn.commit()
    return {
        "user_id": user_id,
        "email": email,
        "display_name": str(data.get("display_name") or ""),
        "token": token,
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
    tender_users: dict[int, set[int]] = {}
    org_users_by_id: dict[int, set[int]] = {}
    org_users_by_name: dict[str, set[int]] = {}
    for row in conn.execute("SELECT user_id, data_json FROM client_user_sync").fetchall():
        user_id = int(row[0])
        try:
            blob = json.loads(row[1] or "{}")
        except (TypeError, ValueError):
            continue
        for tid in _coerce_id_set(blob.get("bookmarks")):
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
    with _get_db() as conn:
        row = conn.execute(
            "SELECT data_json, updated_at FROM client_user_sync WHERE user_id=?", (user_id,)
        ).fetchone()
    if not row:
        return {"data": {}, "updated_at": 0}
    data = dict(row)
    try:
        parsed = json.loads(data.get("data_json") or "{}")
    except (TypeError, ValueError):
        parsed = {}
    return {"data": parsed, "updated_at": float(data.get("updated_at") or 0)}


# Collections in the sync blob that must merge ADDITIVELY across devices — a
# client holding only a subset (fresh install, was offline, dev origin) must
# never be able to shrink them just by pushing. Removals travel as an explicit
# `removed` delta instead.
_SYNC_ID_SET_KEYS = ("bookmarks", "bookmarkedOrgIds")   # integer ids
_SYNC_NAME_SET_KEYS = ("bookmarkedOrgs",)               # strings
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


def _merge_sync_blob(
    stored: dict, incoming: dict, removed: dict, conn,
    base_updated_at: float | None = None, now: float | None = None,
) -> dict:
    # `now` MUST be the same value client_push_sync writes as `updated_at`, so
    # an item stamped by this push has `_v ts == updated_at` and a later push
    # whose `base_updated_at` equals that `updated_at` is NOT treated as stale.
    now = time.time() if now is None else float(now)
    merged = {k: v for k, v in (stored or {}).items()}
    removed = removed if isinstance(removed, dict) else {}
    incoming = incoming if isinstance(incoming, dict) else {}

    # Per-item "last changed" / "deleted at" clocks live inside the blob.
    versions: dict[str, dict] = {k: dict(v or {}) for k, v in (stored.get("_v") or {}).items()}
    deleted: dict[str, dict] = {k: dict(v or {}) for k, v in (stored.get("_deleted") or {}).items()}

    gated = base_updated_at is not None
    base = float(base_updated_at or 0)

    # Lost baseline: a client that declares base=0 while a real blob exists
    # can't be trusted to express deltas — the server's copy wins outright.
    meaningful = [k for k in (stored or {}) if not k.startswith("_")]
    if gated and base <= 0 and meaningful:
        return merged

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

    # Phantom cleanup: drop bookmarked tender / org ids that no longer exist here.
    for key, table in (("bookmarks", "tenders"), ("bookmarkedOrgIds", "organizations")):
        ids = _coerce_id_set(merged.get(key))
        if not ids:
            continue
        placeholders = ",".join("?" for _ in ids)
        real = {
            int(r[0])
            for r in conn.execute(
                f"SELECT id FROM {table} WHERE id IN ({placeholders})", tuple(ids)
            ).fetchall()
        }
        if real != ids:
            merged[key] = sorted(real)

    return merged


@router.put("/sync", dependencies=[Depends(require_client_user)])
def client_push_sync(body: SyncPushRequest, user_id: int = Depends(require_client_user)) -> dict[str, Any]:
    now = time.time()
    with _get_db() as conn:
        row = conn.execute(
            "SELECT data_json FROM client_user_sync WHERE user_id=?", (user_id,)
        ).fetchone()
        stored: dict[str, Any] = {}
        if row:
            try:
                parsed = json.loads(dict(row).get("data_json") or "{}")
                if isinstance(parsed, dict):
                    stored = parsed
            except (TypeError, ValueError):
                stored = {}
        incoming = body.data if isinstance(body.data, dict) else {}
        # Additive merge with per-item concurrency: bookmark sets union (minus
        # an explicit `removed` delta), projects/checklist merge by id,
        # everything else keeps a key the client omitted. When the client
        # sends `base_updated_at`, an incoming change to an item the server
        # changed after that timestamp is skipped (online beats offline).
        merged = _merge_sync_blob(
            stored, incoming, body.removed or {}, conn, body.base_updated_at, now
        )
        payload = json.dumps(merged, ensure_ascii=False)
        if len(payload.encode("utf-8")) > MAX_SYNC_PAYLOAD_BYTES:
            raise HTTPException(413, "Sync payload is too large.")
        conn.execute(
            "INSERT INTO client_user_sync (user_id, data_json, updated_at) VALUES (?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at",
            (user_id, payload, now),
        )
        conn.commit()
    _apply_bookmark_schedules(merged)
    return {"ok": True, "updated_at": now}


# tender_history snapshots (app_core.ScraperBackend.tender_snapshot) don't track
# `status` / pre-bid / corrigendum, so the change feed can only speak to fields
# that are in the snapshot. `status` and pre-bid/corrigendum stay covered by the
# clients' own local snapshot diff.
_ALERTABLE_CHANGED_FIELDS = {"closing_date"}


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
    tenders_changed: list[dict[str, Any]] = []
    new_by_org: dict[str, list[dict[str, Any]]] = {}
    with _get_db() as conn:
        row = conn.execute(
            "SELECT data_json FROM client_user_sync WHERE user_id=?", (user_id,)
        ).fetchone()
        try:
            blob = json.loads(row[0] or "{}") if row else {}
        except (TypeError, ValueError):
            blob = {}
        tender_ids = sorted(_coerce_id_set(blob.get("bookmarks")))
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
                titles = {
                    int(r[0]): str(r[1] or "")
                    for r in conn.execute(
                        f"SELECT id, title FROM tenders WHERE id IN ({ph2})", tuple(hit_ids)
                    ).fetchall()
                }
                for tid in hit_ids:
                    tenders_changed.append({
                        "id": tid,
                        "title": titles.get(tid, ""),
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

    return {"now": now, "tenders": tenders_changed, "new_by_org": new_by_org}


def _page_meta(page: int, page_size: int, total: int) -> dict[str, int]:
    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "pages": (total + page_size - 1) // page_size if total else 0,
    }


def _public_tender(row: Any) -> dict[str, Any]:
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
        "tender_url": str(data.get("tender_url") or ""),
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
) -> tuple[list[str], list[Any]]:
    conditions: list[str] = []
    params: list[Any] = []
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


def _list_tender_payload(
    *,
    page: int,
    page_size: int,
    sort_by: str,
    sort_order: str,
    **filters: Any,
) -> dict[str, Any]:
    conditions, params = _tender_filters(**filters)
    where_sql = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    sort_column = TENDER_SORT_COLUMNS[sort_by]
    direction = "DESC" if sort_order == "desc" else "ASC"
    offset = (page - 1) * page_size
    with _get_db() as conn:
        total = int(conn.execute(f"SELECT COUNT(*) FROM tenders t{where_sql}", params).fetchone()[0])
        rows = conn.execute(
            f"{_tender_select()}{where_sql} "
            f"ORDER BY {sort_column} {direction},t.id {direction} LIMIT ? OFFSET ?",
            [*params, page_size, offset],
        ).fetchall()
    return {"items": [_public_tender(row) for row in rows], **_page_meta(page, page_size, total)}


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
) -> dict[str, Any]:
    return _list_tender_payload(
        query=q, website_id=website_id, archived=archived, status=status,
        organization=organization, location=location, category=category,
        has_documents=has_documents, sort_by=sort_by, sort_order=sort_order,
        page=page, page_size=page_size,
    )


@router.get("/search", dependencies=[Depends(require_client_user)])
def client_search(
    q: str = Query(..., min_length=1, max_length=200),
    website_id: Optional[int] = Query(None, gt=0),
    archived: Optional[bool] = None,
    sort_by: Literal[tuple(TENDER_SORT_COLUMNS)] = "closing_date",
    sort_order: Literal["asc", "desc"] = "asc",
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
) -> dict[str, Any]:
    return _list_tender_payload(
        query=q, website_id=website_id, archived=archived, sort_by=sort_by,
        sort_order=sort_order, page=page, page_size=page_size,
    )


def _public_organization(row: Any) -> dict[str, Any]:
    data = dict(row)
    return {
        "id": int(data["id"]),
        "website_id": int(data["website_id"]),
        "website_name": str(data.get("website_name") or ""),
        "name": str(data.get("name") or ""),
        "tenders_url": str(data.get("tenders_url") or ""),
        "tender_count": int(data.get("tender_count") or 0),
        "scrape_enabled": bool(data.get("scrape_enabled")),
    }


@router.get("/organizations", dependencies=[Depends(require_client_user)])
def client_organizations(
    q: str = Query("", max_length=200),
    website_id: Optional[int] = Query(None, gt=0),
    page: int = Query(1, ge=1),
    page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
) -> dict[str, Any]:
    conditions: list[str] = []
    params: list[Any] = []
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
        "COALESCE(o.tender_count,0) AS tender_count,COALESCE(o.scrape_enabled,0) AS scrape_enabled "
        "FROM organizations o LEFT JOIN websites w ON w.id=o.website_id"
    )
    offset = (page - 1) * page_size
    with _get_db() as conn:
        total = int(conn.execute(f"SELECT COUNT(*) FROM organizations o{where_sql}", params).fetchone()[0])
        rows = conn.execute(
            f"{select_sql}{where_sql} ORDER BY o.name ASC,o.id ASC LIMIT ? OFFSET ?",
            [*params, page_size, offset],
        ).fetchall()
    return {"items": [_public_organization(row) for row in rows], **_page_meta(page, page_size, total)}


def _find_tender(conn: Any, tender_db_id: int) -> Any:
    row = conn.execute(f"{_tender_select()} WHERE t.id=?", (tender_db_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Tender not found.")
    return row


@router.get("/tenders/{tender_db_id}", dependencies=[Depends(require_client_user)])
def client_tender_detail(tender_db_id: int) -> dict[str, Any]:
    with _get_db() as conn:
        return _public_tender(_find_tender(conn, tender_db_id))


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
) -> dict[str, Any]:
    direction = "DESC" if sort_order == "desc" else "ASC"
    offset = (page - 1) * page_size
    with _get_db() as conn:
        tender = _find_tender(conn, tender_db_id)
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
def client_download_request(tender_db_id: int, body: DownloadRequest, request: Request) -> dict[str, Any]:
    with _get_db() as conn:
        data = dict(_document_row(conn, tender_db_id, body.document_id))
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


@router.post(
    "/tenders/{tender_db_id}/request-download",
    dependencies=[Depends(require_client_user)],
    response_model=RequestDownloadResponse,
)
def client_request_tender_download(tender_db_id: int) -> dict[str, Any]:
    # A tender may not have any downloaded_files rows yet, so there is nothing
    # for /download-request to sign. This kicks off the same scrape+download
    # job the admin console uses for a single tender (api_server._enqueue_job,
    # action "download_single_tender") and the client polls its status below.
    with _get_db() as conn:
        _find_tender(conn, tender_db_id)
    import api_server  # deferred: api_server imports this module at load time

    result = api_server._enqueue_job(
        "download_single_tender",
        {"tender_db_id": tender_db_id, "mode": "full", "source": "client"},
    )
    return {"job_id": str(result["job_id"]), "status": str(result["status"])}


@router.get("/tenders/{tender_db_id}/download-status", dependencies=[Depends(require_client_user)])
def client_tender_download_status(
    tender_db_id: int, job_id: str = Query(..., min_length=1)
) -> dict[str, Any]:
    with _get_db() as conn:
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
    file_name = str(data.get("file_name") or f"document-{document_id}")
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


@router.get("/stats", dependencies=[Depends(require_client_user)])
def client_stats() -> dict[str, Any]:
    with _get_db() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS total,"
            "SUM(CASE WHEN COALESCE(is_archived,0)=0 THEN 1 ELSE 0 END) AS active,"
            "SUM(CASE WHEN COALESCE(is_archived,0)=1 THEN 1 ELSE 0 END) AS archived,"
            "COUNT(DISTINCT website_id) AS websites FROM tenders"
        ).fetchone()
        document_count = int(conn.execute("SELECT COUNT(*) FROM downloaded_files").fetchone()[0])
        categories = conn.execute(
            "SELECT COALESCE(tender_category,'') AS category,COUNT(*) AS count FROM tenders "
            "WHERE TRIM(COALESCE(tender_category,''))!='' GROUP BY tender_category "
            "ORDER BY count DESC,tender_category ASC LIMIT 10"
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
