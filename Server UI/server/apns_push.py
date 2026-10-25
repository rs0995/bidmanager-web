"""Direct APNs push -- not Expo's push relay, not FCM.

Sends straight to Apple's HTTP/2 push gateway using a token-based (.p8) auth
key, the way most production apps do it. This is what makes a notification
arrive even when the app has been force-quit or the device is in Low Power
Mode: the OS wakes briefly for the push itself, which doesn't touch the
app's own background-execution budget at all (unlike BackgroundFetch, see
backgroundSync.js on the client, which genuinely cannot do this).

Configuration (all required; read once and cached -- see _config()):
    APNS_KEY_PATH     path to the .p8 Auth Key file (Apple Developer > Keys,
                      "Apple Push Notifications service (APNs)" enabled;
                      different from the App Store Connect API key already
                      used for TestFlight uploads)
    APNS_KEY_ID       the 10-character Key ID for that .p8 file
    APNS_TEAM_ID      Apple Developer Team ID (same team already in use)
    APNS_TOPIC        the app's bundle id, e.g. com.raku.s0995.bidmanager-mobile
    APNS_ENVIRONMENT  "production" (default) or "sandbox" (Xcode debug builds
                      register with Apple's sandbox APNs, not production)

Optional:
    APNS_TOPIC_BIDWISE  bundle id of the Bidwise app (default
                        com.raku.s0995.bidwise). One team .p8 key signs for
                        every app of the team, so only the topic differs.

Each device token is stored with the app it belongs to ("bmpro" or
"bidwise") and its APNs environment; send() takes both, so BM Pro and Bidwise
tokens each go out with their own topic (a token sent with another app's
topic comes back DeviceTokenNotForTopic and would be deleted).

If APNS_KEY_PATH is unset, every send is a silent no-op (logged once) so a
server without push configured keeps working -- the scheduler pass that
calls this module (api_server.py) must stay functional either way.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Optional

import httpx
import jwt

APPS = ("bmpro", "bidwise")
_DEFAULT_BIDWISE_TOPIC = "com.raku.s0995.bidwise"

_PROD_HOST = "https://api.push.apple.com"
_SANDBOX_HOST = "https://api.sandbox.push.apple.com"
_TOKEN_LIFETIME_SECONDS = 50 * 60  # Apple tokens are valid ~1h; refresh early.

_warned_unconfigured = False
_cached_token: Optional[str] = None
_cached_token_at = 0.0


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def _config() -> Optional[dict[str, str]]:
    key_path = _env("APNS_KEY_PATH")
    key_id = _env("APNS_KEY_ID")
    team_id = _env("APNS_TEAM_ID")
    topic = _env("APNS_TOPIC")
    if not (key_path and key_id and team_id and topic):
        global _warned_unconfigured
        if not _warned_unconfigured:
            _warned_unconfigured = True
            import app_core as core

            core.log_to_gui(
                "[apns_push] Not configured (APNS_KEY_PATH/APNS_KEY_ID/APNS_TEAM_ID/APNS_TOPIC "
                "settings) -- push notifications will not be sent."
            )
        return None
    environment = _env("APNS_ENVIRONMENT") or "production"
    return {
        "key_path": key_path, "key_id": key_id, "team_id": team_id,
        "topic": topic, "environment": environment,
        "topic_bidwise": _env("APNS_TOPIC_BIDWISE") or _DEFAULT_BIDWISE_TOPIC,
    }


def topic_for(cfg: dict[str, str], app: str) -> str:
    """Bundle id to send a token's pushes to: Bidwise's, else BM Pro's."""
    return cfg["topic_bidwise"] if app == "bidwise" else cfg["topic"]


def _auth_token(cfg: dict[str, str]) -> str:
    global _cached_token, _cached_token_at
    now = time.time()
    if _cached_token and (now - _cached_token_at) < _TOKEN_LIFETIME_SECONDS:
        return _cached_token
    private_key = Path(cfg["key_path"]).read_text()
    token = jwt.encode(
        {"iss": cfg["team_id"], "iat": int(now)},
        private_key,
        algorithm="ES256",
        headers={"kid": cfg["key_id"]},
    )
    _cached_token = token
    _cached_token_at = now
    return token


class PushResult:
    def __init__(self, ok: bool, should_delete_token: bool = False, error: str = ""):
        self.ok = ok
        self.should_delete_token = should_delete_token
        self.error = error


# APNs reasons that mean the token itself is dead and the row should be
# removed, as opposed to a transient failure worth retrying next pass.
_DEAD_TOKEN_REASONS = {"BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"}


def send(
    device_token: str,
    *,
    title: str,
    body: str,
    badge: Optional[int] = None,
    category: str = "",
    thread_id: str = "",
    extra: Optional[dict[str, Any]] = None,
    app: str = "bmpro",
    environment: Optional[str] = None,
    collapse_id: Optional[str] = None,
) -> PushResult:
    """Send one push. Never raises -- callers (the scheduler pass) iterate many
    devices per run and one bad token must not abort the rest."""
    cfg = _config()
    if not cfg:
        return PushResult(ok=False, error="apns_not_configured")

    alert: dict[str, Any] = {"title": title, "body": body}
    # Without this, Focus/Sleep modes that don't have this app explicitly
    # allowed silently route the notification straight into Notification
    # Center -- delivered, but invisible until the phone is unlocked and
    # checked by hand, which is indistinguishable from "it never arrived"
    # from the user's side. Requires the device to have granted the
    # time-sensitive authorization option (see notifications.js /
    # pushToken.js); if it hasn't, iOS just treats this the same as a normal
    # notification, so this is always safe to send.
    aps: dict[str, Any] = {"alert": alert, "sound": "default", "interruption-level": "time-sensitive"}
    if badge is not None:
        aps["badge"] = max(0, int(badge))
    if category:
        aps["category"] = category
    if thread_id:
        aps["thread-id"] = thread_id
    payload: dict[str, Any] = {"aps": aps}
    if extra:
        payload.update(extra)

    # The token's own environment (a Debug build registers a sandbox token),
    # else the server-wide setting.
    env = (environment or cfg["environment"] or "production").strip().lower()
    host = _PROD_HOST if env == "production" else _SANDBOX_HOST
    url = f"{host}/3/device/{device_token}"
    headers = {
        "authorization": f"bearer {_auth_token(cfg)}",
        "apns-topic": topic_for(cfg, app),
        "apns-push-type": "alert",
        "apns-priority": "10",
    }
    # Same id = iOS replaces the earlier notification instead of adding another
    # (grouped "new tenders under ORG" pushes). Apple allows at most 64 bytes.
    if collapse_id:
        headers["apns-collapse-id"] = collapse_id[:64]
    try:
        with httpx.Client(http2=True, timeout=10.0) as client:
            response = client.post(url, headers=headers, content=json.dumps(payload))
    except Exception as exc:  # network error, timeout, etc. -- transient
        return PushResult(ok=False, error=str(exc))

    if response.status_code == 200:
        return PushResult(ok=True)

    reason = ""
    try:
        reason = str(response.json().get("reason") or "")
    except Exception:
        pass
    return PushResult(
        ok=False,
        should_delete_token=reason in _DEAD_TOKEN_REASONS,
        error=reason or f"http_{response.status_code}",
    )
