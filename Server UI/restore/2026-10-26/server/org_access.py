"""Organisations, membership and per-section access for client accounts.

A client account is an *individual* unless it has a row in client_org_members.
Existing accounts therefore stay individuals with nothing to migrate.

Sections a user can be allowed or denied (client_users.permissions_json; NULL
means the defaults, which is what every existing account has):

    active         active tenders and the organisations list      (default on)
    archived       archived tenders                               (default on)
    bookmarks      bookmarked tenders / bookmarked organisations  (default on)
    projects       projects, checklists, templates (+ files)      (default on)
    portal_search  search a tender ID on a NIC portal             (default off)

Org admins always have every section. Captcha is never gated.

An organisation shares one data pool (client_org_sync) holding the SHARED_KEYS
of the sync blob; each member's own client_user_sync row keeps only personal
keys (column prefs, notification prefs). Shared ids live in the org pool, so
every member reads and writes the same projects / bookmarks.

Joining an org discards the user's own shared data; de-linking either keeps
the org's bookmarks (retain) or wipes everything. Both stamp RESET_KEY in the
user's row so a device still holding the old data can't push it back.

Functions here never commit: the caller commits once the whole operation is
done. Validation failures raise OrgError(status, message).
"""

from __future__ import annotations

import json
import os
import secrets
import sqlite3
import time
from typing import Any, Optional


SECTIONS = ("active", "archived", "bookmarks", "projects", "portal_search")
# Each search opens a browser and solves a captcha on the server, so it is
# opt-in: off until the operator (or an org admin) switches it on.
SECTION_DEFAULTS = {
    "active": True, "archived": True, "bookmarks": True, "projects": True, "portal_search": False,
}
SECTION_KEYS = {
    "bookmarks": ("bookmarkTenderIds", "bookmarks", "bookmarkedOrgs", "bookmarkedOrgIds"),
    "projects": ("projects", "checklist", "templates", "templateItems"),
}
SHARED_KEYS = frozenset(key for keys in SECTION_KEYS.values() for key in keys)
BOOKMARK_KEYS = SECTION_KEYS["bookmarks"]
VERSION_KEYS = ("_v", "_deleted")
# Set in a user's own sync row when the server replaced their data (join or
# de-link). A push based on a pull older than this is ignored.
RESET_KEY = "_reset_at"
ROLES = ("admin", "member")

_JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_JOIN_CODE_LENGTH = 8
MAX_ORG_NAME = 120


class OrgError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


# ── schema ──────────────────────────────────────────────────────────────

_SCHEMA = (
    '''CREATE TABLE IF NOT EXISTS client_orgs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        join_code TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at REAL NOT NULL,
        created_by INTEGER
    )''',
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_client_orgs_join_code ON client_orgs(join_code)",
    '''CREATE TABLE IF NOT EXISTS client_org_members (
        user_id INTEGER PRIMARY KEY,
        org_id INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        joined_at REAL NOT NULL
    )''',
    "CREATE INDEX IF NOT EXISTS idx_client_org_members_org ON client_org_members(org_id)",
    '''CREATE TABLE IF NOT EXISTS client_org_join_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        org_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        note TEXT DEFAULT '',
        created_at REAL NOT NULL,
        decided_at REAL,
        decided_by TEXT
    )''',
    "CREATE INDEX IF NOT EXISTS idx_client_org_requests_org ON client_org_join_requests(org_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_client_org_requests_user ON client_org_join_requests(user_id, status)",
    '''CREATE TABLE IF NOT EXISTS client_org_sync (
        org_id INTEGER PRIMARY KEY,
        data_json TEXT NOT NULL DEFAULT '{}',
        updated_at REAL NOT NULL DEFAULT 0
    )''',
    # Each user's portal searches (client_api /portal-search): the history the
    # apps show in their search tab. status: pending / found / not_found / failed.
    '''CREATE TABLE IF NOT EXISTS client_portal_searches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        website_id INTEGER NOT NULL,
        tender_id TEXT NOT NULL,
        job_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        stage TEXT,
        tender_db_id INTEGER,
        created INTEGER,
        is_archived INTEGER,
        error TEXT,
        created_at REAL NOT NULL,
        finished_at REAL
    )''',
    "CREATE INDEX IF NOT EXISTS idx_client_portal_searches_user ON client_portal_searches(user_id, created_at)",
    # Files attached to checklist rows (project_files.py). scope = 'org:<id>' or
    # 'user:<id>'. One live file per row: the first upload wins.
    '''CREATE TABLE IF NOT EXISTS client_project_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        project_id TEXT,
        checklist_item_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        size_bytes INTEGER DEFAULT 0,
        mime_type TEXT,
        sha256 TEXT,
        storage_ref TEXT,
        uploaded_by INTEGER,
        uploaded_device TEXT,
        status TEXT NOT NULL DEFAULT 'uploading',
        created_at REAL NOT NULL,
        uploaded_at REAL,
        trashed_at REAL
    )''',
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_client_project_files_slot "
    "ON client_project_files(scope, checklist_item_id) WHERE trashed_at IS NULL",
    "CREATE INDEX IF NOT EXISTS idx_client_project_files_project ON client_project_files(scope, project_id)",
)
_COLUMNS = (
    # NULL = the default sections (all existing accounts).
    "ALTER TABLE client_users ADD COLUMN permissions_json TEXT",
)

