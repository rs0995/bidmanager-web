@echo off
setlocal

echo.
echo  BidManager Desktop Run
echo  ======================
echo.

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

if not exist "backend\app_core.py" (
    echo [ERROR] backend\app_core.py not found.
    exit /b 1
)

echo [1/3] Building React frontend...
cd frontend
call npm run build
if errorlevel 1 (
    echo [ERROR] Frontend build failed.
    exit /b 1
)
cd ..

echo [2/3] Installing desktop Python dependencies...
pip install -r requirements-desktop.txt --quiet
if errorlevel 1 (
    echo [ERROR] Failed to install desktop dependencies.
    exit /b 1
)

echo [3/3] Launching desktop app...
python desktop_app.py

endlocal
