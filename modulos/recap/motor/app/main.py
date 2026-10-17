from __future__ import annotations

import sys
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QIcon, QPixmap
from PySide6.QtWidgets import QApplication, QLabel, QWidget

from . import __version__
from .applog import get_logger, setup as setup_logging
from .config import Config
from .deps_check import cuda_available, ffmpeg_available, missing_optional_deps
from .ui.deps_dialog import FFmpegMissingDialog, MissingDepsDialog, NoGpuDialog
from .ui.main_window import MainWindow


def _load_app_icon() -> QIcon:
    """Load the multi-resolution app icon from app/assets/. Works both when
    running from source and when PyInstaller-bundled (sys._MEIPASS)."""
    candidates = []
    if hasattr(sys, "_MEIPASS"):
        candidates.append(Path(sys._MEIPASS) / "app" / "assets" / "icon.ico")
    candidates.append(Path(__file__).resolve().parent / "assets" / "icon.ico")
    for p in candidates:
        if p.exists():
            return QIcon(str(p))
    return QIcon()


def _load_splash_pixmap() -> QPixmap | None:
    """Splash de verdade: a LOGO ORIGINAL flutuando (transparência per-pixel
    da janela, sem cartão nem máscara serrilhada), com um balão escuro
    discreto só atrás da faixa de texto pra dar leitura em qualquer fundo."""
    candidates = []
    if hasattr(sys, "_MEIPASS"):
        candidates.append(Path(sys._MEIPASS) / "app" / "assets" / "icon_256.png")
    candidates.append(Path(__file__).resolve().parent / "assets" / "icon_256.png")
    logo = None
    for p in candidates:
        if p.exists():
            pm = QPixmap(str(p))
            if not pm.isNull():
                logo = pm
                break
    if logo is None:
        return None

    from PySide6.QtGui import QColor, QPainter, QPainterPath

    band_h = 46                      # balão do texto (2 linhas compactas)
    gap = 8
    W, H = logo.width(), logo.height() + gap + band_h
    canvas = QPixmap(W, H)
    canvas.fill(Qt.GlobalColor.transparent)
    painter = QPainter(canvas)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    painter.drawPixmap(0, 0, logo)   # a logo, intocada
    # Balão-legenda: mesmo tom do fundo da logo (contínuo visualmente),
    # bem arredondado — legível em desktop claro ou escuro.
    pill = QPainterPath()
    pill.addRoundedRect(W * 0.14, H - band_h, W * 0.72, band_h, band_h / 2.2, band_h / 2.2)
    painter.fillPath(pill, QColor(30, 31, 34, 235))
    painter.end()
    return canvas


