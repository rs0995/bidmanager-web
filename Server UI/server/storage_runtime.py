"""Runtime filesystem and durable document-storage adapters.

Cloud Run's writable filesystem is intentionally treated as scratch space. The
adapter keeps local desktop behavior unchanged while making Drive the durable
boundary whenever it is configured.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

import drive_storage


def is_cloud_runtime() -> bool:
    environment = str(os.getenv("BIDMANAGER_ENV", "") or "").strip().lower()
    return bool(os.getenv("K_SERVICE", "").strip()) or environment in {
        "staging",
        "stage",
        "production",
        "prod",
    }


def using_persistent_local_storage() -> bool:
    """Return true when cloud documents live on a mounted durable volume."""
    provider = str(os.getenv("BIDMANAGER_STORAGE_PROVIDER", "") or "").strip().lower()
    return provider in {"local-volume", "oci-block-volume"}


def runtime_root() -> str:
    configured = str(os.getenv("BIDMANAGER_RUNTIME_DIR", "") or "").strip()
    root = Path(configured) if configured else Path(tempfile.gettempdir()) / "bidmanager"
    root.mkdir(parents=True, exist_ok=True)
    return str(root.resolve())


def cloud_runtime_paths() -> dict[str, str]:
    root = Path(runtime_root())
    return {
        "db_file": str(root / "tender_manager.db"),
        "root_folder": str(root / "projects"),
        "download_folder": str(root / "downloads"),
        "template_folder": str(root / "templates"),
    }


@dataclass(frozen=True)
class StoredDocument:
    reference: str
    remove_local_copy: bool


class LocalDocumentStorage:
    remote = False

    def persist(self, local_path: str, tender_id: str, file_type: str, prefix: str) -> StoredDocument:
        return StoredDocument(reference=str(local_path), remove_local_copy=False)

    def exists(self, local_path: str, tender_id: str, file_name: str, prefix: str) -> bool:
        return os.path.isfile(local_path)

    def folder_reference(self, local_folder: str, tender_id: str, prefix: str) -> str:
        return str(local_folder)


class DriveDocumentStorage:
    remote = True

    def persist(self, local_path: str, tender_id: str, file_type: str, prefix: str) -> StoredDocument:
        reference = drive_storage.upload_file(
            local_path,
            tender_id=tender_id,
            file_type=file_type,
            prefix=prefix,
        )
        return StoredDocument(reference=reference, remove_local_copy=True)

    def exists(self, local_path: str, tender_id: str, file_name: str, prefix: str) -> bool:
        return drive_storage.file_exists(prefix, tender_id, file_name)

    def folder_reference(self, local_folder: str, tender_id: str, prefix: str) -> str:
        return drive_storage.folder_reference(prefix, tender_id, create=True)


def active_document_storage():
    if drive_storage.using_drive_storage():
        return DriveDocumentStorage()
    return LocalDocumentStorage()


def require_durable_cloud_storage() -> None:
    if (
        is_cloud_runtime()
        and not drive_storage.using_drive_storage()
        and not using_persistent_local_storage()
    ):
        raise RuntimeError(
            "Cloud mode requires Google Drive or BIDMANAGER_STORAGE_PROVIDER="
            "oci-block-volume/local-volume with BIDMANAGER_RUNTIME_DIR mounted persistently."
        )


def require_durable_cloud_database() -> None:
    if not is_cloud_runtime():
        return
    configured = any(
        str(os.getenv(name, "") or "").strip()
        for name in ("DATABASE_URL", "POSTGRES_URL", "POSTGRES_CONNECTION_STRING")
    )
    if not configured:
        raise RuntimeError(
            "Cloud mode requires DATABASE_URL (or POSTGRES_URL/POSTGRES_CONNECTION_STRING); "
            "refusing to start with an ephemeral SQLite database."
        )


def cleanup_scratch_folder(path: str) -> None:
    if not is_cloud_runtime() or using_persistent_local_storage():
        return
    target = Path(str(path or "")).resolve()
    root = Path(runtime_root()).resolve()
    if target == root or root not in target.parents:
        return
    if target.is_dir():
        shutil.rmtree(target, ignore_errors=True)
