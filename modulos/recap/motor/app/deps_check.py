"""Startup dependency check + self-install for optional packages.

The core app works without `ultralytics` and `huggingface_hub` — it falls
back to the legacy lbpcascade face detector. But accuracy drops ~3x. This
module detects the missing packages and lets the user install them from
the UI with one click (using the current Python interpreter, so they land
in the exact environment the app runs under).
"""
from __future__ import annotations

import shutil
import subprocess
import sys


OPTIONAL_DEPS: dict[str, str] = {
    "ultralytics": "Detector de rosto YOLOv8 anime-face (3x melhor que lbpcascade)",
    "huggingface_hub": "Download do modelo YOLO (deepghs/anime_face_detection)",
}


def missing_optional_deps() -> list[str]:
    missing: list[str] = []
    for mod in OPTIONAL_DEPS:
        try:
            __import__(mod)
        except ImportError:
            missing.append(mod)
    return missing


def ffmpeg_available() -> bool:
    """Return True iff we can invoke ffmpeg — either bundled with the
    install (preferred) or on the user's PATH (fallback for source runs)."""
    from .ffmpeg_locate import is_bundled
    if is_bundled():
        return True
    return shutil.which("ffmpeg") is not None


def cuda_available() -> bool:
    """True iff torch was built with CUDA AND a working NVIDIA GPU is
    visible. Anything else means the app will silently run on CPU."""
    try:
        import torch
        return bool(torch.cuda.is_available())
    except Exception:
        return False


def gpu_name() -> str | None:
    """Return the first GPU's name when CUDA is up; None otherwise. Used
    by the settings dialog to confirm 'GPU: NVIDIA GeForce RTX 5080'."""
    try:
        import torch
        if torch.cuda.is_available():
            return torch.cuda.get_device_name(0)
    except Exception:
        pass
    return None


def install_with_pip(
    packages: list[str], use_user_site: bool = True
) -> tuple[bool, str]:
    """Install packages using the CURRENT Python's pip. Returns (ok, output)."""
    cmd = [sys.executable, "-m", "pip", "install"]
    if use_user_site:
        cmd.append("--user")
    cmd.extend(packages)
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,
        )
        ok = proc.returncode == 0
        out = (proc.stdout + "\n" + proc.stderr).strip()
        return ok, out[-4000:]
    except subprocess.TimeoutExpired:
        return False, "Timeout (10 minutos)"
    except Exception as e:
        return False, f"Falha ao rodar pip: {e}"
