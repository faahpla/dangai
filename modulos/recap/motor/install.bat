@echo off
REM One-shot installer for AnCut HUB (source distribution, no .exe needed).
REM Creates a local .venv, installs all dependencies, downloads models.

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ============================================================
echo  AnCut HUB - Instalador
echo ============================================================
echo.
echo Requisitos:
echo   - Python 3.11+ instalado
echo   - Placa NVIDIA com driver CUDA 12.8+ (RTX 20xx e novas)
echo   - FFmpeg no PATH (https://www.gyan.dev/ffmpeg/builds/)
echo   - ~5 GB de espaco em disco (venv + modelos)
echo   - Conexao com internet (~3 GB de download)
echo.
pause

echo.
echo [install] Verificando Python...
python --version
if errorlevel 1 (
    echo.
    echo [ERRO] Python nao encontrado. Instale 3.11+ em https://python.org
    echo        e adicione ao PATH.
    pause
    exit /b 1
)

echo.
echo [install] Verificando FFmpeg...
where ffmpeg >NUL 2>&1
if errorlevel 1 (
    echo.
    echo [AVISO] FFmpeg nao encontrado no PATH. O app vai falhar ao cortar shots.
    echo         Baixe em https://www.gyan.dev/ffmpeg/builds/ ^(release essentials^),
    echo         extraia e adicione a pasta "bin" ao PATH do Windows.
    echo.
    set /p "continuar=Continuar mesmo assim? (S/N): "
    if /i not "!continuar!"=="S" exit /b 1
) else (
    for /f "delims=" %%v in ('ffmpeg -version 2^>^&1 ^| findstr /C:"ffmpeg version"') do echo    %%v
)

if not exist ".venv" (
    echo.
    echo [install] Criando ambiente virtual em .venv\ ...
    python -m venv .venv
    if errorlevel 1 goto :fail
)

call .venv\Scripts\activate.bat

echo.
echo [install] Atualizando pip...
python -m pip install --upgrade pip >NUL

echo.
echo [install] Instalando torch com CUDA 12.8 PRIMEIRO (~2.7 GB, 5-10 min)...
echo           (precisa vir antes do requirements.txt, senao pip instala torch CPU)
python -m pip install --index-url https://download.pytorch.org/whl/cu128 torch torchvision
if errorlevel 1 goto :fail

echo.
echo [install] Instalando demais dependencias do app (1-2 min)...
python -m pip install -r requirements.txt
if errorlevel 1 goto :fail

echo.
echo [install] Instalando YOLO anime-face detector (ultralytics)...
python -m pip install ultralytics huggingface_hub
if errorlevel 1 goto :fail

echo.
echo [install] Verificando CUDA no torch instalado...
python -c "import torch; assert torch.cuda.is_available(), 'torch CUDA nao disponivel'; print('   torch', torch.__version__, '| CUDA:', torch.cuda.is_available(), '| GPU:', torch.cuda.get_device_name(0))"
if errorlevel 1 (
    echo.
    echo [AVISO] torch CPU foi instalado em vez da versao CUDA.
    echo         O app vai rodar, mas analise sera ~20x mais lenta.
    echo         Pra corrigir manualmente:
    echo           .venv\Scripts\activate
    echo           pip uninstall -y torch torchvision
    echo           pip install --index-url https://download.pytorch.org/whl/cu128 torch torchvision
    echo.
)

echo.
echo ============================================================
echo  INSTALACAO CONCLUIDA
echo ============================================================
echo.
echo Pra rodar o app, de dois cliques em run.bat
echo (ou no PowerShell: .venv\Scripts\activate ^&^& python run.py)
echo.
echo Na primeira execucao, o app vai baixar:
echo   - Modelo YOLO anime-face (~22 MB)
echo   - CLIP ViT-L/14 pesos (~890 MB)
echo.
pause
exit /b 0

:fail
echo.
echo [ERRO] Instalacao falhou. Ve as mensagens acima.
pause
exit /b 1
