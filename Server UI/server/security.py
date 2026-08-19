"""Security policy helpers for the BidManager API.

This module deliberately has no FastAPI or application imports so its policy can
be tested without starting the scraper, opening a database, or touching files.
"""

from __future__ import annotations

import hmac
import ipaddress
import base64
import hashlib
import json
import os
import re
import secrets
import time
from collections.abc import Mapping
from typing import Any


_LOCAL_ENVIRONMENTS = {"local", "dev", "development", "test"}
_CLOUD_ENVIRONMENTS = {"staging", "stage", "production", "prod"}
_SAFE_HTTP_METHODS = {"GET", "HEAD", "OPTIONS"}
_MUTATING_GET_PATHS = (
    re.compile(r"^/v1/data/clear/?$"),
    re.compile(r"^/v1/tenders/[^/]+/download/?$"),
    re.compile(r"^/v1/projects/[^/]+/fetch-from-active/?$"),
    re.compile(r"^/v1/projects/[^/]+/check-corrigendum/?$"),
    re.compile(r"^/v1/websites/[^/]+/tenders/download/?$"),
    re.compile(r"^/v1/projects/restore-from-folders/?$"),
)
_SENSITIVE_SETTING_MARKERS = ("api_key", "secret", "password", "private_key", "token")
_CLOUD_LOCAL_PATH_KEYS = {
    "parent_dir",
    "db_file",
    "projects_dir",
    "download_dir",
    "template_dir",
    "update_directory",
}
_EPHEMERAL_DOWNLOAD_SECRET = secrets.token_bytes(32)


def deployment_environment(environ: Mapping[str, str] | None = None) -> str:
    env = environ if environ is not None else os.environ
    raw = str(env.get("BIDMANAGER_ENV", "") or "").strip().lower()
    # Cloud Run must never acquire localhost's trust policy, even through a
    # mistaken BIDMANAGER_ENV value.
    if str(env.get("K_SERVICE", "") or "").strip():
        return "staging" if raw in {"stage", "staging"} else "production"
    if raw in _LOCAL_ENVIRONMENTS:
        return "local"
    if raw in {"stage", "staging"}:
        return "staging"
    if raw in {"prod", "production"}:
        return "production"
    return "local"


def is_cloud_environment(environ: Mapping[str, str] | None = None) -> bool:
    return deployment_environment(environ) in _CLOUD_ENVIRONMENTS


def is_loopback_host(host: str | None) -> bool:
    value = str(host or "").strip().strip("[]")
    if not value:
        return False
    if value.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(value).is_loopback
    except ValueError:
        return False


def secure_equals(provided: str | None, expected: str | None) -> bool:
    left = str(provided or "").encode("utf-8")
    right = str(expected or "").encode("utf-8")
    return bool(right) and hmac.compare_digest(left, right)


def _download_token_secret(environ: Mapping[str, str] | None = None) -> bytes:
    env = environ if environ is not None else os.environ
    configured = str(
        env.get("BIDMANAGER_DOWNLOAD_TOKEN_SECRET", "")
        or env.get("ADMIN_API_KEY", "")
        or ""
    ).strip()
    return configured.encode("utf-8") if configured else _EPHEMERAL_DOWNLOAD_SECRET


def create_download_token(
    path: str,
    ttl_seconds: int,
    *,
    now: float | None = None,
    environ: Mapping[str, str] | None = None,
) -> tuple[str, int]:
    expires = int(now if now is not None else time.time()) + max(1, int(ttl_seconds))
    payload = json.dumps(
        {"exp": expires, "path": str(path or "")}, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    encoded = base64.urlsafe_b64encode(payload).rstrip(b"=")
    signature = hmac.new(_download_token_secret(environ), encoded, hashlib.sha256).digest()
    token = encoded + b"." + base64.urlsafe_b64encode(signature).rstrip(b"=")
    return token.decode("ascii"), expires


def verify_download_token(
    token: str,
    path: str,
    *,
    now: float | None = None,
    environ: Mapping[str, str] | None = None,
) -> bool:
    try:
        encoded, supplied_signature = str(token or "").encode("ascii").split(b".", 1)
        padding = b"=" * (-len(supplied_signature) % 4)
        signature = base64.urlsafe_b64decode(supplied_signature + padding)
        expected = hmac.new(_download_token_secret(environ), encoded, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            return False
        payload_padding = b"=" * (-len(encoded) % 4)
        payload = json.loads(base64.urlsafe_b64decode(encoded + payload_padding))
        current = int(now if now is not None else time.time())
        return int(payload.get("exp") or 0) >= current and hmac.compare_digest(
            str(payload.get("path") or ""), str(path or "")
        )
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return False


def is_v1_mutation(method: str, path: str) -> bool:
    normalized_method = str(method or "GET").upper()
    normalized_path = str(path or "")
    if normalized_method not in _SAFE_HTTP_METHODS:
        return normalized_path.startswith("/v1/")
    if normalized_method != "GET":
        return False
    return any(pattern.fullmatch(normalized_path) for pattern in _MUTATING_GET_PATHS)


def redact_public_settings(settings: Mapping[str, Any], *, cloud: bool) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for raw_key, value in settings.items():
        key = str(raw_key)
        lowered = key.lower()
        if any(marker in lowered for marker in _SENSITIVE_SETTING_MARKERS):
            continue
        if cloud and lowered in _CLOUD_LOCAL_PATH_KEYS:
            continue
        result[key] = value
    return result
