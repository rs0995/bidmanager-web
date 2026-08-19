@echo off
setlocal

echo.
echo  BidManager Control Electron Setup Build
echo  ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found.
    exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python not found.
    exit /b 1
)

cd /d "%~dp0"

echo [1/4] Building the console UI (Server UI\dist)...
call npm run build
if errorlevel 1 exit /b 1

echo [2/4] Installing backend dependencies...
call pip install -r server\requirements.txt --quiet
if errorlevel 1 exit /b 1

echo [3/4] Building the admin backend with PyInstaller...
call pyinstaller server\admin_backend_server.spec --noconfirm --workpath build\pyinstaller --distpath build
if errorlevel 1 exit /b 1
if not exist "build\admin-backend\BidManagerControlBackend.exe" (
    echo [ERROR] PyInstaller did not produce Server UI\build\admin-backend\BidManagerControlBackend.exe
    exit /b 1
)

echo [4/4] Building Electron installer (NSIS)...
cd electron
call npm run electron:dist
if errorlevel 1 exit /b 1
cd ..

echo.
echo Done.
echo Installer output is under Server UI\installer\current\
echo.

endlocal
