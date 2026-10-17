"""Grava app/deps_fingerprint.txt = sha256 do requirements.txt.

Roda no _build_all.bat ANTES do PyInstaller. O arquivo é embarcado no build
(datas do build.spec) e viaja no delta zip; o updater compara o fingerprint
do zip com o da instalação atual — se as dependências mudaram, o delta de
53 MB entregaria um app quebrado (ele não carrega torch/PySide/etc.), então
o updater recusa e manda o usuário pro instalador completo.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
req = (ROOT / "requirements.txt").read_bytes()
fp = hashlib.sha256(req).hexdigest()
out = ROOT / "app" / "deps_fingerprint.txt"
out.write_text(fp + "\n", encoding="ascii")
print(f"[deps_fingerprint] {fp} -> {out}")
