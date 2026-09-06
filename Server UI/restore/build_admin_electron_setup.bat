@echo off
setlocal enabledelayedexpansion

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

rem --- The running installed app locks build\admin-backend and
rem     installer\current\win-unpacked. PyInstaller / electron-builder then
rem     fail with "Access is denied" / EPERM and this script used to abort
rem     silently, leaving the OLD installer in place. Stop early with a clear
rem     message instead. Pass  build_admin_electron_setup.bat /force  to kill it.
tasklist /fi "imagename eq BidManager Control.exe" 2>nul | find /i "BidManager Control.exe" >nul
if not errorlevel 1 (
    if /i "%~1"=="/force" (
        echo [warn] Closing running BidManager Control...
        taskkill /f /im "BidManager Control.exe" >nul 2>nul
        taskkill /f /im "BidManagerControlBackend.exe" >nul 2>nul
        timeout /t 2 /nobreak >nul
    ) else (
        echo [ERROR] "BidManager Control" is running - it locks the build folders.
        echo         Close the app and re-run, or run:  %~nx0 /force
        exit /b 1
    )
)

rem --- Record the current installer so we can prove a fresh one was produced.
set "INSTALLER=installer\current\BidManagerControl-Setup-1.0.4.exe"
set "OLD_STAMP="
if exist "%INSTALLER%" for %%F in ("%INSTALLER%") do set "OLD_STAMP=%%~tF"

echo [1/4] Building the console UI (Server UI\dist)...
call npm run build
if errorlevel 1 exit /b 1

echo [2/4] Installing backend dependencies...
call pip install -r server\requirements.txt --quiet --disable-pip-version-check
if errorlevel 1 exit /b 1

echo [3/4] Building the admin backend with PyInstaller...
rem Clean stale output first - PyInstaller's own rmtree of build\admin-backend
rem is what trips "Access is denied" when OneDrive/Defender briefly holds a
rem handle; removing it up front (and retrying) sidesteps that.
if exist "build\admin-backend"       rmdir /s /q "build\admin-backend"
if exist "build\pyinstaller"         rmdir /s /q "build\pyinstaller"
if exist "build\admin-backend" (
    echo [warn] build\admin-backend still present, retrying delete in 3s...
    timeout /t 3 /nobreak >nul
    rmdir /s /q "build\admin-backend"
)
call pyinstaller server\admin_backend_server.spec --noconfirm --workpath build\pyinstaller --distpath build
if errorlevel 1 exit /b 1
if not exist "build\admin-backend\BidManagerControlBackend.exe" (
    echo [ERROR] PyInstaller did not produce Server UI\build\admin-backend\BidManagerControlBackend.exe
    exit /b 1
)

echo [4/4] Building Electron installer (NSIS)...
rem Clean stale packaging dir - electron-builder renames win-unpacked.tmp ->
rem win-unpacked and fails with EPERM when the old one is locked.
if exist "installer\current\win-unpacked"     rmdir /s /q "installer\current\win-unpacked"
if exist "installer\current\win-unpacked.tmp" rmdir /s /q "installer\current\win-unpacked.tmp"
cd electron
call npm run electron:dist
if errorlevel 1 (
    echo [warn] electron-builder failed once, cleaning and retrying...
    cd ..
    if exist "installer\current\win-unpacked"     rmdir /s /q "installer\current\win-unpacked"
    if exist "installer\current\win-unpacked.tmp" rmdir /s /q "installer\current\win-unpacked.tmp"
    timeout /t 3 /nobreak >nul
    cd electron
    call npm run electron:dist
    if errorlevel 1 (
        cd ..
        echo [ERROR] electron-builder failed.
        exit /b 1
    )
)
cd ..

set "NEW_STAMP="
if exist "%INSTALLER%" for %%F in ("%INSTALLER%") do set "NEW_STAMP=%%~tF"

echo.
if not exist "%INSTALLER%" (
    echo [ERROR] No installer at %INSTALLER%
    exit /b 1
)
if "%OLD_STAMP%"=="%NEW_STAMP%" (
    echo [ERROR] Installer timestamp did not change (%NEW_STAMP%) - build did NOT refresh it.
    exit /b 1
)
echo Done.  Fresh installer: %INSTALLER%
echo   was: %OLD_STAMP%
echo   now: %NEW_STAMP%
echo.

endlocal
