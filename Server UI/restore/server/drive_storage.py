import json
import os
from functools import lru_cache
from typing import Any, Iterator, Optional
from urllib.parse import quote


DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder"


def using_drive_storage() -> bool:
    return bool(os.getenv("GOOGLE_DRIVE_FOLDER_ID", "").strip())


def _credentials():
    from google.oauth2 import service_account

    # This worker traverses a pre-existing folder shared directly with its
    # service account (there is no Google Picker flow), so drive.file is not
    # sufficient. Drive permissions still constrain the account to items that
    # have actually been shared with it.
    scopes = ["https://www.googleapis.com/auth/drive"]
    raw_json = os.getenv("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON", "").strip()
    if raw_json:
        return service_account.Credentials.from_service_account_info(json.loads(raw_json), scopes=scopes)

    credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if credentials_path:
        return service_account.Credentials.from_service_account_file(credentials_path, scopes=scopes)

    # Cloud Run exposes its attached service account through Application Default
    # Credentials, avoiding a long-lived JSON key in an environment variable.
    import google.auth

    credentials, _project = google.auth.default(scopes=scopes)
    return credentials


@lru_cache(maxsize=1)
def _drive_service():
    from googleapiclient.discovery import build

    return build("drive", "v3", credentials=_credentials(), cache_discovery=False)


def _escape_drive_query(value: str) -> str:
    return str(value or "").replace("\\", "\\\\").replace("'", "\\'")


def normalize_relative_path(path: str) -> str:
    raw = str(path or "").replace("\\", "/").strip().strip("/")
    parts = [part.strip() for part in raw.split("/") if part.strip()]
    if any(part in {".", ".."} or "\x00" in part for part in parts):
        raise ValueError("Invalid Drive path.")
    return "/".join(parts)


def _list_files(
    parent_id: str, *, name: str = "", folder_only: bool = False, file_only: bool = False
) -> list[dict[str, Any]]:
    service = _drive_service()
    query_parts = [f"'{_escape_drive_query(parent_id)}' in parents", "trashed=false"]
    if name:
        query_parts.append(f"name='{_escape_drive_query(name)}'")
    if folder_only:
        query_parts.append(f"mimeType='{DRIVE_FOLDER_MIME}'")
    elif file_only:
        query_parts.append(f"mimeType!='{DRIVE_FOLDER_MIME}'")
    page_token = None
    items: list[dict[str, Any]] = []
    while True:
        result = service.files().list(
            q=" and ".join(query_parts),
            spaces="drive",
            fields="nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)",
            pageSize=1000,
            pageToken=page_token,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        ).execute()
        items.extend(result.get("files") or [])
        page_token = result.get("nextPageToken")
        if not page_token:
            return items


def _find_child(
    parent_id: str, name: str, *, folder_only: bool = False, file_only: bool = False
) -> Optional[dict[str, Any]]:
    matches = _list_files(parent_id, name=name, folder_only=folder_only, file_only=file_only)
    if len(matches) > 1:
        raise ValueError(f"Drive path is ambiguous because '{name}' exists more than once.")
    return matches[0] if matches else None


def _find_child_folder(parent_id: str, name: str) -> Optional[str]:
    match = _find_child(parent_id, name, folder_only=True)
    return str(match["id"]) if match else None


def _ensure_child_folder(parent_id: str, name: str) -> str:
    name = normalize_relative_path(name)
    if not name or "/" in name:
        raise ValueError("Invalid Drive folder name.")
    existing = _find_child_folder(parent_id, name)
    if existing:
        return existing
    service = _drive_service()
    metadata = {
        "name": name,
        "mimeType": DRIVE_FOLDER_MIME,
        "parents": [parent_id],
    }
    created = service.files().create(
        body=metadata, fields="id", supportsAllDrives=True
    ).execute()
    return created["id"]


def ensure_folder_path(parent_id: str, path: str) -> str:
    folder_id = str(parent_id or "").strip()
    for part in normalize_relative_path(path).split("/"):
        if part:
            folder_id = _ensure_child_folder(folder_id, part)
    return folder_id


def resolve_path(path: str, *, require_folder: Optional[bool] = None) -> Optional[dict[str, Any]]:
    normalized = normalize_relative_path(path)
    parent_id = os.getenv("GOOGLE_DRIVE_FOLDER_ID", "").strip()
    if not parent_id:
        raise RuntimeError("GOOGLE_DRIVE_FOLDER_ID is not configured.")
    if not normalized:
        if require_folder is False:
            return None
        return {
            "id": parent_id,
            "name": "",
            "mimeType": DRIVE_FOLDER_MIME,
        }
    parts = normalized.split("/")
    item = None
    for index, part in enumerate(parts):
        must_be_folder = index < len(parts) - 1 or require_folder is True
        must_be_file = index == len(parts) - 1 and require_folder is False
        item = _find_child(
            parent_id, part, folder_only=must_be_folder, file_only=must_be_file
        )
        if not item:
            return None
        if must_be_folder and item.get("mimeType") != DRIVE_FOLDER_MIME:
            return None
        parent_id = str(item["id"])
    if require_folder is False and item and item.get("mimeType") == DRIVE_FOLDER_MIME:
        return None
    return item


def list_folder(path: str = "") -> list[dict[str, Any]]:
    folder = resolve_path(path, require_folder=True)
    if not folder:
        raise ValueError("Drive folder not found.")
    return _list_files(str(folder["id"]))


def document_path(prefix: str, tender_id: str, file_name: str = "") -> str:
    parts = [normalize_relative_path(value) for value in (prefix, tender_id, file_name) if str(value or "").strip()]
    return "/".join(part for part in parts if part)


