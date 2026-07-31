@echo off
setlocal

REM Build desktop binary and then package Setup.exe via Inno Setup.
REM Usage:
REM   build_installer.bat
REM   build_installer.bat 1.2.3

set "APP_VERSION=%~1"
if "%APP_VERSION%"=="" set "APP_VERSION=1.0.0"

echo.
echo  BidManager Installer Build
echo  ==========================
echo  Version: %APP_VERSION%
echo.

call build_desktop.bat
if errorlevel 1 (
    echo [ERROR] Desktop build failed.
    exit /b 1
)

if not exist "dist\BidManager\BidManager.exe" (
    echo [ERROR] dist\BidManager\BidManager.exe not found.
    exit /b 1
)

set "ISCC_EXE="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC_EXE=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if "%ISCC_EXE%"=="" if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC_EXE=%ProgramFiles%\Inno Setup 6\ISCC.exe"

if "%ISCC_EXE%"=="" (
    echo [ERROR] Inno Setup 6 compiler (ISCC.exe) not found.
    echo         Install Inno Setup from: https://jrsoftware.org/isinfo.php
    echo         Then rerun this script.
    exit /b 1
)

echo Packaging installer with Inno Setup...
"%ISCC_EXE%" /DAppVersion=%APP_VERSION% installer\BidManager.iss
if errorlevel 1 (
    echo [ERROR] Installer packaging failed.
    exit /b 1
)

echo.
echo Installer created:
echo   dist\installer\BidManager-Setup-%APP_VERSION%.exe
echo.
endlocal
