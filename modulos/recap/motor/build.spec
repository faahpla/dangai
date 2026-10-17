# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for AnCut HUB.

Build with:
    pyinstaller build.spec --noconfirm --clean

Output: dist/CorteCenas/ (onedir mode).
Zip this folder to share with users who have an NVIDIA GPU + CUDA 12.8 driver.
FFmpeg binary must be available on the target machine's PATH.
"""
from PyInstaller.utils.hooks import (
    collect_data_files,
    collect_submodules,
    copy_metadata,
)


# --- Hidden imports ---------------------------------------------------------
# Heavy ML libs rely on runtime-discovered modules that PyInstaller can't
# find statically. We collect them explicitly.

hidden = []
hidden += collect_submodules("open_clip")
hidden += collect_submodules("ultralytics")
hidden += collect_submodules("torch")
hidden += collect_submodules("torchvision")
hidden += collect_submodules("cv2")
hidden += collect_submodules("PIL")

# Extra imports for model registries / tokenizer files these libs pull lazily.
hidden += [
    "ftfy",
    "regex",
    "huggingface_hub",
    "hf_xet",           # fast-path de download do HF Hub (senão cai em HTTP + warning)
    "safetensors",
    "timm",
    "yaml",
]

# --- Sem Qt no pacote ------------------------------------------------------
# Este executável é o BACKEND do app Electron: ele sempre é chamado com
# `--headless` e fala JSON-lines. A interface Qt (`app/ui`, `app/main.py`,
# `app/updater.py`) continua no repositório e roda do código, mas dentro do
# pacote ela é inalcançável — nenhum atalho aponta pra ela.
#
# Ela custava 114 MB empacotada, mais os plugins de multimídia que este bloco
# coletava à mão pro preview de vídeo do Qt. O preview de hoje é o <video> do
# Chromium, do lado do Electron.
#
# Verificado antes de cortar: dos 40 módulos que o `app.headless` alcança,
# NENHUM importa PySide6.
binaries = []

hidden += [
    # CCIP e reconhecimento facial (live action): importados tarde, e import
    # tardio é justamente o que o PyInstaller não enxerga sozinho.
    "onnxruntime",
    "onnxruntime.capi._pybind_state",
]


# --- Data files -------------------------------------------------------------
datas = []
# Bundled FFmpeg (~200 MB). Put next to the app so users don't have to
# install ffmpeg separately or add anything to PATH. Populated by
# fetch_ffmpeg.py before this spec runs (see _build_all.bat).
datas += [("bin/ffmpeg.exe", "bin")]
datas += [("bin/ffprobe.exe", "bin")]
# Elevated helper for delta updates. Shipped alongside the exe so the
# updater can hand it a source dir + target dir and let it copy files.
datas += [("apply_update.ps1", ".")]
# Deps fingerprint (sha256 do requirements.txt, gerado por
# gen_deps_fingerprint.py). O updater compara o do delta zip com o local:
# deps diferentes = delta entregaria app quebrado -> forca setup completo.
datas += [("app/deps_fingerprint.txt", "app")]
# App icon (all sizes) — needed at runtime for QApplication.setWindowIcon().
datas += [("app/assets/icon.ico", "app/assets")]
datas += [("app/assets/icon_256.png", "app/assets")]
datas += [("app/assets/icon_128.png", "app/assets")]
datas += [("app/assets/icon_64.png", "app/assets")]
datas += [("app/assets/icon_48.png", "app/assets")]
datas += [("app/assets/icon_32.png", "app/assets")]
datas += [("app/assets/icon_16.png", "app/assets")]
# Marca do cabeçalho (logo recortada, sem a margem do ícone quadrado).
datas += [("app/assets/logo_header.png", "app/assets")]
datas += collect_data_files("open_clip")
datas += collect_data_files("ultralytics")
datas += collect_data_files("torchvision")
# Package metadata some libs inspect at runtime:
datas += copy_metadata("torch")
datas += copy_metadata("open_clip_torch")
datas += copy_metadata("ultralytics")
datas += copy_metadata("huggingface_hub")


a = Analysis(
    ["run.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter",
        "matplotlib.tests",
        "notebook",
        # A interface Qt não vive dentro do pacote — ver o bloco acima.
        "PySide6",
        "shiboken6",
        # O `ultralytics` arrasta o polars (176 MB!) por causa do TREINO: ele
        # o usa pra ler results.csv e montar tabela de benchmark. Aqui só se
        # faz inferência (`model.predict`), e nenhum arquivo do app importa
        # polars — conferido.
        "polars",
        "_polars_runtime_32",
        "_polars_runtime_64",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="CorteCenas",
    icon="app/assets/icon.ico",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,                # UPX often breaks torch/cuda libs; disable
    console=False,            # no CMD popup; crash traceback is captured
                              # by run.py's crash handler into a log + dialog
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="CorteCenas",
)
