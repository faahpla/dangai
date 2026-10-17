@echo off
REM Build a standalone CorteCenas.exe using PyInstaller.
REM Output: dist\CorteCenas\CorteCenas.exe (+ ~3 GB of libs)

setlocal
cd /d "%~dp0"

echo [build] Checking PyInstaller...
python -m pip show pyinstaller >NUL 2>&1
if errorlevel 1 (
    echo [build] Installing PyInstaller...
    python -m pip install --user pyinstaller
    if errorlevel 1 goto :fail
)

echo [build] Cleaning previous build...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist

echo [build] Running PyInstaller (this takes 5-10 min, the torch/cuda libs are huge)...
python -m PyInstaller build.spec --noconfirm --clean
if errorlevel 1 goto :fail

echo.
echo [build] DONE. Output folder:
echo         %cd%\dist\CorteCenas\
echo.
echo Next step: zip dist\CorteCenas\ and share. User extracts and runs CorteCenas.exe.
echo Remind them they need an NVIDIA GPU + CUDA 12.8 drivers + FFmpeg on PATH.
goto :eof

:fail
echo [build] FAILED. See messages above.
exit /b 1
