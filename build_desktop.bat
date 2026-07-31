@echo off
REM ===================================================================
REM  BidManager Desktop - Build Script for Windows
REM ===================================================================

echo.
echo  BidManager Desktop Build
echo  ========================
echo.

REM -- Step 1: Check prerequisites ------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org
    exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.10+.
    exit /b 1
)

REM -- Step 2: Check app_core.py --------------------------------------
if not exist "backend\app_core.py" (
    echo [ERROR] backend\app_core.py not found!
    echo         Copy your existing app_core.py into the backend\ folder.
    exit /b 1
)

REM -- Step 3: Install Python dependencies ----------------------------
echo [1/5] Installing Python dependencies...
pip install -r requirements-desktop.txt --quiet
pip install pyinstaller --quiet

REM -- Step 4: Build React frontend -----------------------------------
echo [2/5] Installing Node.js dependencies...
cd frontend
call npm install --silent 2>nul
echo [3/5] Building React frontend...
call npm run build
cd ..

if not exist "frontend\dist\index.html" (
    echo [ERROR] React build failed. Check frontend\dist\
    exit /b 1
)

REM -- Step 5: Package with PyInstaller --------------------------------
REM Build to C:\BidManagerBuild to avoid OneDrive file-locking issues
REM and then sync the result back into local dist\ for installer scripts.
echo [4/5] Packaging desktop app with PyInstaller...
pyinstaller desktop_app.spec --noconfirm --workpath "C:\BidManagerBuild\build" --distpath "C:\BidManagerBuild\dist"

if not exist "C:\BidManagerBuild\dist\BidManager\BidManager.exe" (
    echo [ERROR] PyInstaller build failed. Check output above for errors.
    echo.
    echo Common fixes:
    echo   - Run: pip install pywebview --upgrade
    echo   - Run: pip install pyinstaller --upgrade
    echo   - Make sure no antivirus is blocking PyInstaller
    exit /b 1
)

echo [5/5] Syncing build output to local dist\ folder...
if exist "dist\BidManager" rmdir /s /q "dist\BidManager"
xcopy "C:\BidManagerBuild\dist\BidManager" "dist\BidManager\" /E /I /Y >nul
if errorlevel 1 (
    echo [ERROR] Failed to sync output into dist\BidManager
    exit /b 1
)

if not exist "dist\BidManager\BidManager.exe" (
    echo [ERROR] Local output missing at dist\BidManager\BidManager.exe
    exit /b 1
)

echo [6/6] Done!
echo.
echo  ============================================================
echo   Desktop app built successfully!
echo.
echo   Local output : dist\BidManager\BidManager.exe
echo   Build cache  : C:\BidManagerBuild\dist\BidManager\BidManager.exe
echo.
echo   To run: double-click dist\BidManager\BidManager.exe
echo.
echo   If it doesn't open, check bidmanager.log next to the exe.
echo  ============================================================
echo.

REM -- Optional: build with console for debugging --------------------
REM Uncomment the line below to build a version that shows a console
REM window (useful for seeing error messages on startup):
REM
REM pyinstaller desktop_app.spec --noconfirm --workpath "C:\BidManagerBuild\build" --distpath "C:\BidManagerBuild\dist_debug"
REM Then edit desktop_app.spec: change console=False to console=True
