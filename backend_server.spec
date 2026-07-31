# -*- mode: python ; coding: utf-8 -*-

import os

block_cipher = None
base_dir = os.path.dirname(os.path.abspath(SPEC))

datas = [
    (os.path.join(base_dir, "backend", "api_server.py"), "backend"),
    (os.path.join(base_dir, "backend", "app_core.py"), "backend"),
    (os.path.join(base_dir, "frontend", "dist"), os.path.join("frontend", "dist")),
]

optional_files = [
    os.path.join(base_dir, "backend", "app_version.py"),
]
for f in optional_files:
    if os.path.isfile(f):
        datas.append((f, "backend"))

a = Analysis(
    ["backend_server.py"],
    pathex=[os.path.join(base_dir, "backend")],
    binaries=[],
    datas=datas,
    hiddenimports=[
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
    name="BidManagerBackend",
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
    name="backend",
)
