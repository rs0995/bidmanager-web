"""Read-only, client-safe tender API.

The router in this module intentionally has no scraper, scheduler, configuration,
or write operations.  Its only POST endpoint creates a short-lived signed URL for
an existing downloaded file; it does not persist a request or start a download.
"""

from __future__ import annotations

import os
import hashlib
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


def _configured_client_key() -> str:
    # CLIENT_API_KEY is the public contract.  The older name is accepted during
    # rollout so an existing Cloud Run revision does not become unreachable.
    return (
        os.getenv("CLIENT_API_KEY", "").strip()
        or os.getenv("BIDMANAGER_CLIENT_API_KEY", "").strip()
    )


def require_client_key(x_client_key: Optional[str] = Header(default=None)) -> None:
    expected = _configured_client_key()
    if not expected:
        raise HTTPException(503, "CLIENT_API_KEY is not configured on the backend.")
    if not security.secure_equals(x_client_key, expected):
        raise HTTPException(401, "Invalid or missing client key.")


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
        "tender_url": str(data.get("tender_url") or ""),
    }


def _tender_select() -> str:
    return (
        "SELECT t.id,t.website_id,COALESCE(w.name,'') AS website_name,"
        "COALESCE(t.org_chain,'') AS org_chain,COALESCE(t.tender_id,'') AS tender_id,"
        "COALESCE(t.title,'') AS title,COALESCE(t.work_description,'') AS work_description,"
        "COALESCE(t.tender_value,'') AS tender_value,COALESCE(t.emd,'') AS emd,"
        "COALESCE(t.closing_date,'') AS closing_date,COALESCE(t.opening_date,'') AS opening_date,"
        "COALESCE(t.published_date,'') AS published_date,"
        "COALESCE(t.pre_bid_meeting_date,'') AS pre_bid_meeting_date,"
        "COALESCE(t.location,'') AS location,COALESCE(t.tender_category,'') AS tender_category,"
        "COALESCE(t.status,'') AS status,COALESCE(t.is_archived,0) AS is_archived,"
        "COALESCE(t.tender_url,'') AS tender_url,"
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


@router.get("/health", dependencies=[Depends(require_client_key)])
def client_health() -> dict[str, Any]:
    try:
        with _get_db() as conn:
            conn.execute("SELECT 1").fetchone()
    except Exception:
        raise HTTPException(503, "Client data service is unavailable.")
    return {"status": "ok", "version": core.APP_VERSION, "read_only": True}


@router.get("/tenders", dependencies=[Depends(require_client_key)])
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


@router.get("/search", dependencies=[Depends(require_client_key)])
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


def _find_tender(conn: Any, tender_db_id: int) -> Any:
    row = conn.execute(f"{_tender_select()} WHERE t.id=?", (tender_db_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Tender not found.")
    return row


@router.get("/tenders/{tender_db_id}", dependencies=[Depends(require_client_key)])
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


@router.get("/tenders/{tender_db_id}/documents", dependencies=[Depends(require_client_key)])
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


@router.post("/tenders/{tender_db_id}/download-request", dependencies=[Depends(require_client_key)])
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


@router.get("/stats", dependencies=[Depends(require_client_key)])
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