class _FloatingSplash(QLabel):
    """Splash com transparência REAL. O QSplashScreen do Qt quebra o
    WA_TranslucentBackground há anos (pinta o pixmap com fundo opaco por
    dentro) — e janela opaca sem moldura ganha do Windows 11 canto
    arredondado + borda cinza de 1px desenhados pelo DWM: a "borda feia".
    Um QLabel frameless translúcido é a solução consagrada nos fóruns do Qt;
    janela de verdade translúcida nem recebe a decoração do DWM."""

    def __init__(self, pixmap: QPixmap) -> None:
        super().__init__(
            None,
            Qt.WindowType.SplashScreen
            | Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint,
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self._base = pixmap
        self.setPixmap(pixmap)
        self.setFixedSize(pixmap.size())
        screen = QApplication.primaryScreen()
        if screen is not None:
            geo = screen.availableGeometry()
            self.move(
                geo.center().x() - pixmap.width() // 2,
                geo.center().y() - pixmap.height() // 2,
            )

    def showEvent(self, event) -> None:
        super().showEvent(event)
        # A LINHA CINZA de 1px em volta é decoração do próprio Windows 11
        # (DWM) em janelas sem moldura. Interruptor oficial: border color
        # NONE + canto sem arredondar, direto na API do DWM.
        if sys.platform == "win32":
            try:
                import ctypes
                hwnd = int(self.winId())
                dwm = ctypes.windll.dwmapi
                # DWMWA_WINDOW_CORNER_PREFERENCE(33) = DWMWCP_DONOTROUND(1)
                pref = ctypes.c_int(1)
                dwm.DwmSetWindowAttribute(
                    hwnd, 33, ctypes.byref(pref), ctypes.sizeof(pref)
                )
                # DWMWA_BORDER_COLOR(34) = DWMWA_COLOR_NONE(0xFFFFFFFE)
                color = ctypes.c_uint(0xFFFFFFFE)
                dwm.DwmSetWindowAttribute(
                    hwnd, 34, ctypes.byref(color), ctypes.sizeof(color)
                )
            except Exception:
                pass

    def showMessage(self, text: str) -> None:
        """Redesenha o texto na faixa inferior do pixmap (o balão-legenda)."""
        from PySide6.QtCore import QRectF
        from PySide6.QtGui import QFont, QPainter

        pm = QPixmap(self._base)
        painter = QPainter(pm)
        painter.setPen(Qt.GlobalColor.white)
        painter.setFont(QFont("Segoe UI", 9))
        painter.drawText(
            QRectF(0, 0, pm.width(), pm.height() - 10),
            Qt.AlignmentFlag.AlignBottom | Qt.AlignmentFlag.AlignHCenter,
            text,
        )
        painter.end()
        self.setPixmap(pm)

    def finish(self, _win: QWidget) -> None:
        self.close()


def main() -> int:
    setup_logging()  # no-op if run.py already did it
    from .no_console import harden_subprocess
    harden_subprocess()  # no-op if run.py already did it
    app = QApplication(sys.argv)
    app.setApplicationName("AnCut HUB")
    app.setWindowIcon(_load_app_icon())

    # Splash "estilo After Effects": fica na tela DURANTE todo o carregamento
    # lento (rede + torch), com o status trocando embaixo do ícone. A janela
    # principal só aparece quando está pronta de verdade — e os diálogos que
    # precisam do usuário (update, deps, GPU) vêm depois, por cima dela.
    splash: _FloatingSplash | None = None
    pixmap = _load_splash_pixmap()
    if pixmap is not None:
        splash = _FloatingSplash(pixmap)
        splash.show()

    def status(text: str) -> None:
        if splash is not None:
            splash.showMessage(f"AnCut HUB v{__version__}\n{text}")
        app.processEvents()

    status("Carregando…")
    cfg = Config.load()
    cfg.ensure_dirs()
    get_logger().info(
        "Config: output=%s | cache=%s | models=%s",
        cfg.output_dir, cfg.cache_path, cfg.models_path,
    )

    # Trabalho lento e SILENCIOSO debaixo do splash (nenhum diálogo aqui,
    # senão o splash stay-on-top cobriria ele):
    # Auto-update DESATIVADO: o updater aponta pro repo do Corte Cenas original;
    # o AnCut HUB é um fork com caminho próprio, então não checamos releases
    # upstream (evita oferecer "atualizar" pro app do Levi por cima do fork).
    release = None

    status("Verificando dependências…")
    missing = missing_optional_deps()
    ffmpeg_ok = ffmpeg_available()

    status("Detectando GPU…")
    has_cuda = cuda_available()             # importa torch: ~5s no cold start

    status("Abrindo…")
    win = MainWindow(cfg)                   # rápido: torch já está em memória
    win.show()
    if splash is not None:
        splash.finish(win)
    # O usuário pode ter focado outra janela durante o load — sem isto o
    # Windows nega o primeiro plano e o app nasce atrás de tudo.
    win.raise_()
    win.activateWindow()

    # Agora sim os diálogos interativos, por cima da janela visível:
    # (auto-update desativado — ver nota acima; release é sempre None)

    if missing:
        MissingDepsDialog(missing).exec()

    if not ffmpeg_ok:
        FFmpegMissingDialog().exec()

    # Warn about CPU-only mode (no NVIDIA GPU with CUDA). App still runs,
    # just ~20x slower. Once dismissed with "don't ask again", we stay quiet.
    if not has_cuda and not cfg.gpu_warning_dismissed:
        dlg = NoGpuDialog()
        dlg.exec()
        if dlg.dont_ask_again:
            cfg.gpu_warning_dismissed = True
            cfg.save()

    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
