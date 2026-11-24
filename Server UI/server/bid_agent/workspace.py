"""Where the agent's work lands: the tender's project, its checklist and its files.

Files are stored exactly like files users attach to checklist rows
(client_project_files, see the server's project_files.py), so every app of the
account / organisation can open them and they live in the tender's folder:

    project-files/P - <tender id>/<owner>/<project>/                 <- Ready Docs files
    project-files/P - <tender id>/<owner>/<project>/Docs for Preparation/
    project-files/P - <tender id>/<owner>/<project>/Bid Agent index.json

* A file attached to a checklist row uses that row's id (first upload wins, as
  for user uploads) and is set as the row's ``server_file``.
* A "Docs for Preparation" file has no checklist row; it uses the slot id
  ``bidagent-prep:<uuid>`` so it can't clash with real rows.
* ``bid_agent_files`` is the key that maps every file the agent (or a user,
  for prep docs) saved to its tender, project, folder, kind and checklist row.
  The same map is written to ``Bid Agent index.json`` in the project folder.

Projects and checklist rows are written into the owner's sync data with a
fresh version stamp, so every app picks them up on its next sync. Server-made
ids start at 9,000,000 to stay clear of ids the apps hand out.
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import re
import shutil
import tempfile
import time
import uuid
from typing import Any, Optional

READY_SUBFOLDER = "Ready Docs"
PREP_FOLDER = "Docs for Preparation"
INDEX_NAME = "Bid Agent index.json"
LIBRARY_FOLDER = "Reference documents"
LIBRARY_ROOT = "Bid Agent Library"
SERVER_ID_FLOOR = 9_000_000

MANIFEST_SCHEMA = [
    """CREATE TABLE IF NOT EXISTS bid_agent_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_key TEXT NOT NULL,
        tender_db_id INTEGER,
        tender_ref TEXT,
        project_id TEXT,
        file_id INTEGER,
        name TEXT,
        kind TEXT,
        folder TEXT,
        checklist_item_id TEXT,
        label TEXT,
        created_by INTEGER,
        created_at REAL,
        removed_at REAL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_bid_agent_files_owner ON bid_agent_files(owner_key, tender_db_id)",
]


def canon(value: Any) -> str:
    return " ".join(str(value or "").split()).upper()


def norm_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


