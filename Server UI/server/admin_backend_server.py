"""
Electron backend launcher for the BidManager Control admin console.

Runs the FastAPI app from api_server.py (this folder) on a fixed localhost
port. Used by Server UI/electron in packaged mode. Mirrors the main app's
backend_server.py, pointed at this standalone admin-console backend instead.
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
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def _log_startup(message: str) -> None:
    log_dir = os.path.join(
        os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"),
        "BidManagerControl",
    )
    try:
        os.makedirs(log_dir, exist_ok=True)
        with open(os.path.join(log_dir, "admin-backend-startup.log"), "a", encoding="utf-8") as log_file:
            timestamp = datetime.now().isoformat(timespec="seconds")
            log_file.write(f"[{timestamp}] {message.rstrip()}\n")
    except Exception:
        pass


def main() -> None:
    _log_startup(f"Starting admin backend from {sys.executable}")
    from api_server import app
    import uvicorn

    try:
        import app_core
        if app_core.ensure_scraper_dependencies():
            _log_startup("Scraper dependencies OK")
        else:
            _log_startup(f"Scraper dependencies FAILED: {app_core.SCRAPER_IMPORT_ERROR}")
            _log_startup(getattr(app_core, "SCRAPER_IMPORT_TRACEBACK", "") or "")
    except Exception:
        _log_startup("Scraper dependency probe raised:\n" + traceback.format_exc())

    port = int(os.environ.get("BIDMANAGER_PORT", "8090"))
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