_ensured: set = set()


def create_schema(cursor: Any) -> None:
    """Idempotent DDL, run by app_core._init_db_schema at startup."""
    for ddl in _SCHEMA:
        cursor.execute(ddl)
    for ddl in _COLUMNS:
        try:
            cursor.execute(ddl)
        except sqlite3.OperationalError:
            pass


def ensure_schema(conn: Any) -> None:
    """create_schema once per database per process, for code paths that can run
    against a database init_db didn't build (tests with a hand-made schema)."""
    import app_core as core  # deferred: app_core imports this module

    key = (str(core.DB_FILE), os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL") or "")
    if key in _ensured:
        return
    create_schema(conn)
    conn.commit()
    _ensured.add(key)


# ── permissions ─────────────────────────────────────────────────────────

def all_sections() -> dict[str, bool]:
    """Every section on (org admins)."""
    return {section: True for section in SECTIONS}


def default_sections() -> dict[str, bool]:
    """What a user with no stored permissions (NULL) has."""
    return dict(SECTION_DEFAULTS)


def parse_permissions(raw: Any) -> dict[str, bool]:
    perms = default_sections()
    if not raw:
        return perms
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        return perms
    if isinstance(data, dict):
        for section in SECTIONS:
            if section in data:
                perms[section] = bool(data[section])
    return perms


def merge_permissions(current: dict[str, bool], changes: Optional[dict[str, Any]]) -> dict[str, bool]:
    out = dict(current)
    for section in SECTIONS:
        if changes and section in changes and changes[section] is not None:
            out[section] = bool(changes[section])
    return out


def dump_permissions(perms: dict[str, bool]) -> Optional[str]:
    """NULL when the sections equal the defaults, so such a user looks exactly
    like an account from before permissions existed."""
    normalized = {section: bool(perms.get(section, SECTION_DEFAULTS[section])) for section in SECTIONS}
    if normalized == SECTION_DEFAULTS:
        return None
    return json.dumps(normalized, sort_keys=True)


def hidden_keys(perms: dict[str, bool]) -> set[str]:
    out: set[str] = set()
    for section, keys in SECTION_KEYS.items():
        if not perms.get(section, True):
            out.update(keys)
    return out


def is_restricted(account: dict[str, Any]) -> bool:
    """Any data section (not portal search) switched off."""
    return not all(account["permissions"].get(s, True) for s in SECTION_KEYS.keys() | {"active", "archived"})


# ── accounts ────────────────────────────────────────────────────────────

def get_account(conn: Any, user_id: int) -> dict[str, Any]:
    ensure_schema(conn)
    row = conn.execute(
        "SELECT u.permissions_json, m.org_id, m.role, o.name "
        "FROM client_users u "
        "LEFT JOIN client_org_members m ON m.user_id=u.id "
        "LEFT JOIN client_orgs o ON o.id=m.org_id "
        "WHERE u.id=?",
        (user_id,),
    ).fetchone()
    stored = parse_permissions(row[0] if row else None)
    org_id = int(row[1]) if row and row[1] is not None else None
    role = str(row[2] or "member") if org_id is not None else None
    return {
        "user_id": int(user_id),
        "account_type": "organisation" if org_id is not None else "individual",
        "org_id": org_id,
        "org_name": str(row[3] or "") if org_id is not None else None,
        "role": role,
        # Org admins see everything regardless of what is stored for them.
        "permissions": all_sections() if role == "admin" else stored,
        "stored_permissions": stored,
    }


def public_account(conn: Any, account: dict[str, Any]) -> dict[str, Any]:
    """The account block returned to the user (/client/me, login, register)."""
    return {
        "account_type": account["account_type"],
        "org": (
            {"id": account["org_id"], "name": account["org_name"], "role": account["role"]}
            if account["org_id"] is not None else None
        ),
        "permissions": dict(account["permissions"]),
        "pending_request": pending_request_for_user(conn, account["user_id"]),
    }


def _user_exists(conn: Any, user_id: int) -> bool:
    return bool(conn.execute("SELECT id FROM client_users WHERE id=?", (user_id,)).fetchone())


def _revoke_tokens(conn: Any, user_id: int, now: float) -> None:
    conn.execute(
        "UPDATE client_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",
        (now, user_id),
    )


def membership_map(conn: Any) -> dict[int, dict[str, Any]]:
    """user_id -> {org_id, org_name, role} for every org member."""
    ensure_schema(conn)
    out: dict[int, dict[str, Any]] = {}
    for row in conn.execute(
        "SELECT m.user_id, m.org_id, m.role, o.name FROM client_org_members m "
        "LEFT JOIN client_orgs o ON o.id=m.org_id"
    ).fetchall():
        out[int(row[0])] = {"org_id": int(row[1]), "role": str(row[2] or "member"), "org_name": str(row[3] or "")}
    return out


# ── sync blobs ──────────────────────────────────────────────────────────

def _load_json(raw: Any) -> dict:
    try:
        data = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def read_user_blob(conn: Any, user_id: int) -> tuple[dict, float, bool]:
    row = conn.execute(
        "SELECT data_json, updated_at FROM client_user_sync WHERE user_id=?", (user_id,)
    ).fetchone()
    if not row:
        return {}, 0.0, False
    return _load_json(row[0]), float(row[1] or 0), True


def read_org_blob(conn: Any, org_id: int) -> tuple[dict, float, bool]:
    row = conn.execute(
        "SELECT data_json, updated_at FROM client_org_sync WHERE org_id=?", (org_id,)
    ).fetchone()
    if not row:
        return {}, 0.0, False
    return _load_json(row[0]), float(row[1] or 0), True


def write_user_blob(conn: Any, user_id: int, blob: dict, updated_at: float) -> None:
    conn.execute(
        "INSERT INTO client_user_sync (user_id, data_json, updated_at) VALUES (?,?,?) "
        "ON CONFLICT(user_id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at",
        (user_id, json.dumps(blob, ensure_ascii=False), updated_at),
    )


def write_org_blob(conn: Any, org_id: int, blob: dict, updated_at: float) -> None:
    conn.execute(
        "INSERT INTO client_org_sync (org_id, data_json, updated_at) VALUES (?,?,?) "
        "ON CONFLICT(org_id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at",
        (org_id, json.dumps(blob, ensure_ascii=False), updated_at),
    )


def all_org_blobs(conn: Any) -> list[tuple[int, dict]]:
    ensure_schema(conn)
    return [
        (int(row[0]), _load_json(row[1]))
        for row in conn.execute(
            "SELECT s.org_id, s.data_json FROM client_org_sync s "
            "JOIN client_orgs o ON o.id=s.org_id WHERE o.status='active'"
        ).fetchall()
    ]


def _pick(blob: dict, keep) -> dict:
    """The keys of `blob` for which keep(key) is true, with the per-item
    version maps (_v / _deleted) cut down to the same keys."""
    out = {k: v for k, v in blob.items() if k not in VERSION_KEYS and keep(k)}
    for vkey in VERSION_KEYS:
        vmap = blob.get(vkey)
        if isinstance(vmap, dict):
            kept = {k: v for k, v in vmap.items() if keep(k)}
            if kept:
                out[vkey] = kept
    return out


def split_blob(blob: dict) -> tuple[dict, dict]:
    """(shared part, personal part). Underscore bookkeeping keys other than the
    version maps (e.g. RESET_KEY) stay personal."""
    return (
        _pick(blob, lambda k: k in SHARED_KEYS),
        _pick(blob, lambda k: k not in SHARED_KEYS),
    )


def join_blobs(personal: dict, shared: dict) -> dict:
    out = {k: v for k, v in personal.items() if k not in VERSION_KEYS}
    out.update({k: v for k, v in shared.items() if k not in VERSION_KEYS})
    for vkey in VERSION_KEYS:
        merged = {**(personal.get(vkey) or {}), **(shared.get(vkey) or {})}
        if merged:
            out[vkey] = merged
    return out


def strip_hidden(blob: dict, perms: dict[str, bool]) -> dict:
    hidden = hidden_keys(perms)
    if not hidden:
        return blob
    return _pick(blob, lambda k: k not in hidden)


def effective_blob(
    conn: Any, user_id: int, account: Optional[dict[str, Any]] = None, apply_permissions: bool = True,
) -> tuple[dict, float, bool]:
    """What this user's apps see as their sync blob: their own row for an
    individual; for an org member the org pool's shared keys plus their own
    personal keys. Sections the user may not use are left out. Returns
    (blob, updated_at, any row exists)."""
    account = account or get_account(conn, user_id)
    user_blob, user_ts, user_found = read_user_blob(conn, user_id)
    if account["org_id"] is None:
        blob, ts, found = user_blob, user_ts, user_found
    else:
        org_blob, org_ts, org_found = read_org_blob(conn, account["org_id"])
        blob = join_blobs(split_blob(user_blob)[1], split_blob(org_blob)[0])
        ts, found = max(user_ts, org_ts), user_found or org_found
    if apply_permissions:
        blob = strip_hidden(blob, account["permissions"])
    if RESET_KEY in blob:
        blob = {k: v for k, v in blob.items() if k != RESET_KEY}
    return blob, ts, found


# ── organisations ───────────────────────────────────────────────────────

def _clean_name(name: Any) -> str:
    value = " ".join(str(name or "").split())
    if not value:
        raise OrgError(400, "Enter an organisation name.")
    if len(value) > MAX_ORG_NAME:
        raise OrgError(400, f"Organisation name is too long (max {MAX_ORG_NAME} characters).")
    return value


def _new_join_code(conn: Any) -> str:
    while True:
        code = "".join(secrets.choice(_JOIN_CODE_ALPHABET) for _ in range(_JOIN_CODE_LENGTH))
        if not conn.execute("SELECT id FROM client_orgs WHERE join_code=?", (code,)).fetchone():
            return code


def _org_row(conn: Any, org_id: int) -> tuple:
    row = conn.execute(
        "SELECT id, name, join_code, status, created_at, created_by FROM client_orgs WHERE id=?",
        (org_id,),
    ).fetchone()
    if not row or str(row[3]) != "active":
        raise OrgError(404, "Organisation not found.")
    return tuple(row)


def _member_role(conn: Any, org_id: int, user_id: int) -> str:
    row = conn.execute(
        "SELECT role FROM client_org_members WHERE org_id=? AND user_id=?", (org_id, user_id)
    ).fetchone()
    if not row:
        raise OrgError(404, "This user is not a member of the organisation.")
    return str(row[0] or "member")


def _admin_count(conn: Any, org_id: int) -> int:
    return int(conn.execute(
        "SELECT COUNT(*) FROM client_org_members WHERE org_id=? AND role='admin'", (org_id,)
    ).fetchone()[0])


def _cancel_pending_requests(conn: Any, user_id: int, now: float, decided_by: str) -> None:
    conn.execute(
        "UPDATE client_org_join_requests SET status='cancelled', decided_at=?, decided_by=? "
        "WHERE user_id=? AND status='pending'",
        (now, decided_by, user_id),
    )


def create_org(conn: Any, user_id: int, name: Any, now: Optional[float] = None) -> int:
    """A new org with `user_id` as its admin. The user is the first member, so
    their own projects/bookmarks become the org's shared data."""
    now = time.time() if now is None else now
    ensure_schema(conn)
    clean = _clean_name(name)
    if not _user_exists(conn, user_id):
        raise OrgError(404, "User not found.")
    if get_account(conn, user_id)["org_id"] is not None:
        raise OrgError(409, "This account already belongs to an organisation.")
    cur = conn.execute(
        "INSERT INTO client_orgs (name, join_code, status, created_at, created_by) VALUES (?,?,?,?,?)",
        (clean, _new_join_code(conn), "active", now, user_id),
    )
    org_id = int(cur.lastrowid)
    conn.execute(
        "INSERT INTO client_org_members (user_id, org_id, role, joined_at) VALUES (?,?,?,?)",
        (user_id, org_id, "admin", now),
    )
    _cancel_pending_requests(conn, user_id, now, f"user:{user_id}")
    user_blob, user_ts, user_found = read_user_blob(conn, user_id)
    shared, personal = split_blob(user_blob)
    write_org_blob(conn, org_id, shared, now)
    # Their checklist files move with their projects.
    conn.execute(
        "UPDATE client_project_files SET scope=? WHERE scope=? AND trashed_at IS NULL",
        (f"org:{org_id}", f"user:{user_id}"),
    )
    if user_found:
        write_user_blob(conn, user_id, personal, user_ts)
    return org_id


def rename_org(conn: Any, org_id: int, name: Any) -> None:
    _org_row(conn, org_id)
    conn.execute("UPDATE client_orgs SET name=? WHERE id=?", (_clean_name(name), org_id))


def regenerate_join_code(conn: Any, org_id: int) -> str:
    _org_row(conn, org_id)
    code = _new_join_code(conn)
    conn.execute("UPDATE client_orgs SET join_code=? WHERE id=?", (code, org_id))
    return code


def _public_request(row: Any) -> dict[str, Any]:
    return {
        "id": int(row[0]),
        "user_id": int(row[1]),
        "org_id": int(row[2]),
        "status": str(row[3] or ""),
        "note": str(row[4] or ""),
        "created_at": float(row[5] or 0),
        "decided_at": float(row[6]) if row[6] is not None else None,
        "org_name": str(row[7] or ""),
        "email": str(row[8] or ""),
        "display_name": str(row[9] or ""),
    }


_REQUEST_SELECT = (
    "SELECT r.id, r.user_id, r.org_id, r.status, r.note, r.created_at, r.decided_at, "
    "o.name, u.email, u.display_name FROM client_org_join_requests r "
    "LEFT JOIN client_orgs o ON o.id=r.org_id LEFT JOIN client_users u ON u.id=r.user_id"
)


def pending_request_for_user(conn: Any, user_id: int) -> Optional[dict[str, Any]]:
    row = conn.execute(
        f"{_REQUEST_SELECT} WHERE r.user_id=? AND r.status='pending' ORDER BY r.created_at DESC",
        (user_id,),
    ).fetchone()
    return _public_request(row) if row else None


def pending_requests_for_org(conn: Any, org_id: int) -> list[dict[str, Any]]:
    return [
        _public_request(row) for row in conn.execute(
            f"{_REQUEST_SELECT} WHERE r.org_id=? AND r.status='pending' ORDER BY r.created_at",
            (org_id,),
        ).fetchall()
    ]


def request_join(conn: Any, user_id: int, join_code: Any, note: Any = "", now: Optional[float] = None) -> dict[str, Any]:
    now = time.time() if now is None else now
    ensure_schema(conn)
    if get_account(conn, user_id)["org_id"] is not None:
        raise OrgError(409, "This account already belongs to an organisation.")
    code = "".join(str(join_code or "").split()).upper()
    row = conn.execute(
        "SELECT id FROM client_orgs WHERE join_code=? AND status='active'", (code,)
    ).fetchone() if code else None
    if not row:
        raise OrgError(404, "No organisation has this join code.")
    if pending_request_for_user(conn, user_id):
        raise OrgError(409, "You already have a pending request. Cancel it first.")
    cur = conn.execute(
        "INSERT INTO client_org_join_requests (user_id, org_id, status, note, created_at) VALUES (?,?,?,?,?)",
        (user_id, int(row[0]), "pending", str(note or "")[:500], now),
    )
    request_id = int(cur.lastrowid)
    return _public_request(conn.execute(f"{_REQUEST_SELECT} WHERE r.id=?", (request_id,)).fetchone())


def cancel_request(conn: Any, user_id: int, now: Optional[float] = None) -> None:
    now = time.time() if now is None else now
    if not pending_request_for_user(conn, user_id):
        raise OrgError(404, "You have no pending request.")
    _cancel_pending_requests(conn, user_id, now, f"user:{user_id}")


def _link_member(
    conn: Any, org_id: int, user_id: int, role: str, permissions: Optional[dict[str, Any]],
    now: float, decided_by: str,
) -> None:
    """Add a user to an org. Their own shared data is discarded (personal prefs
    stay), their devices are signed out, and older pushes are ignored."""
    if role not in ROLES:
        raise OrgError(400, "Role must be 'admin' or 'member'.")
    if get_account(conn, user_id)["org_id"] is not None:
        raise OrgError(409, "This user already belongs to an organisation.")
    conn.execute(
        "INSERT INTO client_org_members (user_id, org_id, role, joined_at) VALUES (?,?,?,?)",
        (user_id, org_id, role, now),
    )
    conn.execute(
        "UPDATE client_users SET permissions_json=? WHERE id=?",
        (dump_permissions(merge_permissions(default_sections(), permissions)), user_id),
    )
    user_blob, _ts, _found = read_user_blob(conn, user_id)
    personal = split_blob(user_blob)[1]
    personal[RESET_KEY] = now
    write_user_blob(conn, user_id, personal, now)
    # Their own checklist files go with their discarded projects.
    import project_files  # deferred: project_files imports this module

    project_files.trash_scope(conn, f"user:{user_id}", now)
    _revoke_tokens(conn, user_id, now)
    _cancel_pending_requests(conn, user_id, now, decided_by)


def decide_request(
    conn: Any, org_id: int, request_id: int, approve: bool, decided_by: str,
    permissions: Optional[dict[str, Any]] = None, now: Optional[float] = None,
) -> dict[str, Any]:
    now = time.time() if now is None else now
    ensure_schema(conn)
    _org_row(conn, org_id)
    row = conn.execute(
        "SELECT user_id FROM client_org_join_requests WHERE id=? AND org_id=? AND status='pending'",
        (request_id, org_id),
    ).fetchone()
    if not row:
        raise OrgError(404, "Join request not found or already decided.")
    user_id = int(row[0])
    if approve:
        _link_member(conn, org_id, user_id, "member", permissions, now, decided_by)
    conn.execute(
        "UPDATE client_org_join_requests SET status=?, decided_at=?, decided_by=? WHERE id=?",
        ("approved" if approve else "rejected", now, decided_by, request_id),
    )
    return _public_request(conn.execute(f"{_REQUEST_SELECT} WHERE r.id=?", (request_id,)).fetchone())


def add_member(
    conn: Any, org_id: int, user_id: int, role: str = "member",
    permissions: Optional[dict[str, Any]] = None, now: Optional[float] = None,
) -> None:
    """Operator links an existing user directly (same effect as an approval)."""
    now = time.time() if now is None else now
    ensure_schema(conn)
    _org_row(conn, org_id)
    if not _user_exists(conn, user_id):
        raise OrgError(404, "User not found.")
    _link_member(conn, org_id, user_id, role, permissions, now, "operator")


def set_permissions(
    conn: Any, user_id: int, changes: dict[str, Any], org_id: Optional[int] = None,
) -> dict[str, bool]:
    """Change a user's sections. With org_id, the user must be a member of that
    org (an org admin editing their own members)."""
    ensure_schema(conn)
    if org_id is not None:
        _org_row(conn, org_id)
        _member_role(conn, org_id, user_id)
    elif not _user_exists(conn, user_id):
        raise OrgError(404, "User not found.")
    merged = merge_permissions(get_account(conn, user_id)["stored_permissions"], changes)
    conn.execute(
        "UPDATE client_users SET permissions_json=? WHERE id=?", (dump_permissions(merged), user_id)
    )
    return merged


def set_role(conn: Any, org_id: int, user_id: int, role: str) -> None:
    ensure_schema(conn)
    if role not in ROLES:
        raise OrgError(400, "Role must be 'admin' or 'member'.")
    _org_row(conn, org_id)
    current = _member_role(conn, org_id, user_id)
    if current == "admin" and role != "admin" and _admin_count(conn, org_id) <= 1:
        raise OrgError(409, "An organisation needs at least one admin. Make someone else admin first.")
    conn.execute(
        "UPDATE client_org_members SET role=? WHERE org_id=? AND user_id=?", (role, org_id, user_id)
    )


def _detach(conn: Any, org_id: int, user_id: int, retain: bool, now: float) -> None:
    account = get_account(conn, user_id)
    conn.execute("DELETE FROM client_org_members WHERE org_id=? AND user_id=?", (org_id, user_id))
    if retain:
        user_blob, _ts, _found = read_user_blob(conn, user_id)
        blob = split_blob(user_blob)[1]
        if account["permissions"].get("bookmarks", True):
            org_blob, _ots, _ofound = read_org_blob(conn, org_id)
            bookmarks = _pick(org_blob, lambda k: k in BOOKMARK_KEYS)
            blob = join_blobs(blob, bookmarks)
    else:
        blob = {}
    blob[RESET_KEY] = now
    write_user_blob(conn, user_id, blob, now)
    # Back to an individual with the default sections.
    conn.execute("UPDATE client_users SET permissions_json=NULL WHERE id=?", (user_id,))
    _revoke_tokens(conn, user_id, now)


def delink(conn: Any, org_id: int, user_id: int, retain: bool, now: Optional[float] = None) -> None:
    """Remove a member. retain=True keeps the org's bookmarked tenders and
    organisations in their own account; projects, checklists and templates
    stay with the org. retain=False wipes their data completely."""
    now = time.time() if now is None else now
    ensure_schema(conn)
    _org_row(conn, org_id)
    role = _member_role(conn, org_id, user_id)
    if role == "admin" and _admin_count(conn, org_id) <= 1:
        raise OrgError(409, "The last admin can't be removed. Make someone else admin first.")
    _detach(conn, org_id, user_id, retain, now)


def dissolve_org(conn: Any, org_id: int, retain: bool, now: Optional[float] = None) -> int:
    """Operator only: every member becomes an individual (as delink), the org's
    shared data is deleted and pending requests are cancelled."""
    now = time.time() if now is None else now
    ensure_schema(conn)
    _org_row(conn, org_id)
    members = [int(r[0]) for r in conn.execute(
        "SELECT user_id FROM client_org_members WHERE org_id=?", (org_id,)
    ).fetchall()]
    for user_id in members:
        _detach(conn, org_id, user_id, retain, now)
    conn.execute("DELETE FROM client_org_sync WHERE org_id=?", (org_id,))
    import project_files  # deferred: project_files imports this module

    project_files.trash_scope(conn, f"org:{org_id}", now)
    conn.execute(
        "UPDATE client_org_join_requests SET status='cancelled', decided_at=?, decided_by='operator' "
        "WHERE org_id=? AND status='pending'",
        (now, org_id),
    )
    conn.execute("UPDATE client_orgs SET status='dissolved' WHERE id=?", (org_id,))
    return len(members)


def org_detail(conn: Any, org_id: int) -> dict[str, Any]:
    ensure_schema(conn)
    org = _org_row(conn, org_id)
    members = []
    for row in conn.execute(
        "SELECT m.user_id, m.role, m.joined_at, u.email, u.display_name, u.status, u.last_seen_at, "
        "u.permissions_json FROM client_org_members m LEFT JOIN client_users u ON u.id=m.user_id "
        "WHERE m.org_id=? ORDER BY m.joined_at, m.user_id",
        (org_id,),
    ).fetchall():
        role = str(row[1] or "member")
        members.append({
            "user_id": int(row[0]),
            "role": role,
            "joined_at": float(row[2] or 0),
            "email": str(row[3] or ""),
            "display_name": str(row[4] or ""),
            "status": str(row[5] or "active"),
            "last_seen_at": float(row[6]) if row[6] is not None else None,
            "permissions": all_sections() if role == "admin" else parse_permissions(row[7]),
        })
    _blob, synced_at, _found = read_org_blob(conn, org_id)
    return {
        "id": int(org[0]),
        "name": str(org[1] or ""),
        "join_code": str(org[2] or ""),
        "status": str(org[3] or ""),
        "created_at": float(org[4] or 0),
        "created_by": int(org[5]) if org[5] is not None else None,
        "members": members,
        "pending_requests": pending_requests_for_org(conn, org_id),
        "synced_at": synced_at,
    }


def list_orgs(conn: Any) -> list[dict[str, Any]]:
    ensure_schema(conn)
    return [
        {
            "id": int(row[0]),
            "name": str(row[1] or ""),
            "join_code": str(row[2] or ""),
            "created_at": float(row[3] or 0),
            "member_count": int(row[4] or 0),
            "pending_requests": int(row[5] or 0),
        }
        for row in conn.execute(
            "SELECT o.id, o.name, o.join_code, o.created_at, "
            "(SELECT COUNT(*) FROM client_org_members m WHERE m.org_id=o.id), "
            "(SELECT COUNT(*) FROM client_org_join_requests r WHERE r.org_id=o.id AND r.status='pending') "
            "FROM client_orgs o WHERE o.status='active' ORDER BY LOWER(o.name), o.id"
        ).fetchall()
    ]
