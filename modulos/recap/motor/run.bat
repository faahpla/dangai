@echo off
REM Ativa o venv local e roda o app.
REM Se quiser ver o log de erros, abre o PowerShell manualmente.

setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\activate.bat" (
    echo .venv nao encontrado. Rode install.bat primeiro.
    pause
    exit /b 1
)

call .venv\Scripts\activate.bat
python run.py
if errorlevel 1 (
    echo.
    echo [ERRO] O app terminou com erro. Veja o log acima.
    pause
)
