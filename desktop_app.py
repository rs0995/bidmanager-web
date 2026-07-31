"""
BidManager Desktop — Single-process launcher.

Starts the FastAPI backend on a local port, then opens the React frontend
in a native OS window using pywebview.

Usage (development):
    cd bidmanager-web/frontend && npm run build
    python desktop_app.py

Usage (production / packaged):
    pyinstaller desktop_app.spec
"""

import os
import sys
import time
import socket
import webbrowser
import logging
import traceback
import subprocess

# ── Paths ──────────────────────────────────────────────────────────────────

def _exe_dir():
    """Directory containing the .exe (frozen) or this .py file (dev)."""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))

def _data_dir():
    """Directory where PyInstaller unpacks data files (frozen) or project root (dev)."""
    if getattr(sys, 'frozen', False):
        # PyInstaller onedir: data is in _internal/ (sys._MEIPASS)
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))

EXE_DIR = _exe_dir()
DATA_DIR = _data_dir()
BACKEND_DIR = os.path.join(DATA_DIR, 'backend')
FRONTEND_DIST = os.path.join(DATA_DIR, 'frontend', 'dist')

# ── Log to file next to the exe ────────────────────────────────────────────

_log_path = os.path.join(EXE_DIR, 'bidmanager.log')
try:
    logging.basicConfig(
        filename=_log_path, filemode='a', level=logging.DEBUG,
        format='%(asctime)s %(levelname)s %(message)s',
    )
except Exception:
    # If we can't write next to exe (e.g. Program Files), use temp
    _log_path = os.path.join(os.environ.get('TEMP', '.'), 'bidmanager.log')
    logging.basicConfig(
        filename=_log_path, filemode='a', level=logging.DEBUG,
        format='%(asctime)s %(levelname)s %(message)s',
    )
log = logging.getLogger('bidmanager')

# ── Ensure backend is importable ───────────────────────────────────────────

# app_core.py resolves paths relative to _get_app_base_dir() which uses
# sys.executable when frozen. We need to set CWD to the exe directory so
# that DB, settings, downloads are created next to the exe (writable),
# NOT inside the read-only _MEIPASS extraction folder.
os.chdir(EXE_DIR)

if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# ── Find a free port ───────────────────────────────────────────────────────

def find_free_port(start=8100, end=8200):
    for port in range(start, end):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('127.0.0.1', port))
                return port
        except OSError:
            continue
    return 8100


def start_backend_process(port):
    if getattr(sys, 'frozen', False):
        cmd = [sys.executable, '--backend-child', str(port)]
    else:
        cmd = [sys.executable, os.path.abspath(__file__), '--backend-child', str(port)]

    kwargs = {
        'cwd': EXE_DIR,
        'stdin': subprocess.DEVNULL,
        'stdout': subprocess.DEVNULL,
        'stderr': subprocess.DEVNULL,
    }
    if os.name == 'nt':
        kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
    return subprocess.Popen(cmd, **kwargs)


def terminate_backend_process(proc):
    if not proc:
        return
    if proc.poll() is not None:
        return
    try:
        proc.terminate()
        proc.wait(timeout=5)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass

# ── Start backend ──────────────────────────────────────────────────────────

def start_backend(port):
    try:
        log.info('Importing uvicorn...')
        import uvicorn

        log.info('Importing api_server...')
        from api_server import app
        log.info('api_server imported OK')

        # Serve React build as static files
        if os.path.isdir(FRONTEND_DIST):
            from fastapi.staticfiles import StaticFiles
            from fastapi.responses import FileResponse
            from starlette.routing import Mount, Route

            assets_dir = os.path.join(FRONTEND_DIST, 'assets')
            if os.path.isdir(assets_dir):
                app.mount('/assets', StaticFiles(directory=assets_dir), name='static_assets')

            # SPA catch-all: must be added AFTER all API routes
            async def _serve_spa(request):
                path = request.path_params.get('path', '')
                file_path = os.path.join(FRONTEND_DIST, path)
                if path and os.path.isfile(file_path):
                    return FileResponse(file_path)
                return FileResponse(os.path.join(FRONTEND_DIST, 'index.html'))

            # Add as a Starlette route with lowest priority
            app.router.routes.append(Route('/{path:path}', _serve_spa))
            log.info('SPA static serving configured')

        log.info(f'Starting uvicorn on 127.0.0.1:{port}...')
        config = uvicorn.Config(
            app,
            host='127.0.0.1',
            port=port,
            log_level='warning',
            access_log=False,
        )
        server = uvicorn.Server(config)
        # Running in a background thread: disable signal registration.
        server.install_signal_handlers = lambda: None
        server.run()
        log.info('Uvicorn server stopped.')
    except BaseException:
        log.error(f'Backend crashed:\n{traceback.format_exc()}')


