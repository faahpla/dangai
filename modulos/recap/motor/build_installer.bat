@echo off
REM ============================================================
REM  Build the full Windows installer for AnCut HUB.
REM
REM  Steps:
REM    1) PyInstaller -> dist\CorteCenas\ (~3 GB)
REM    2) Inno Setup  -> releases\CorteCenas-Setup-X.Y.Z.exe (~1.5 GB)
REM
REM  You need:
REM    - The .venv already created (run install.bat first).
REM    - Inno Setup 6 installed (default path C:\Program Files (x86)\Inno Setup 6\).
REM      Download: https://jrsoftware.org/isdl.php
REM ============================================================

setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\activate.bat" (
    echo [ERRO] .venv nao encontrado. Rode install.bat primeiro.
    pause
    exit /b 1
)

REM --- Locate Inno Setup Compiler ---
set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=C:\Program Files\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" (
    echo [ERRO] Inno Setup nao encontrado. Instale de https://jrsoftware.org/isdl.php
    echo        e rode de novo.
    pause
    exit /b 1
)

call .venv\Scripts\activate.bat

set "PROJDIR=%~dp0"

echo.
echo ============================================================
echo  [1/2] Rodando PyInstaller (5-10 min, empacotando torch/cuda)
echo ============================================================
call "%PROJDIR%build.bat"
if errorlevel 1 (
    echo [ERRO] PyInstaller falhou.
    pause
    exit /b 1
)

if not exist "%PROJDIR%dist\CorteCenas\CorteCenas.exe" (
    echo [ERRO] dist\CorteCenas\CorteCenas.exe nao gerado.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  [2/2] Rodando Inno Setup (2-5 min, comprimindo tudo)
echo ============================================================
if not exist "%PROJDIR%releases" mkdir "%PROJDIR%releases"
"%ISCC%" "%PROJDIR%installer.iss"
if errorlevel 1 (
    echo [ERRO] Inno Setup falhou.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  INSTALADOR PRONTO
echo ============================================================
echo.
echo Arquivo:
dir /b releases\CorteCenas-Setup-*.exe
echo.
echo Proximo passo: subir esse .exe como asset numa release nova
echo do repo GitHub (tag = v da versao no installer.iss).
echo.
pause
