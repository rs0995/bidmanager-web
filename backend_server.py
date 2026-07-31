"""
Electron backend launcher.

Runs FastAPI app from backend/api_server.py on a fixed localhost port.
Used by Electron in packaged mode.
"""

import os
import sys
import traceback
from datetime import datetime


def _project_root() -> str:
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(sys.executable)))
    return os.path.dirname(os.path.abspath(__file__))


ROOT = _project_root()
BACKEND_DIR = os.path.join(ROOT, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


def _log_startup(message: str) -> None:
    log_dir = os.path.join(
        os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"),
        "BidManager",
    )
    try:
        os.makedirs(log_dir, exist_ok=True)
        with open(os.path.join(log_dir, "backend-startup.log"), "a", encoding="utf-8") as log_file:
            timestamp = datetime.now().isoformat(timespec="seconds")
            log_file.write(f"[{timestamp}] {message.rstrip()}\n")
    except Exception:
        pass


def main() -> None:
    _log_startup(f"Starting backend from {sys.executable}")
    from api_server import app
    import uvicorn

    port = int(os.environ.get("BIDMANAGER_PORT", "8000"))
    _log_startup(f"Backend imports complete; listening on port {port}")
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        access_log=False,
        log_config=None,
    )


if __name__ == "__main__":
    try:
        main()
    except BaseException:
        _log_startup(traceback.format_exc())
        raise
