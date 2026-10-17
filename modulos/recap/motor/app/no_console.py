"""Mata o flash de janelas CMD durante a análise — na raiz.

O app é uma janela sem console (frozen com console=False). No Windows,
QUALQUER processo filho de console (ffmpeg, pip, checagens internas de
bibliotecas como a ultralytics) abre a própria janela preta se ninguém passar
CREATE_NO_WINDOW. Nossos caminhos de ffmpeg já passam, mas dependências podem
criar subprocessos por conta própria — e cada release nova é uma chance de
uma janela voltar a piscar.

Em vez de caçar chamada por chamada pra sempre, remendamos o
subprocess.Popen uma vez, no boot: todo filho nasce com CREATE_NO_WINDOW.
Inofensivo pra apps GUI (não usam console) e pra pipes (capture_output
continua funcionando normalmente).
"""
from __future__ import annotations

import subprocess
import sys

_PATCHED = False


def harden_subprocess() -> None:
    """Idempotente; no-op fora do Windows."""
    global _PATCHED
    if _PATCHED or sys.platform != "win32":
        return
    _PATCHED = True

    original_init = subprocess.Popen.__init__

    def _no_window_init(self, *args, **kwargs):
        flags = kwargs.get("creationflags", 0) or 0
        # Se alguém pediu explicitamente um console novo, respeita.
        if not (flags & getattr(subprocess, "CREATE_NEW_CONSOLE", 0x10)):
            flags |= subprocess.CREATE_NO_WINDOW
        kwargs["creationflags"] = flags
        original_init(self, *args, **kwargs)

    subprocess.Popen.__init__ = _no_window_init
