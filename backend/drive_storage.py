import json
import os
from functools import lru_cache
from typing import Optional


DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder"


def using_drive_storage() -> bool:
    return bool(os.getenv("GOOGLE_DRIVE_FOLDER_ID", "").strip())


def _credentials():
    from google.oauth2 import service_account

    scopes = ["https://www.googleapis.com/auth/drive.file"]
    raw_json = os.getenv("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON", "").strip()
    if raw_json:
        return service_account.Credentials.from_service_account_info(json.loads(raw_json), scopes=scopes)

    credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if credentials_path:
        return service_account.Credentials.from_service_account_file(credentials_path, scopes=scopes)

    raise RuntimeError("Google Drive storage requires GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.")


@lru_cache(maxsize=1)
def _drive_service():
    from googleapiclient.discovery import build

    return build("drive", "v3", credentials=_credentials(), cache_discovery=False)


def _escape_drive_query(value: str) -> str:
    return str(value or "").replace("\\", "\\\\").replace("'", "\\'")


def _find_child_folder(parent_id: str, name: str) -> Optional[str]:
    service = _drive_service()
    query = (
        f"'{_escape_drive_query(parent_id)}' in parents "
        f"and name='{_escape_drive_query(name)}' "
        f"and mimeType='{DRIVE_FOLDER_MIME}' "
        "and trashed=false"
    )
    result = service.files().list(q=query, spaces="drive", fields="files(id,name)", pageSize=1).execute()
    files = result.get("files") or []
    if files:
        return files[0]["id"]
    return None


def _ensure_child_folder(parent_id: str, name: str) -> str:
    existing = _find_child_folder(parent_id, name)
    if existing:
        return existing
    service = _drive_service()
    metadata = {
        "name": name,
        "mimeType": DRIVE_FOLDER_MIME,
        "parents": [parent_id],
    }
    created = service.files().create(body=metadata, fields="id").execute()
    return created["id"]


def upload_file(local_path: str, tender_id: str = "", file_type: str = "document") -> str:
    root_folder_id = os.getenv("GOOGLE_DRIVE_FOLDER_ID", "").strip()
    if not root_folder_id:
        raise RuntimeError("GOOGLE_DRIVE_FOLDER_ID is not configured.")

    file_name = os.path.basename(local_path)
    parent_id = root_folder_id
    tender_folder = str(tender_id or "").strip()
    if tender_folder:
        parent_id = _ensure_child_folder(root_folder_id, tender_folder)

    from googleapiclient.http import MediaFileUpload

    metadata = {
        "name": file_name,
        "parents": [parent_id],
        "appProperties": {
            "bidmanager_tender_id": tender_folder,
            "bidmanager_file_type": str(file_type or "document"),
        },
    }
    media = MediaFileUpload(local_path, resumable=True)
    created = _drive_service().files().create(
        body=metadata,
        media_body=media,
        fields="id,name,webViewLink",
    ).execute()
    return f"gdrive://{created['id']}"
