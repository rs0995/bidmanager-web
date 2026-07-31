@echo off
setlocal

echo.
echo  BidManager Electron Setup Build
echo  ===============================
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

echo [1/4] Installing root npm dependencies...
call npm install
if errorlevel 1 exit /b 1

echo [2/4] Building Electron installer (frontend + backend + NSIS)...
call npm run electron:dist
if errorlevel 1 exit /b 1

echo.
echo Done.
echo Installer output is under dist-electron\
echo.

endlocal