def wait_for_backend(port, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=1):
                return True
        except OSError:
            time.sleep(0.3)
    return False

# ── Main ───────────────────────────────────────────────────────────────────

def main():
    if '--backend-child' in sys.argv:
        try:
            idx = sys.argv.index('--backend-child')
            port = int(sys.argv[idx + 1])
        except Exception:
            port = 8100
        log.info(f'Backend child mode start on port {port}')
        start_backend(port)
        return

    log.info(f'EXE_DIR={EXE_DIR}')
    log.info(f'DATA_DIR={DATA_DIR}')
    log.info(f'BACKEND_DIR={BACKEND_DIR}')
    log.info(f'FRONTEND_DIST={FRONTEND_DIST}')
    log.info(f'CWD={os.getcwd()}')
    log.info(f'frozen={getattr(sys, "frozen", False)}')

    port = find_free_port()
    url = f'http://127.0.0.1:{port}'

    index_html = os.path.join(FRONTEND_DIST, 'index.html')
    if not os.path.isfile(index_html):
        msg = f'React build not found at {index_html}'
        log.error(msg)
        # List what IS there to help debug
        log.error(f'DATA_DIR contents: {os.listdir(DATA_DIR) if os.path.isdir(DATA_DIR) else "NOT A DIR"}')
        fd = os.path.join(DATA_DIR, 'frontend')
        log.error(f'frontend/ contents: {os.listdir(fd) if os.path.isdir(fd) else "NOT A DIR"}')
        print(f'ERROR: {msg}\nCheck {_log_path} for details.')
        sys.exit(1)

    log.info('React build found. Starting backend child process...')
    backend_proc = start_backend_process(port)
    log.info(f'Backend child PID={backend_proc.pid}')

    log.info(f'Waiting for backend readiness on {url}...')
    if not wait_for_backend(port, timeout=20):
        log.error(
            f'Backend did not start within 20s. Child exit code={backend_proc.poll()}'
        )
        terminate_backend_process(backend_proc)
        # Flush so the log is readable
        for h in logging.getLogger().handlers:
            h.flush()
        print(f'ERROR: Backend failed to start. Check {_log_path}')
        sys.exit(1)

    log.info(f'Backend ready at {url}. Opening window...')

    # Safe-mode behavior:
    # - Frozen builds default to browser mode because some systems crash in
    #   msedgewebview2.exe. Pass --native to force embedded webview.
    # - Explicit browser mode can also be forced via --browser.
    force_browser = ('--browser' in sys.argv) or (
        getattr(sys, 'frozen', False) and '--native' not in sys.argv
    )

    if force_browser:
        log.info('Launching in browser mode (safe mode).')
        webbrowser.open(url)
        print(f'App running at {url} — press Ctrl+C to stop.')
        try:
            while True:
                if backend_proc.poll() is not None:
                    log.error(f'Backend child exited unexpectedly: {backend_proc.returncode}')
                    break
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        terminate_backend_process(backend_proc)
        return

    # Try pywebview, fall back to browser
    try:
        import webview
        log.info('pywebview imported')
        window = webview.create_window(
            title='Tender & Bid Manager Pro',
            url=url,
            width=1400, height=900,
            min_size=(1000, 600),
            resizable=True, text_select=True,
        )
        webview.start(debug=('--debug' in sys.argv))
        log.info('Window closed normally.')
        terminate_backend_process(backend_proc)
        return
    except ImportError:
        log.warning('pywebview not installed — opening browser')
    except Exception:
        log.error(f'pywebview error:\n{traceback.format_exc()}')

    webbrowser.open(url)
    print(f'App running at {url} — press Ctrl+C to stop.')
    try:
        while True:
            if backend_proc.poll() is not None:
                log.error(f'Backend child exited unexpectedly: {backend_proc.returncode}')
                break
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    terminate_backend_process(backend_proc)


if __name__ == '__main__':
    main()
