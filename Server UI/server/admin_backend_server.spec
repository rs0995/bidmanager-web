# -*- mode: python ; coding: utf-8 -*-

import os

from PyInstaller.utils.hooks import collect_all, copy_metadata

block_cipher = None
base_dir = os.path.dirname(os.path.abspath(SPEC))          # Server UI/server
console_ui_dist = os.path.join(os.path.dirname(base_dir), "dist")  # Server UI/dist

datas = [
    (os.path.join(base_dir, "api_server.py"), "."),
    (os.path.join(base_dir, "app_core.py"), "."),
    (os.path.join(base_dir, "admin_providers.py"), "."),
    (os.path.join(base_dir, "db_compat.py"), "."),
    (os.path.join(base_dir, "drive_storage.py"), "."),
    (console_ui_dist, os.path.join("frontend", "dist")),
]

optional_files = [
    os.path.join(base_dir, "app_version.py"),
]
for f in optional_files:
    if os.path.isfile(f):
        datas.append((f, "."))

# Scraper dependencies ship data files, native extensions, or are namespace
# packages. collect_all() pulls their submodules/binaries; copy_metadata() keeps
# their .dist-info so runtime importlib.metadata / entry_points lookups succeed
# inside the frozen build (bare hiddenimports alone left these out and the
# lazy scraper import failed at runtime).
_extra_datas, _extra_binaries, _extra_hidden = [], [], []
for _pkg in (
    "selenium",
    "webdriver_manager",
    "bs4",
    "soupsieve",
    "google.generativeai",
    "google.ai.generativelanguage",
    "google.api_core",
    "grpc",
    "proto",
):
    try:
        _d, _b, _h = collect_all(_pkg)
    except Exception:
        continue
    _extra_datas += _d
    _extra_binaries += _b
    _extra_hidden += _h

for _dist in (
    "selenium",
    "webdriver-manager",
    "beautifulsoup4",
    "google-generativeai",
    "google-api-core",
    "requests",
):
    try:
        _extra_datas += copy_metadata(_dist)
    except Exception:
        pass

datas += _extra_datas

a = Analysis(
    ["admin_backend_server.py"],
    pathex=[base_dir],
    binaries=_extra_binaries,
    datas=datas,
    hiddenimports=[
        *_extra_hidden,
        "requests",
        "bs4",
        "PIL",
        "PIL.Image",
        "google.generativeai",
        "selenium",
        "selenium.webdriver",
        "selenium.webdriver.firefox.webdriver",
        "selenium.webdriver.firefox.service",
        "selenium.webdriver.firefox.options",
        "selenium.webdriver.common.by",
        "selenium.webdriver.support.ui",
        "selenium.webdriver.support.expected_conditions",
        "selenium.common.exceptions",
        "webdriver_manager",
        "webdriver_manager.firefox",
        "psutil",
        "uvicorn",
        "uvicorn.loops.auto",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan.on",
        "fastapi",
        "fastapi.middleware.cors",
        "fastapi.staticfiles",
        "fastapi.responses",
        "starlette.routing",
        "starlette.staticfiles",
        "starlette.responses",
        "pydantic",
        "h11",
        "anyio",
        "sniffio",
        "multipart",
        "python_multipart",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "matplotlib",
        "numpy",
        "openpyxl",
        "pandas",
        "PyQt5",
        "PyQt6",
        "PySide2",
        "PySide6",
        "scipy",
        "sqlalchemy",
        "pytest",
        "unittest",
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
    name="BidManagerControlBackend",
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
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="admin-backend",
)
