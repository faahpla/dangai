"""AnCut HUB entry point.

Wraps `app.main.main()` in a defensive crash handler that:
- writes the traceback + platform info to a log the user can find
- pops a native message box explaining what happened

Without this, when the app is frozen (`console=False`), a startup crash
just closes silently — no CMD, no log, no clue. This makes bug reports
possible in the wild.
"""
from __future__ import annotations

import sys
import traceback
from datetime import datetime
from pathlib import Path


def _crash_log_path() -> Path:
    # [Studio] A pasta de log do motor do Studio (config.LOG_DIR), nunca a do
    # CorteCenas.
    try:
        from app.config import LOG_DIR
        base = Path(LOG_DIR)
    except Exception:
        base = Path.home() / "AppData" / "Local" / "AniRecapStudioMotor" / "logs"
    base.mkdir(parents=True, exist_ok=True)
    return base / "crash.log"


def _show_crash_dialog(log_path: Path, tb: str) -> None:
    """Message box with the log location. Uses ctypes so we don't need Qt
    (which may itself be what failed to load)."""
    try:
        import ctypes
        # Sem MB_ICONERROR de propósito: o flag de ícone toca o som de erro
        # do sistema, e as notificações do app são silenciosas por decisão.
        MB_OK = 0x0
        preview = tb.strip().splitlines()[-1] if tb.strip() else "(sem detalhes)"
        msg = (
            f"O AnCut HUB travou ao abrir.\n\n"
            f"Erro: {preview}\n\n"
            f"Um relatório completo foi salvo em:\n{log_path}\n\n"
            f"Envie o arquivo pra quem te passou o app pra investigar."
        )
        ctypes.windll.user32.MessageBoxW(0, msg, "AnCut HUB — Erro fatal", MB_OK)
    except Exception:
        pass


def _run() -> int:
    # Modo headless: o mesmo executável serve de backend pro app Electron,
    # falando JSON-lines no stdout em vez de abrir a interface Qt. Um exe só
    # evita empacotar o Python (4,8 GB de torch) duas vezes.
    if "--headless" in sys.argv:
        argv = [a for a in sys.argv[1:] if a != "--headless"]
        from app.headless import main as headless_main
        return headless_main(argv)

    # A interface Qt não vai no pacote (ver build.spec): este executável é o
    # backend do app Electron. Do código-fonte ela roda normalmente.
    try:
        from app.main import main
    except ImportError:
        print(
            "Este executável é o MOTOR do AnCut HUB, não o app.\n"
            "Abra o 'AnCut HUB' pelo atalho do menu Iniciar.\n"
            "(Pra usá-lo como backend: CorteCenas.exe --headless <modo>)",
            file=sys.stderr,
        )
        return 2
    return main()


def _main() -> int:
    # Session log first thing — before Qt, before config — so even import
    # failures leave a trace in app.log alongside crash.log.
    try:
        from app.applog import setup as _setup_log
        _setup_log()
    except Exception:
        pass
    # Nenhum subprocesso (ffmpeg, checagens de libs) pode piscar janela de
    # CMD — remendo global, antes de qualquer import pesado.
    try:
        from app.no_console import harden_subprocess
        harden_subprocess()
    except Exception:
        pass
    # A ultralytics tenta rodar `pip install` sozinha via subprocess quando
    # acha que falta dependência — inútil num app congelado e uma das fontes
    # do CMD piscando durante a análise.
    import os
    os.environ.setdefault("YOLO_AUTOINSTALL", "false")
    try:
        return _run()
    except SystemExit:
        raise
    except BaseException:
        tb = traceback.format_exc()
        log = _crash_log_path()
        try:
            import logging
            logging.getLogger("cortecenas").error("CRASH FATAL:\n%s", tb)
        except Exception:
            pass
        try:
            with open(log, "a", encoding="utf-8") as f:
                f.write(f"\n===== {datetime.now().isoformat()} =====\n")
                f.write(f"Python: {sys.version}\n")
                f.write(f"Executable: {sys.executable}\n")
                f.write(f"Frozen: {getattr(sys, 'frozen', False)}\n\n")
                f.write(tb)
        except Exception:
            pass
        _show_crash_dialog(log, tb)
        return 1


if __name__ == "__main__":
    raise SystemExit(_main())
