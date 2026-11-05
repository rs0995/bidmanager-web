"""Files attached to project checklist rows, shared across platforms.

A checklist row's file lives on the server (Drive, or the local download
folder) and is described on the row in the sync blob as `server_file`, so
every platform of the same account, or every member of the same org, sees
and can download it. The server owns `server_file`: a sync push never sets
or clears it (client_api._merge_sync_blob); only an upload or a delete here
does.

One file per checklist row: the first upload to reach the server wins. A
later upload to the same row gets 409 with the kept file, so that platform
replaces its own copy with it. To replace a file on purpose, delete it and
upload again.

Files belong to the owner of the sync data: `org:<id>` for an org member,
`user:<id>` for an individual (the same split as org_access.effective_blob).

Where a file is stored (Drive or the local download folder):

    project-files/P - <tender id>/<owner>/<project>/<stored name>
    project-files/P - No tender/<owner>/<project>/<stored name>

    owner    "<org name> (org <id>)" or "<user name> (user <id>)"
    project  "<project title> (<project id>)"
    stored   the uploaded name, or "name (2).ext" ... if the project already
             has a live file of that name (the apps keep the original name)

"P - " marks a project folder, apart from the tender document folders. All
projects of one tender, whoever owns them, sit under its "P - <tender id>"
folder. Names are taken at upload time; renames don't move existing files,
and archiving a tender or project doesn't move them either.

Functions here never commit unless they say so; storage calls (Drive) are
best-effort where noted.
"""

from __future__ import annotations

import os
import re
import time
from typing import Any, Optional

import org_access

FILE_PREFIX = "project-files/"
# A crashed upload leaves its reservation behind; after this it no longer
# blocks the row.
STALE_UPLOAD_SECONDS = 3600
MAX_NAME_LENGTH = 180

_FILE_COLUMNS = (
    "id", "scope", "project_id", "checklist_item_id", "file_name", "stored_name", "folder_path",
    "size_bytes", "mime_type", "sha256", "storage_ref", "uploaded_by", "uploaded_device", "status",
    "created_at", "uploaded_at", "trashed_at",
)
MAX_FOLDER_NAME = 80
NO_TENDER_FOLDER = "P - No tender"
MAX_NAME_SUFFIX = 50
FILE_SELECT = f"SELECT {', '.join(_FILE_COLUMNS)} FROM client_project_files"


def scope_for(account: dict[str, Any]) -> str:
    if account["org_id"] is not None:
        return f"org:{account['org_id']}"
    return f"user:{account['user_id']}"


def safe_file_name(name: Any) -> str:
    base = os.path.basename(str(name or "").replace("\\", "/"))
    base = re.sub(r'[\x00-\x1f<>:"/\\|?*]+', "_", base).strip(" .")
    if not base:
        base = "file"
    if len(base) > MAX_NAME_LENGTH:
        stem, ext = os.path.splitext(base)
        base = stem[: MAX_NAME_LENGTH - len(ext)] + ext
    return base


def _folder_name(value: Any, fallback: str) -> str:
    text = re.sub(r'[\x00-\x1f<>:"/\\|?*]+', " ", str(value or ""))
    text = " ".join(text.split()).strip(" .")
    return (text or fallback)[:MAX_FOLDER_NAME].rstrip(" .") or fallback


def tender_folder(project: Optional[dict]) -> str:
    tender_id = " ".join(str((project or {}).get("source_tender_id") or "").split()).upper()
    return f"P - {_folder_name(tender_id, '')}" if tender_id and _folder_name(tender_id, "") else NO_TENDER_FOLDER


def owner_folder(conn: Any, account: dict[str, Any]) -> str:
    if account["org_id"] is not None:
        return f"{_folder_name(account.get('org_name'), 'Organisation')} (org {account['org_id']})"
    row = conn.execute(
        "SELECT display_name, email FROM client_users WHERE id=?", (account["user_id"],)
    ).fetchone()
    name = (row[0] or row[1]) if row else ""
    return f"{_folder_name(name, 'User')} (user {account['user_id']})"


def project_folder(project: Optional[dict], project_id: Any) -> str:
    title = _folder_name((project or {}).get("title"), "Project")
    return f"{title} ({_folder_name(project_id, 'none')})"


def find_project(blob: dict, project_id: Any) -> Optional[dict]:
    for row in blob.get("projects") or []:
        if isinstance(row, dict) and str(row.get("id")) == str(project_id):
            return row
    return None


def name_candidates(file_name: str):
    """file.pdf, file (2).pdf, file (3).pdf ..."""
    yield file_name
    stem, ext = os.path.splitext(file_name)
    for n in range(2, MAX_NAME_SUFFIX + 1):
        yield f"{stem} ({n}){ext}"


def name_taken(conn: Any, scope: str, project_id: str, stored_name: str) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM client_project_files WHERE scope=? AND project_id=? AND stored_name=? "
        "AND trashed_at IS NULL",
        (scope, str(project_id), stored_name),
    ).fetchone())


def row_dict(raw: Any) -> dict[str, Any]:
    return dict(zip(_FILE_COLUMNS, tuple(raw)))


def public_file(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "project_id": row["project_id"],
        "checklist_item_id": row["checklist_item_id"],
        "name": row["file_name"],
        "size": int(row["size_bytes"] or 0),
        "type": row["mime_type"] or "application/octet-stream",
        "sha256": row["sha256"] or "",
        "uploaded_at": float(row["uploaded_at"]) if row["uploaded_at"] else None,
        "uploaded_by": int(row["uploaded_by"]) if row["uploaded_by"] is not None else None,
        "device": row["uploaded_device"] or "",
    }


