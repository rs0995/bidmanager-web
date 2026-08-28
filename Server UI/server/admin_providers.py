import os
import shutil
import sqlite3
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

import app_core as core
import security
import storage_runtime

try:
    import db_compat
except Exception:
    db_compat = None

try:
    import drive_storage
except Exception:
    drive_storage = None


class ComputeProvider(ABC):
    @abstractmethod
    def metadata(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def health(self) -> dict[str, Any]:
        raise NotImplementedError


class DatabaseProvider(ABC):
    @abstractmethod
    def metadata(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def stats(self) -> dict[str, Any]:
        raise NotImplementedError


class StorageProvider(ABC):
    @abstractmethod
    def metadata(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def list_items(self, prefix: str = "") -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def usage(self) -> dict[str, Any]:
        raise NotImplementedError


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def _database_url() -> str:
    return _env("DATABASE_URL") or _env("POSTGRES_URL") or _env("POSTGRES_CONNECTION_STRING")


def _safe_database_host(url: str) -> str:
    if not url:
        return str(core.DB_FILE)
    without_scheme = url.split("://", 1)[-1]
    without_auth = without_scheme.split("@", 1)[-1]
    return without_auth.split("/", 1)[0]


class FastApiComputeProvider(ComputeProvider):
    def metadata(self) -> dict[str, Any]:
        service = _env("K_SERVICE")
        revision = _env("K_REVISION")
        oci_region = _env("OCI_REGION")
        region = oci_region or _env("GOOGLE_CLOUD_REGION") or _env("GCP_REGION") or _env("CLOUD_RUN_REGION")
        if oci_region or _env("OCI_INSTANCE_ID"):
            provider_id, label = "oracle-cloud", "Oracle Cloud Infrastructure"
        elif service or revision:
            provider_id, label = "google-cloud-run", "Google Cloud Run"
        else:
            provider_id, label = "custom-api", "Custom API / FastAPI"
        service_url = _env("BIDMANAGER_PUBLIC_URL") or _env("CLOUD_RUN_SERVICE_URL")
        project_id = _env("GOOGLE_CLOUD_PROJECT") or _env("GCP_PROJECT")
        return {
            "kind": "compute",
            "provider": provider_id,
            "label": label,
            "service": service or "bidmanager-api",
            "revision": revision or "",
            "region": region or "",
            "project_id": project_id or "",
            "service_url": service_url,
            "supports": {
                "restart": False,
                "redeploy": False,
                "drain": True,
                "pause_scheduler": True,
            },
            "links": self._links(project_id, region, service),
        }

    def health(self) -> dict[str, Any]:
        metadata = self.metadata()
        storage = active_storage_provider().metadata()
        storage_ok = (
            not storage_runtime.is_cloud_runtime()
            or storage["provider"] == "google-drive"
            or storage_runtime.using_persistent_local_storage()
        )
        return {
            "status": "serving",
            "provider": metadata["provider"],
            "label": metadata["label"],
            "version": getattr(core, "APP_VERSION", "dev"),
            "revision": metadata.get("revision", ""),
            "region": metadata.get("region", ""),
            "service": metadata.get("service", ""),
            "supports": metadata.get("supports", {}),
            "checks": [
                {"name": "API", "state": "ok", "detail": "FastAPI process is responding"},
                {"name": "Database", "state": "ok", "detail": active_database_provider().metadata()["label"]},
                {
                    "name": "Storage",
                    "state": "ok" if storage_ok else "error",
                    "detail": storage["label"] if storage_ok else "Durable cloud storage is required",
                },
            ],
        }

    def _links(self, project_id: str, region: str, service: str) -> dict[str, str]:
        if not (project_id and region and service):
            return {}
        return {
            "console": (
                "https://console.cloud.google.com/run/detail/"
                f"{region}/{service}/metrics?project={project_id}"
            )
        }


class HybridDatabaseProvider(DatabaseProvider):
    def metadata(self) -> dict[str, Any]:
        url = _database_url()
        using_pg = bool(url) or bool(db_compat and db_compat.using_postgres())
        provider_id = _env("BIDMANAGER_DB_PROVIDER")
        if not provider_id:
            provider_id = "neon-postgres" if using_pg else "sqlite-local"
        return {
            "kind": "database",
            "provider": provider_id,
            "label": _provider_label(provider_id, "SQLite Local" if not using_pg else "Postgres"),
            "engine": "postgres" if using_pg else "sqlite",
            "host": _safe_database_host(url),
            "configured": using_pg,
        }

    def stats(self) -> dict[str, Any]:
        metadata = self.metadata()
        if metadata["engine"] == "postgres":
            return self._postgres_stats(metadata)
        return self._sqlite_stats(metadata)

    def vacuum(self) -> dict[str, Any]:
        metadata = self.metadata()
        if metadata["engine"] == "postgres":
            import psycopg

            with psycopg.connect(_database_url(), autocommit=True) as conn:
                with conn.cursor() as cur:
                    cur.execute("VACUUM")
            return {"ok": True, "engine": "postgres"}
        conn = sqlite3.connect(core.DB_FILE, isolation_level=None)
        try:
            conn.execute("VACUUM")
        finally:
            conn.close()
        return {"ok": True, "engine": "sqlite"}

    def backup(self) -> dict[str, Any]:
        metadata = self.metadata()
        if metadata["engine"] == "postgres":
            raise NotImplementedError(
                "Managed Postgres backup isn't available from this console yet "
                "(no pg_dump in this environment)."
            )
        src = Path(core.DB_FILE)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        dest = src.with_name(f"{src.stem}.{stamp}.bak")
        shutil.copy2(src, dest)
        return {"ok": True, "name": dest.name, "sizeBytes": dest.stat().st_size}

    def _list_sqlite_backups(self) -> list[dict[str, Any]]:
        src = Path(core.DB_FILE)
        if not src.exists():
            return []
        items = sorted(
            src.parent.glob(f"{src.stem}.*.bak"), key=lambda p: p.stat().st_mtime, reverse=True
        )
        return [
            {
                "id": item.stem,
                "at": datetime.fromtimestamp(item.stat().st_mtime, timezone.utc).isoformat(),
                "sizeBytes": item.stat().st_size,
                "kind": "manual",
            }
            for item in items[:10]
        ]

    def _sqlite_stats(self, metadata: dict[str, Any]) -> dict[str, Any]:
        db_path = Path(core.DB_FILE)
        tables = []
        with sqlite3.connect(core.DB_FILE) as conn:
            rows = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            ).fetchall()
            for (name,) in rows:
                try:
                    count = conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
                except Exception:
                    count = 0
                tables.append({"name": name, "rows": int(count), "sizeBytes": None})
        return {
            **metadata,
            "healthy": True,
            "sizeBytes": db_path.stat().st_size if db_path.exists() else 0,
            "tables": tables,
            "backups": self._list_sqlite_backups(),
            "checkedAt": datetime.now(timezone.utc).isoformat(),
        }

    def _postgres_stats(self, metadata: dict[str, Any]) -> dict[str, Any]:
        try:
            import psycopg

            with psycopg.connect(_database_url()) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT pg_database_size(current_database())")
                    size = int(cur.fetchone()[0])
                    cur.execute(
                        """
                        SELECT relname, COALESCE(n_live_tup, 0)::bigint,
                               pg_total_relation_size(relid)::bigint
                        FROM pg_stat_user_tables
                        ORDER BY relname
                        """
                    )
                    tables = [
                        {"name": row[0], "rows": int(row[1]), "sizeBytes": int(row[2])}
                        for row in cur.fetchall()
                    ]
            return {
                **metadata,
                "healthy": True,
                "sizeBytes": size,
                "tables": tables,
                "backups": [],
                "checkedAt": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as exc:
            return {
                **metadata,
                "healthy": False,
                "error": str(exc),
                "sizeBytes": 0,
                "tables": [],
                "backups": [],
                "checkedAt": datetime.now(timezone.utc).isoformat(),
            }


class HybridStorageProvider(StorageProvider):
    def metadata(self) -> dict[str, Any]:
        using_drive = bool(drive_storage and drive_storage.using_drive_storage())
        provider_id = _env("BIDMANAGER_STORAGE_PROVIDER")
        if not provider_id:
            provider_id = "google-drive" if using_drive else "local-volume"
        root = _env("GOOGLE_DRIVE_FOLDER_ID") if using_drive else str(core.BASE_DOWNLOAD_DIRECTORY)
        return {
            "kind": "storage",
            "provider": provider_id,
            "label": _provider_label(provider_id, "Google Drive" if using_drive else "Local / Volume"),
            "root": root,
            "configured": using_drive or storage_runtime.using_persistent_local_storage(),
        }

    def list_items(self, prefix: str = "") -> dict[str, Any]:
        metadata = self.metadata()
        if metadata["provider"] == "google-drive":
            return self._drive_list(metadata, prefix)
        return self._local_list(metadata, prefix)

    def usage(self) -> dict[str, Any]:
        metadata = self.metadata()
        if metadata["provider"] == "google-drive":
            return {**metadata, "usedBytes": None, "quotaBytes": None, "objects": None}
        root = Path(core.BASE_DOWNLOAD_DIRECTORY)
        used = 0
        objects = 0
        if root.exists():
            for item in root.rglob("*"):
                if item.is_file():
                    objects += 1
                    try:
                        used += item.stat().st_size
                    except OSError:
                        pass
        quota = None
        try:
            quota = shutil.disk_usage(root if root.exists() else ".").total
        except OSError:
            quota = None
        return {**metadata, "usedBytes": used, "quotaBytes": quota, "objects": objects}

    def _local_list(self, metadata: dict[str, Any], prefix: str) -> dict[str, Any]:
        root = Path(core.BASE_DOWNLOAD_DIRECTORY).resolve()
        target = (root / prefix).resolve()
        if root != target and root not in target.parents:
            raise ValueError("Storage path is outside the configured root.")
        folders = []
        files = []
        if target.exists():
            for item in sorted(target.iterdir(), key=lambda x: (x.is_file(), x.name.lower())):
                stat = item.stat()
                payload = {
                    "name": item.name,
                    "path": str(item.relative_to(root)).replace("\\", "/"),
                    "modified": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                }
                if item.is_dir():
                    folders.append({**payload, "items": len(list(item.iterdir())), "sizeBytes": None})
                else:
                    files.append({**payload, "sizeBytes": stat.st_size})
        return {**metadata, "prefix": prefix, "folders": folders, "files": files}

    def _resolve_local_target(self, path: str) -> Path:
        root = Path(core.BASE_DOWNLOAD_DIRECTORY).resolve()
        target = (root / (path or "")).resolve()
        if root != target and root not in target.parents:
            raise ValueError("Storage path is outside the configured root.")
        return target

    def create_folder(self, prefix: str, name: str) -> dict[str, Any]:
        metadata = self.metadata()
        safe_name = str(name or "").strip()
        if not safe_name or "/" in safe_name or "\\" in safe_name:
            raise ValueError("Invalid folder name.")
        if metadata["provider"] == "google-drive":
            parent_id = self._drive_folder_id_for_prefix(prefix)
            drive_storage._ensure_child_folder(parent_id, safe_name)
            return {"ok": True}
        target = self._resolve_local_target(str(Path(prefix or "") / safe_name))
        target.mkdir(parents=False, exist_ok=True)
        return {"ok": True}

    def delete(self, path: str) -> dict[str, Any]:
        metadata = self.metadata()
        normalized_path = str(path or "").replace("\\", "/").strip("/")
        if not normalized_path:
            raise ValueError("The configured storage root cannot be deleted.")
        if metadata["provider"] == "google-drive":
            file_id = self._drive_id_for_path(normalized_path)
            if not file_id:
                raise ValueError("Item not found.")
            drive_storage._drive_service().files().delete(
                fileId=file_id, supportsAllDrives=True
            ).execute()
            return {"ok": True}
        target = self._resolve_local_target(normalized_path)
        if not target.exists():
            raise ValueError("Item not found.")
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
        return {"ok": True}

    def signed_url(self, path: str, base_url: str = "", admin_key: str = "") -> dict[str, Any]:
        metadata = self.metadata()
        if metadata["provider"] == "google-drive":
            normalized_path = drive_storage.normalize_relative_path(path)
            if not drive_storage.resolve_path(normalized_path, require_folder=False):
                raise ValueError("File not found.")
        else:
            target = self._resolve_local_target(path)
            if not target.exists() or not target.is_file():
                raise ValueError("File not found.")
            normalized_path = str(path or "").replace("\\", "/").strip("/")
        ttl_minutes = core.setting_int("signed_url_ttl_min", 15, minimum=1, maximum=1440)
        token, expires = security.create_download_token(normalized_path, ttl_minutes * 60)
        url = (
            f"{base_url.rstrip('/')}/admin/storage/download?"
            f"path={quote(normalized_path)}&token={quote(token)}"
        )
        return {
            "url": url,
            "expires": datetime.fromtimestamp(expires, timezone.utc).isoformat(),
        }

    def _drive_id_for_path(self, path: str) -> Optional[str]:
        item = drive_storage.resolve_path(path)
        return str(item["id"]) if item and item.get("id") else None

    def _drive_folder_id_for_prefix(self, prefix: str) -> str:
        folder = drive_storage.resolve_path(prefix, require_folder=True)
        if not folder:
            raise ValueError("Drive folder not found.")
        return str(folder["id"])

    def _drive_list(self, metadata: dict[str, Any], prefix: str) -> dict[str, Any]:
        normalized_prefix = drive_storage.normalize_relative_path(prefix)
        items = drive_storage.list_folder(normalized_prefix)
        folders = []
        files = []
        for item in sorted(
            items,
            key=lambda value: (
                value.get("mimeType") != drive_storage.DRIVE_FOLDER_MIME,
                str(value.get("name") or "").lower(),
            ),
        ):
            name = str(item.get("name") or "")
            item_path = "/".join(part for part in (normalized_prefix, name) if part)
            payload = {
                "id": item.get("id"),
                "name": name,
                "path": item_path,
                "modified": item.get("modifiedTime"),
            }
            if item.get("mimeType") == drive_storage.DRIVE_FOLDER_MIME:
                folders.append({**payload, "items": None, "sizeBytes": None})
            else:
                files.append({**payload, "sizeBytes": int(item.get("size") or 0)})
        display_prefix = f"{normalized_prefix}/" if normalized_prefix else ""
        return {**metadata, "prefix": display_prefix, "folders": folders, "files": files}


def _provider_label(provider_id: str, fallback: str) -> str:
    labels = {
        "google-cloud-run": "Google Cloud Run",
        "custom-api": "Custom API",
        "neon-postgres": "Neon Postgres",
        "supabase-postgres": "Supabase Postgres",
        "cloud-sql": "Cloud SQL",
        "railway-postgres": "Railway Postgres",
        "sqlite-local": "SQLite Local",
        "google-drive": "Google Drive",
        "cloud-storage": "Cloud Storage",
        "s3-r2": "S3 / R2",
        "local-volume": "Local / Volume",
    }
    return labels.get(provider_id, fallback)


def active_compute_provider() -> ComputeProvider:
    return FastApiComputeProvider()


def active_database_provider() -> DatabaseProvider:
    return HybridDatabaseProvider()


def active_storage_provider() -> StorageProvider:
    return HybridStorageProvider()


def active_providers() -> dict[str, Any]:
    return {
        "compute": active_compute_provider().metadata(),
        "database": active_database_provider().metadata(),
        "storage": active_storage_provider().metadata(),
    }
