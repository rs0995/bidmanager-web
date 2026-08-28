"""
Electron backend launcher.

Runs FastAPI app from backend/api_server.py on a fixed localhost port.
Used by Electron in packaged mode.
"""

import os
import sys


def _project_root() -> str:
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(sys.executable)))
    return os.path.dirname(os.path.abspath(__file__))


ROOT = _project_root()
BACKEND_DIR = os.path.join(ROOT, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from api_server import app  # noqa: E402
import uvicorn  # noqa: E402


def main() -> None:
    port = int(os.environ.get("BIDMANAGER_PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