def server_file_entry(row: dict[str, Any]) -> dict[str, Any]:
    """What the checklist row carries in the sync blob."""
    entry = public_file(row)
    entry.pop("project_id", None)
    entry.pop("checklist_item_id", None)
    return entry


# ── sync blob ───────────────────────────────────────────────────────────

def _read_scope_blob(conn: Any, scope: str) -> tuple[dict, float, bool]:
    kind, _, ident = scope.partition(":")
    if kind == "org":
        return org_access.read_org_blob(conn, int(ident))
    return org_access.read_user_blob(conn, int(ident))


def _write_scope_blob(conn: Any, scope: str, blob: dict, updated_at: float) -> None:
    kind, _, ident = scope.partition(":")
    if kind == "org":
        org_access.write_org_blob(conn, int(ident), blob, updated_at)
    else:
        org_access.write_user_blob(conn, int(ident), blob, updated_at)


def find_checklist_row(blob: dict, item_id: Any) -> Optional[dict]:
    for row in blob.get("checklist") or []:
        if isinstance(row, dict) and str(row.get("id")) == str(item_id):
            return row
    return None


def set_server_file(conn: Any, scope: str, item_id: Any, entry: Optional[dict], now: float) -> None:
    """Write (or, with None, clear) server_file on a checklist row and stamp
    the row as changed now, so every platform picks it up on its next pull."""
    blob, _updated_at, _found = _read_scope_blob(conn, scope)
    rows = blob.get("checklist")
    if not isinstance(rows, list):
        return
    changed = False
    out = []
    for row in rows:
        if isinstance(row, dict) and str(row.get("id")) == str(item_id):
            row = dict(row)
            if entry is None:
                changed = row.pop("server_file", None) is not None or changed
            else:
                row["server_file"] = entry
                changed = True
        out.append(row)
    if not changed:
        return
    blob = dict(blob)
    blob["checklist"] = out
    versions = {k: dict(v or {}) for k, v in (blob.get("_v") or {}).items()}
    versions.setdefault("checklist", {})[str(item_id)] = now
    blob["_v"] = versions
    _write_scope_blob(conn, scope, blob, now)


# ── files ───────────────────────────────────────────────────────────────

def active_file(conn: Any, scope: str, item_id: Any) -> Optional[dict[str, Any]]:
    raw = conn.execute(
        f"{FILE_SELECT} WHERE scope=? AND checklist_item_id=? AND trashed_at IS NULL",
        (scope, str(item_id)),
    ).fetchone()
    return row_dict(raw) if raw else None


def get_file(conn: Any, file_id: int) -> Optional[dict[str, Any]]:
    raw = conn.execute(f"{FILE_SELECT} WHERE id=? AND trashed_at IS NULL", (file_id,)).fetchone()
    return row_dict(raw) if raw else None


def list_files(conn: Any, scope: str, project_id: Optional[str] = None) -> list[dict[str, Any]]:
    sql = f"{FILE_SELECT} WHERE scope=? AND status='active' AND trashed_at IS NULL"
    params: list[Any] = [scope]
    if project_id is not None:
        sql += " AND project_id=?"
        params.append(str(project_id))
    return [row_dict(r) for r in conn.execute(f"{sql} ORDER BY id", params).fetchall()]


def drop_stale_reservation(conn: Any, scope: str, item_id: Any, now: float) -> bool:
    cur = conn.execute(
        "DELETE FROM client_project_files WHERE scope=? AND checklist_item_id=? AND status='uploading' "
        "AND trashed_at IS NULL AND created_at < ?",
        (scope, str(item_id), now - STALE_UPLOAD_SECONDS),
    )
    return bool(getattr(cur, "rowcount", 0))


def _delete_stored(reference: str) -> None:
    """Best-effort removal of the stored bytes. Drive files are trashed (the
    service account can't hard-delete)."""
    reference = str(reference or "")
    if not reference:
        return
    try:
        if reference.startswith("gdrive://"):
            import drive_storage

            drive_storage.trash(reference[len("gdrive://"):])
        elif os.path.isfile(reference):
            os.remove(reference)
    except Exception:
        pass


def trash_file(conn: Any, row: dict[str, Any], now: float) -> None:
    conn.execute("UPDATE client_project_files SET trashed_at=? WHERE id=?", (now, row["id"]))
    _delete_stored(row.get("storage_ref") or "")


def trash_items(conn: Any, scope: str, item_ids, now: Optional[float] = None) -> int:
    """Trash the files of checklist rows that were removed."""
    now = time.time() if now is None else now
    keys = sorted({str(i) for i in item_ids or []})
    if not keys:
        return 0
    org_access.ensure_schema(conn)
    rows = [row_dict(r) for r in conn.execute(
        f"{FILE_SELECT} WHERE scope=? AND trashed_at IS NULL AND checklist_item_id IN "
        f"({','.join('?' for _ in keys)})",
        (scope, *keys),
    ).fetchall()]
    for row in rows:
        trash_file(conn, row, now)
    return len(rows)


def trash_scope(conn: Any, scope: str, now: Optional[float] = None) -> int:
    """Trash every file of an owner whose projects are being discarded."""
    now = time.time() if now is None else now
    org_access.ensure_schema(conn)
    rows = [row_dict(r) for r in conn.execute(
        f"{FILE_SELECT} WHERE scope=? AND trashed_at IS NULL", (scope,)
    ).fetchall()]
    for row in rows:
        trash_file(conn, row, now)
    return len(rows)
