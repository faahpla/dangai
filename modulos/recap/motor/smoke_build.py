"""Smoke test do build: o exe recém-gerado ABRE e loga a versão certa?

Roda no _build_all.bat entre o PyInstaller e o resto. Lança o exe, espera a
linha de sessão aparecer no app.log (que a v0.1.8+ escreve em toda
inicialização), mata o processo e devolve exit code — build quebrado falha
AQUI em vez de na casa dos usuários.
"""
from __future__ import annotations

import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent

version = re.search(
    r'__version__\s*=\s*"([^"]+)"', (ROOT / "app" / "__init__.py").read_text()
).group(1)
exe = ROOT / "dist" / "CorteCenas" / "CorteCenas.exe"
if not exe.exists():
    print(f"[smoke_build] FALHOU: {exe} não existe")
    sys.exit(1)

log = Path.home() / "AppData" / "Local" / "CorteCenas" / "CorteCenas" / "Logs" / "app.log"
offset = log.stat().st_size if log.exists() else 0

needle = f"AnCut HUB v{version} | frozen=True"
proc = subprocess.Popen([str(exe)])
ok = False
try:
    # 90s: em máquina ociosa o boot loga em ~2s, mas o build pode rodar em
    # paralelo com uma análise (ffmpeg saturando a CPU) — visto em produção.
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        time.sleep(2)
        if log.exists() and log.stat().st_size > offset:
            with open(log, encoding="utf-8", errors="replace") as f:
                f.seek(offset)
                if needle in f.read():
                    ok = True
                    break
finally:
    subprocess.run(
        ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
        capture_output=True,
    )

if ok:
    print(f"[smoke_build] OK: exe abriu e logou '{needle}'")
    sys.exit(0)
print(f"[smoke_build] FALHOU: '{needle}' não apareceu no app.log em 40s")
sys.exit(1)