class Workspace:
    """One owner's work on one tender. ``conn_factory`` gives server DB connections."""

    def __init__(self, conn_factory, user_id: int, tender: dict):
        import org_access
        import project_files

        self.pf = project_files
        self.oa = org_access
        self.connect = conn_factory
        self.user_id = int(user_id)
        self.tender = tender
        with self._db() as conn:
            self.account = org_access.get_account(conn, self.user_id)
            for stmt in MANIFEST_SCHEMA:
                conn.execute(stmt)
            conn.commit()
        self.scope = project_files.scope_for(self.account)

    # ---------------------------------------------------------------- db
    def _db(self):
        class _Ctx:
            def __init__(s, f):
                s.f = f

            def __enter__(s):
                s.c = s.f()
                return s.c

            def __exit__(s, *exc):
                s.c.close()

        return _Ctx(self.connect)

    def _blob(self, conn) -> dict:
        blob, _ts, _found = self.pf._read_scope_blob(conn, self.scope)
        return dict(blob or {})

    def _save_blob(self, conn, blob: dict, stamps: dict[str, list], now: float) -> None:
        versions = {k: dict(v or {}) for k, v in (blob.get("_v") or {}).items()}
        for key, ids in stamps.items():
            for i in ids:
                versions.setdefault(key, {})[str(i)] = now
        blob["_v"] = versions
        self.pf._write_scope_blob(conn, self.scope, blob, now)

    @staticmethod
    def _next_id(rows: list) -> int:
        top = max([int(r.get("id") or 0) for r in rows if isinstance(r, dict) and str(r.get("id", "")).isdigit()]
                  + [SERVER_ID_FLOOR])
        return top + 1

    # ----------------------------------------------------------- project
    def project(self, create: bool = True) -> Optional[dict]:
        """The owner's project for this tender (created when missing)."""
        ref = canon(self.tender.get("tender_id"))
        with self._db() as conn:
            blob = self._blob(conn)
            projects = [p for p in (blob.get("projects") or []) if isinstance(p, dict)]
            for p in projects:
                if ref and canon(p.get("source_tender_id")) == ref:
                    return p
            if not create:
                return None
            now = time.time()
            t = self.tender
            project = {
                "id": self._next_id(projects),
                "title": t.get("title") or t.get("tender_id") or "Untitled project",
                "client_name": t.get("org_chain", "").split("||")[0] or t.get("website_name", ""),
                "source_tender_id": t.get("tender_id") or "",
                "source_tender_db_id": t.get("id"),
                "project_value": t.get("tender_value") or 0,
                "emd": t.get("emd") or 0,
                "deadline": t.get("closing_date") or None,
                "prebid": t.get("pre_bid_meeting_date") or None,
                "status": "Active",
                "description": t.get("work_description") or "",
            }
            blob["projects"] = projects + [project]
            # A project's tender stays bookmarked (API_CHANGES §1).
            self._save_blob(conn, blob, {"projects": [project["id"]]}, now)
            conn.commit()
            return project

    def checklist(self) -> list[dict]:
        p = self.project(create=False)
        if not p:
            return []
        with self._db() as conn:
            rows = self._blob(conn).get("checklist") or []
        return [r for r in rows if isinstance(r, dict) and str(r.get("project_id")) == str(p["id"])]

    def add_checklist_rows(self, items: list[dict]) -> list[dict]:
        """Adds Ready Docs rows (name, description); existing names are kept, not duplicated.
        Returns every requested row as it now exists (with ``added`` True for new ones)."""
        project = self.project()
        out: list[dict] = []
        with self._db() as conn:
            blob = self._blob(conn)
            rows = [r for r in (blob.get("checklist") or []) if isinstance(r, dict)]
            mine = [r for r in rows if str(r.get("project_id")) == str(project["id"])]
            by_name = {norm_name(r.get("req_file_name", "")): r for r in mine}
            new_ids: list[int] = []
            now = time.time()
            for item in items:
                name = " ".join(str(item.get("name") or "").split())[:200]
                if not name:
                    continue
                hit = by_name.get(norm_name(name))
                if hit:
                    out.append({**hit, "added": False})
                    continue
                row = {
                    "id": self._next_id(rows),
                    "project_id": project["id"],
                    "sr_no": len(mine) + 1,
                    "req_file_name": name,
                    "description": str(item.get("description") or "")[:400],
                    "subfolder": READY_SUBFOLDER,
                    "linked_file_path": "",
                    "status": "Pending",
                    "attachment": None,
                }
                rows.append(row)
                mine.append(row)
                by_name[norm_name(name)] = row
                new_ids.append(row["id"])
                out.append({**row, "added": True})
            if new_ids:
                blob["checklist"] = rows
                self._save_blob(conn, blob, {"checklist": new_ids}, now)
                conn.commit()
        return out

    # -------------------------------------------------------------- files
    def _folder_path(self, conn, blob: dict, project: dict, folder: str) -> str:
        base = "/".join((
            self.pf.tender_folder(project),
            self.pf.owner_folder(conn, self.account),
            self.pf.project_folder(project, str(project["id"])),
        ))
        return base + "/" + PREP_FOLDER if folder == "prep" else base

    def save_file(self, local_path: str, name: str, *, kind: str, folder: str,
                  checklist_item_id: Any = None, label: str = "", device: str = "bid-agent") -> dict:
        """Stores a file in the tender's project folder and records it in the manifest.
        ``folder`` is "prep" (Docs for Preparation), "ready" (attached to a checklist row) or
        "library" (the owner's reference documents, not tied to a tender)."""
        import app_core as core
        import storage_runtime

        library = folder == "library"
        project = {"id": "library", "title": LIBRARY_FOLDER} if library else self.project()
        name = self.pf.safe_file_name(name)
        prefix = "bidagent-ref" if library else "bidagent-prep"
        slot = str(checklist_item_id) if checklist_item_id is not None else f"{prefix}:{uuid.uuid4().hex[:12]}"
        now = time.time()
        with self._db() as conn:
            blob = self._blob(conn)
            folder_path = (f"{LIBRARY_ROOT}/{self.pf.owner_folder(conn, self.account)}" if library
                           else self._folder_path(conn, blob, project, folder))
            if checklist_item_id is not None:
                if self.pf.find_checklist_row(self.oa.effective_blob(conn, self.user_id, self.account)[0],
                                              checklist_item_id) is None:
                    raise ValueError("checklist row not found")
                existing = self.pf.active_file(conn, self.scope, slot)
                if existing:
                    return {"file": self.pf.public_file(existing), "attached": False, "reason": "row already has a file"}
                self.pf.drop_stale_reservation(conn, self.scope, slot, now)
                conn.commit()
            file_id = stored_name = None
            for candidate in self.pf.name_candidates(name):
                if self.pf.name_taken(conn, self.scope, str(project["id"]), candidate):
                    continue
                try:
                    cur = conn.execute(
                        "INSERT INTO client_project_files (scope, project_id, checklist_item_id, file_name, "
                        "stored_name, folder_path, mime_type, uploaded_by, uploaded_device, status, created_at) "
                        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        (self.scope, str(project["id"]), slot, name, candidate, folder_path,
                         mimetypes.guess_type(name)[0] or "application/octet-stream", self.user_id, device,
                         "uploading", now),
                    )
                    file_id, stored_name = int(cur.lastrowid), candidate
                    conn.commit()
                    break
                except core.sqlite3.IntegrityError:
                    conn.rollback() if hasattr(conn, "rollback") else None
                    existing = self.pf.active_file(conn, self.scope, slot)
                    if existing:
                        return {"file": self.pf.public_file(existing), "attached": False,
                                "reason": "row already has a file"}
            if file_id is None:
                raise RuntimeError("Too many files with this name in the project.")

        files_root = os.path.join(core.BASE_DOWNLOAD_DIRECTORY, "project-files")
        scratch = os.path.join(files_root, ".uploading", str(file_id))
        try:
            os.makedirs(scratch, exist_ok=True)
            staged = os.path.join(scratch, stored_name)
            shutil.copyfile(local_path, staged)
            with open(staged, "rb") as fh:
                digest = hashlib.sha256(fh.read()).hexdigest()
            size = os.path.getsize(staged)
            storage = storage_runtime.active_document_storage()
            if not storage.remote:
                final_dir = os.path.join(files_root, *folder_path.split("/"))
                os.makedirs(final_dir, exist_ok=True)
                final = os.path.join(final_dir, stored_name)
                shutil.move(staged, final)
                staged = final
            stored = storage.persist(staged, folder_path, "project_file", self.pf.FILE_PREFIX,
                                     tag=folder_path.split("/", 1)[0])
        except BaseException:
            with self._db() as conn:
                conn.execute("DELETE FROM client_project_files WHERE id=?", (file_id,))
                conn.commit()
            shutil.rmtree(scratch, ignore_errors=True)
            raise
        shutil.rmtree(scratch, ignore_errors=True)
        done = time.time()
        with self._db() as conn:
            conn.execute(
                "UPDATE client_project_files SET status='active', storage_ref=?, size_bytes=?, sha256=?, "
                "uploaded_at=? WHERE id=?", (stored.reference, size, digest, done, file_id))
            row = self.pf.get_file(conn, file_id)
            if checklist_item_id is not None:
                self.pf.set_server_file(conn, self.scope, slot, self.pf.server_file_entry(row), done)
            conn.execute(
                "INSERT INTO bid_agent_files (owner_key, tender_db_id, tender_ref, project_id, file_id, name, kind, "
                "folder, checklist_item_id, label, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (self.scope, 0 if library else int(self.tender["id"]),
                 "" if library else str(self.tender.get("tender_id") or ""), str(project["id"]),
                 file_id, name, kind, LIBRARY_FOLDER if library else PREP_FOLDER if folder == "prep" else READY_SUBFOLDER,
                 str(checklist_item_id) if checklist_item_id is not None else None, label, self.user_id, done),
            )
            conn.commit()
        if not library:
            self.write_index()
        return {"file": self.pf.public_file(row), "attached": checklist_item_id is not None}

    def files(self, folder: Optional[str] = None) -> list[dict]:
        """Manifest rows (newest first) joined with the live file record."""
        with self._db() as conn:
            rows = conn.execute(
                "SELECT m.id, m.file_id, m.name, m.kind, m.folder, m.checklist_item_id, m.label, m.created_at, "
                "f.size_bytes, f.mime_type FROM bid_agent_files m JOIN client_project_files f ON f.id=m.file_id "
                "WHERE m.owner_key=? AND m.tender_db_id=? AND m.removed_at IS NULL AND f.trashed_at IS NULL "
                "ORDER BY m.id DESC", (self.scope, int(self.tender["id"]))).fetchall()
        cols = ["manifest_id", "file_id", "name", "kind", "folder", "checklist_item_id", "label", "created_at",
                "size", "type"]
        out = [dict(zip(cols, tuple(r))) for r in rows]
        if folder:
            want = PREP_FOLDER if folder == "prep" else READY_SUBFOLDER
            out = [r for r in out if r["folder"] == want]
        return out

    def template_rows(self, employer: str) -> tuple[str, list[dict]]:
        """Rows of the owner's checklist template for this employer (the apps' Templates page,
        matched by organisation), else a template named "Bid Agent default". -> (name, rows)."""
        with self._db() as conn:
            blob = self.oa.effective_blob(conn, self.user_id, self.account)[0]
        templates = [t for t in (blob.get("templates") or []) if isinstance(t, dict)]
        items = [i for i in (blob.get("templateItems") or []) if isinstance(i, dict)]
        emp = norm_name(employer)

        def match(t):
            org = norm_name(t.get("organization") or "")
            return bool(org) and bool(emp) and (org in emp or emp in org)

        pick = next((t for t in templates if match(t)), None) or \
            next((t for t in templates if norm_name(t.get("template_name") or "") == "bid agent default"), None)
        if not pick:
            return "", []
        rows = sorted((i for i in items if str(i.get("template_id")) == str(pick.get("id"))),
                      key=lambda i: int(i.get("sr_no") or 0))
        return str(pick.get("template_name") or "Template"), [
            {"name": i.get("req_file_name") or "", "description": i.get("description") or ""} for i in rows
            if i.get("req_file_name")]

    # ------------------------------------------------- reference documents
    def references(self) -> list[dict]:
        """The owner's reference documents (certificates, standard formats, previous bids)."""
        with self._db() as conn:
            rows = conn.execute(
                "SELECT m.file_id, m.name, m.label, m.created_at, f.size_bytes, f.mime_type, f.storage_ref "
                "FROM bid_agent_files m JOIN client_project_files f ON f.id=m.file_id "
                "WHERE m.owner_key=? AND m.folder=? AND m.removed_at IS NULL AND f.trashed_at IS NULL "
                "ORDER BY m.name", (self.scope, LIBRARY_FOLDER)).fetchall()
        cols = ["file_id", "name", "label", "created_at", "size", "type", "storage_ref"]
        return [dict(zip(cols, tuple(r))) for r in rows]

    def remove_reference(self, file_id: int) -> bool:
        with self._db() as conn:
            hit = conn.execute("SELECT id FROM bid_agent_files WHERE owner_key=? AND file_id=? AND folder=? "
                               "AND removed_at IS NULL", (self.scope, int(file_id), LIBRARY_FOLDER)).fetchone()
            if not hit:
                return False
            row = self.pf.get_file(conn, int(file_id))
            now = time.time()
            if row:
                self.pf.trash_file(conn, row, now)
            conn.execute("UPDATE bid_agent_files SET removed_at=? WHERE id=?", (now, hit[0]))
            conn.commit()
        return True

    def fetch_to(self, storage_ref: str, dest: str) -> str:
        """Copies a stored file (local or Drive) to ``dest``."""
        ref = str(storage_ref or "")
        if ref.startswith("gdrive://"):
            import drive_storage

            _meta, response = drive_storage.open_download(ref[len("gdrive://"):].split("/", 1)[0])
            with open(dest, "wb") as f:
                for chunk in drive_storage.iter_download_response(response):
                    f.write(chunk)
        else:
            shutil.copyfile(ref, dest)
        return dest

    def remove_prep_file(self, file_id: int) -> bool:
        with self._db() as conn:
            hit = conn.execute(
                "SELECT m.id FROM bid_agent_files m WHERE m.owner_key=? AND m.tender_db_id=? AND m.file_id=? "
                "AND m.folder=? AND m.removed_at IS NULL", (self.scope, int(self.tender["id"]), int(file_id),
                                                              PREP_FOLDER)).fetchone()
            if not hit:
                return False
            row = self.pf.get_file(conn, int(file_id))
            now = time.time()
            if row:
                self.pf.trash_file(conn, row, now)
            conn.execute("UPDATE bid_agent_files SET removed_at=? WHERE id=?", (now, hit[0]))
            conn.commit()
        self.write_index()
        return True

    def attach_matching(self, saved: list[dict]) -> list[dict]:
        """Attach freshly saved files to checklist rows that name them (form code or name)."""
        rows = self.checklist()
        attached = []
        for item in saved:
            key = item.get("match") or ""
            if not key:
                continue
            for row in rows:
                if row.get("server_file"):
                    continue
                if norm_name(key) and norm_name(key) in norm_name(row.get("req_file_name", "")):
                    r = self.save_file(item["path"], item["name"], kind=item["kind"], folder="ready",
                                       checklist_item_id=row["id"], label=item.get("label", ""))
                    if r.get("attached"):
                        attached.append({"row": row["req_file_name"], "file": item["name"]})
                        row["server_file"] = r["file"]
                    break
        return attached

    def write_index(self) -> None:
        """Best-effort 'Bid Agent index.json' in the project folder: the file → folder → row key."""
        try:
            import app_core as core
            import storage_runtime

            project = self.project(create=False)
            if not project:
                return
            with self._db() as conn:
                folder_path = self._folder_path(conn, self._blob(conn), project, "ready")
            data = {
                "tender_id": self.tender.get("tender_id"),
                "tender_db_id": self.tender.get("id"),
                "project_id": project["id"],
                "project_title": project.get("title"),
                "owner": self.scope,
                "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "folders": {READY_SUBFOLDER: folder_path, PREP_FOLDER: folder_path + "/" + PREP_FOLDER},
                "files": [
                    {k: f[k] for k in ("file_id", "name", "kind", "folder", "checklist_item_id", "label")}
                    | {"created_at": time.strftime("%Y-%m-%d %H:%M", time.localtime(f["created_at"] or 0))}
                    for f in self.files()
                ],
            }
            tmp = tempfile.mkdtemp(prefix="bididx_")
            path = os.path.join(tmp, INDEX_NAME)
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(data, fh, indent=2, ensure_ascii=False)
            storage = storage_runtime.active_document_storage()
            if storage.remote:
                storage.persist(path, folder_path, "bid_agent_index", self.pf.FILE_PREFIX,
                                tag=folder_path.split("/", 1)[0])
            else:
                final_dir = os.path.join(core.BASE_DOWNLOAD_DIRECTORY, "project-files", *folder_path.split("/"))
                os.makedirs(final_dir, exist_ok=True)
                shutil.copyfile(path, os.path.join(final_dir, INDEX_NAME))
            shutil.rmtree(tmp, ignore_errors=True)
        except Exception as e:  # the index is a convenience; never fail the save
            print(f"[bid-agent] index not written: {e}")
