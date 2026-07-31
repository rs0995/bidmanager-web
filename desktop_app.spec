# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for BidManager Desktop.

Build:
    pyinstaller desktop_app.spec --noconfirm

Output:
    dist/BidManager/BidManager.exe
"""

import os

block_cipher = None
base_dir = os.path.dirname(os.path.abspath(SPEC))
icon_path = os.path.join(base_dir, 'installer', 'assets', 'app.ico')

# Collect backend data files
_backend_datas = [
    (os.path.join(base_dir, 'backend', 'api_server.py'), 'backend'),
]
# app_core.py
_app_core = os.path.join(base_dir, 'backend', 'app_core.py')
if os.path.isfile(_app_core):
    _backend_datas.append((_app_core, 'backend'))

# app_version.py (optional)
_app_version = os.path.join(base_dir, 'backend', 'app_version.py')
if os.path.isfile(_app_version):
    _backend_datas.append((_app_version, 'backend'))

# Analysis

a = Analysis(
    ['desktop_app.py'],
    pathex=[
        os.path.join(base_dir, 'backend'),
    ],
    binaries=[],
    datas=[
        # React frontend build
        (os.path.join(base_dir, 'frontend', 'dist'), os.path.join('frontend', 'dist')),
        # Backend source files
        *_backend_datas,
    ],
    hiddenimports=[
        # --- uvicorn ---
        'uvicorn',
        'uvicorn.config',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.http.httptools_impl',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.protocols.websockets.wsproto_impl',
        'uvicorn.protocols.websockets.websockets_impl',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        # --- fastapi / starlette ---
        'fastapi',
        'fastapi.applications',
        'fastapi.routing',
        'fastapi.middleware',
        'fastapi.middleware.cors',
        'fastapi.staticfiles',
        'fastapi.responses',
        'fastapi.exceptions',
        'starlette',
        'starlette.applications',
        'starlette.routing',
        'starlette.middleware',
        'starlette.middleware.cors',
        'starlette.staticfiles',
        'starlette.responses',
        'starlette.exceptions',
        'starlette.formparsers',
        'starlette.concurrency',
        'starlette.status',
        # --- pydantic ---
        'pydantic',
        'pydantic.fields',
        'pydantic._internal',
        'pydantic._internal._config',
        'pydantic._internal._validators',
        'pydantic._internal._fields',
        'pydantic._internal._generate_schema',
        'pydantic._internal._generics',
        'pydantic_core',
        # --- h11 (HTTP/1.1 parser used by uvicorn) ---
        'h11',
        'h11._connection',
        'h11._events',
        'h11._state',
        # --- anyio (async runtime) ---
        'anyio',
        'anyio._backends',
        'anyio._backends._asyncio',
        # --- sniffio ---
        'sniffio',
        # --- pywebview ---
        'webview',
        'webview.platforms',
        'webview.platforms.edgechromium',
        # --- email (sometimes missed) ---
        'email.mime',
        'email.mime.text',
        'email.mime.multipart',
        # --- multipart ---
        'multipart',
        'python_multipart',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude heavy optional deps that app_core lazy-loads
        'selenium', 'bs4', 'PIL', 'google.generativeai',
        'webdriver_manager', 'fitz',
        # Exclude test frameworks
        'pytest', 'unittest',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='BidManager',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=icon_path if os.path.isfile(icon_path) else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='BidManager',
)
