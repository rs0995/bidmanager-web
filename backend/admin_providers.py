import os
import sqlite3
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import app_core as core

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
        region = _env("GOOGLE_CLOUD_REGION") or _env("GCP_REGION") or _env("CLOUD_RUN_REGION")
        provider_id = "google-cloud-run" if service or revision else "custom-api"
        label = "Google Cloud Run" if provider_id == "google-cloud-run" else "Custom API / FastAPI"
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
                {"name": "Storage", "state": "ok", "detail": active_storage_provider().metadata()["label"]},
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
                "checkedAt": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as exc:
            return {
                **metadata,
                "healthy": False,
                "error": str(exc),
                "sizeBytes": 0,
                "tables": [],
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
            "configured": using_drive,
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
        return {**metadata, "usedBytes": used, "quotaBytes": None, "objects": objects}

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

    def _drive_list(self, metadata: dict[str, Any], prefix: str) -> dict[str, Any]:
        try:
            service = drive_storage._drive_service()
            folder_id = _env("GOOGLE_DRIVE_FOLDER_ID")
            result = service.files().list(
                q=f"'{folder_id}' in parents and trashed=false",
                spaces="drive",
                fields="files(id,name,mimeType,size,modifiedTime,webViewLink)",
                pageSize=100,
            ).execute()
            folders = []
            files = []
            for item in result.get("files") or []:
                payload = {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "path": item.get("name"),
                    "modified": item.get("modifiedTime"),
                    "url": item.get("webViewLink"),
                }
                if item.get("mimeType") == drive_storage.DRIVE_FOLDER_MIME:
                    folders.append({**payload, "items": None, "sizeBytes": None})
                else:
                    files.append({**payload, "sizeBytes": int(item.get("size") or 0)})
            return {**metadata, "prefix": prefix, "folders": folders, "files": files}
        except Exception as exc:
            return {**metadata, "prefix": prefix, "folders": [], "files": [], "error": str(exc)}


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
