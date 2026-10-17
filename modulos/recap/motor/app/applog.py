"""Persistent file logging for every install.

With `console=False` in the frozen build, everything the pipeline printed
to stdout/stderr — including the diagnostics that explain WHY a run found
0 characters ("Refs por personagem", "Rostos detectados em X/Y shots",
"Ignorados (poucas refs)") — was silently discarded. This module writes a
rotating log to %LOCALAPPDATA%\\CorteCenas\\logs\\app.log and tees both
streams into it, so a user can send one file and we can see the whole run.

Setup must happen before any Qt import so early failures get captured too.
"""
from __future__ import annotations

import logging
import logging.handlers
import platform
import sys
from pathlib import Path

_LOG_FILE = "app.log"
_installed = False

# A failing log write must never take the app down with it.
logging.raiseExceptions = False


def log_dir() -> Path:
    # Same location run.py uses for crash.log, so users find everything
    # in one folder.
    # [Studio] A pasta de log do motor do Studio (config.LOG_DIR), nunca a do
    # CorteCenas.
    try:
        from .config import LOG_DIR
        base = Path(LOG_DIR)
    except Exception:
        base = Path.home() / "AppData" / "Local" / "AniRecapStudioMotor" / "logs"
    base.mkdir(parents=True, exist_ok=True)
    return base


def get_logger() -> logging.Logger:
    return logging.getLogger("cortecenas")


class _Tee:
    """File-like that forwards writes to the original stream (which is None
    in the frozen console=False build) and mirrors complete lines into the
    log. Treats '\\r' as a line break so tqdm-style progress output doesn't
    accumulate into one giant buffered line."""

    def __init__(self, original, logger: logging.Logger, level: int) -> None:
        self._original = original
        self._logger = logger
        self._level = level
        self._buf = ""

    def write(self, text) -> int:
        if not isinstance(text, str):
            text = str(text)
        if self._original is not None:
            try:
                self._original.write(text)
            except Exception:
                pass
        self._buf += text
        lines = self._buf.replace("\r", "\n").split("\n")
        self._buf = lines.pop()  # last piece has no terminator yet
        for line in lines:
            if line.strip():
                self._logger.log(self._level, line.rstrip())
        return len(text)

    def flush(self) -> None:
        if self._original is not None:
            try:
                self._original.flush()
            except Exception:
                pass

    def isatty(self) -> bool:
        return False

    def __getattr__(self, name):
        # encoding, fileno, buffer... — delegate to the real stream when
        # there is one so libraries probing the object keep working.
        if self._original is not None:
            return getattr(self._original, name)
        raise AttributeError(name)


def setup() -> Path | None:
    """Install the rotating file handler + stdout/stderr tee. Idempotent.
    Returns the log path, or None when the filesystem refused — in that
    case the app runs exactly as before, just without the log."""
    global _installed
    if _installed:
        return log_dir() / _LOG_FILE
    try:
        folder = log_dir()
        logger = get_logger()
        logger.setLevel(logging.DEBUG)
        logger.propagate = False
        handler = logging.handlers.RotatingFileHandler(
            folder / _LOG_FILE, maxBytes=2_000_000, backupCount=3, encoding="utf-8"
        )
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname).1s %(message)s", "%d/%m %H:%M:%S")
        )
        logger.addHandler(handler)

        sys.stdout = _Tee(sys.stdout, logger, logging.INFO)
        sys.stderr = _Tee(sys.stderr, logger, logging.ERROR)
        _installed = True

        from . import __version__
        logger.info("=" * 62)
        logger.info(
            "AnCut HUB v%s | frozen=%s | %s",
            __version__, getattr(sys, "frozen", False), platform.platform(),
        )
        logger.info("Python %s | exe: %s", platform.python_version(), sys.executable)
        return folder / _LOG_FILE
    except Exception:
        return None