def file_exists(prefix: str, tender_id: str, file_name: str) -> bool:
    return bool(resolve_path(document_path(prefix, tender_id, file_name), require_folder=False))


def folder_reference(prefix: str, tender_id: str, *, create: bool = False) -> str:
    root_id = os.getenv("GOOGLE_DRIVE_FOLDER_ID", "").strip()
    if not root_id:
        raise RuntimeError("GOOGLE_DRIVE_FOLDER_ID is not configured.")
    path = document_path(prefix, tender_id)
    if create:
        folder_id = ensure_folder_path(root_id, path)
    else:
        folder = resolve_path(path, require_folder=True)
        if not folder:
            raise ValueError("Drive folder not found.")
        folder_id = str(folder["id"])
    return f"gdrive://{folder_id}"


def walk_folder(path: str = "") -> list[tuple[str, dict[str, Any]]]:
    normalized = normalize_relative_path(path)
    output: list[tuple[str, dict[str, Any]]] = []
    pending = [normalized]
    while pending:
        current = pending.pop()
        for item in list_folder(current):
            item_path = document_path(current, str(item.get("name") or ""))
            output.append((item_path, item))
            if item.get("mimeType") == DRIVE_FOLDER_MIME:
                pending.append(item_path)
    return output


def id_from_reference(reference: str) -> str:
    value = str(reference or "").strip()
    return value[len("gdrive://") :] if value.startswith("gdrive://") else ""


def reference_exists(reference: str) -> bool:
    file_id = id_from_reference(reference)
    if not file_id:
        return False
    try:
        item = _drive_service().files().get(
            fileId=file_id,
            fields="id,trashed",
            supportsAllDrives=True,
        ).execute()
        return bool(item.get("id")) and not bool(item.get("trashed"))
    except Exception:
        return False


def ensure_reference_path(path: str, children: tuple[str, ...] = ()) -> str:
    root_id = os.getenv("GOOGLE_DRIVE_FOLDER_ID", "").strip()
    if not root_id:
        raise RuntimeError("GOOGLE_DRIVE_FOLDER_ID is not configured.")
    folder_id = ensure_folder_path(root_id, path)
    for child in children:
        _ensure_child_folder(folder_id, child)
    return f"gdrive://{folder_id}"


def ensure_child_reference(parent_reference: str, name: str) -> str:
    parent_id = id_from_reference(parent_reference)
    if not parent_id:
        raise ValueError("Invalid Google Drive folder reference.")
    return f"gdrive://{_ensure_child_folder(parent_id, name)}"


def copy_folder_contents(source_reference: str, destination_reference: str) -> int:
    source_id = id_from_reference(source_reference)
    destination_id = id_from_reference(destination_reference)
    if not source_id or not destination_id:
        return 0
    copied = 0
    for item in _list_files(source_id):
        name = str(item.get("name") or "")
        if item.get("mimeType") == DRIVE_FOLDER_MIME:
            child_destination = _ensure_child_folder(destination_id, name)
            copied += copy_folder_contents(
                f"gdrive://{item['id']}", f"gdrive://{child_destination}"
            )
            continue
        if _find_child(destination_id, name, file_only=True):
            continue
        _drive_service().files().copy(
            fileId=item["id"],
            body={"name": name, "parents": [destination_id]},
            fields="id",
            supportsAllDrives=True,
        ).execute()
        copied += 1
    return copied


def upload_file(
    local_path: str,
    tender_id: str = "",
    file_type: str = "document",
    prefix: str = "",
    folder_id: str = "",
) -> str:
    root_folder_id = str(folder_id or "").strip() or os.getenv("GOOGLE_DRIVE_FOLDER_ID", "").strip()
    if not root_folder_id:
        raise RuntimeError("GOOGLE_DRIVE_FOLDER_ID is not configured.")

    file_name = os.path.basename(local_path)
    parent_id = ensure_folder_path(root_folder_id, prefix)
    tender_folder = str(tender_id or "").strip()
    if tender_folder:
        parent_id = ensure_folder_path(parent_id, tender_folder)

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
    existing = _find_child(parent_id, file_name, file_only=True)
    if existing:
        updated = _drive_service().files().update(
            fileId=existing["id"],
            body={"appProperties": metadata["appProperties"]},
            media_body=media,
            fields="id,name,webViewLink",
            supportsAllDrives=True,
        ).execute()
        return f"gdrive://{updated['id']}"
    created = _drive_service().files().create(
        body=metadata,
        media_body=media,
        fields="id,name,webViewLink",
        supportsAllDrives=True,
    ).execute()
    return f"gdrive://{created['id']}"


def open_download(file_id: str):
    """Return Drive metadata and an authenticated streaming HTTP response."""
    from google.auth.transport.requests import AuthorizedSession

    service = _drive_service()
    metadata = service.files().get(
        fileId=file_id,
        fields="id,name,mimeType,size",
        supportsAllDrives=True,
    ).execute()
    mime_type = str(metadata.get("mimeType") or "application/octet-stream")
    if mime_type == DRIVE_FOLDER_MIME:
        raise ValueError("Folders cannot be downloaded as files.")
    if mime_type.startswith("application/vnd.google-apps."):
        raise ValueError("Native Google Workspace files must be exported from Google Drive.")
    url = f"https://www.googleapis.com/drive/v3/files/{quote(str(file_id), safe='')}"
    response = AuthorizedSession(_credentials()).get(
        url,
        params={"alt": "media", "supportsAllDrives": "true"},
        stream=True,
        timeout=120,
    )
    response.raise_for_status()
    return metadata, response


def iter_download_response(response, chunk_size: int = 1024 * 1024) -> Iterator[bytes]:
    try:
        for chunk in response.iter_content(chunk_size=chunk_size):
            if chunk:
                yield chunk
    finally:
        response.close()
