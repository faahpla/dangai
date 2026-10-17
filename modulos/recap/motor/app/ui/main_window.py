from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, QThread
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from ..config import Config
from ..deps_check import cuda_available, gpu_name
from ..pipeline_types import PipelineResult
from . import quiet
from .analyze_tab import AnalyzeTab
from .results_tab import ResultsTab
from .settings_dialog import SettingsDialog


def _device_badge_text() -> str:
    if cuda_available():
        # Shorten "NVIDIA GeForce RTX 5080" -> "RTX 5080" so the badge stays
        # narrow. Fallback to "GPU" if the name doesn't fit the pattern.
        name = gpu_name() or "GPU"
        for token in ("GeForce ", "NVIDIA ", "Nvidia "):
            name = name.replace(token, "")
        return f"🟢  {name.strip()}"
    return "🟡  CPU (lento)"


def _device_badge_style() -> str:
    color = "#4ADE80" if cuda_available() else "#F5B454"
    return (
        f"QLabel{{color:{color};background:#151A21;border:1px solid #272E39;"
        f"border-radius:10px;padding:7px 13px;font-size:12px;font-weight:600;}}"
    )


_DARK_QSS = """
/* ============================================================
   AnCut HUB — design system (Raycast / Linear / Arc / Cursor).
   Fundo neutro fosco #0E1116 · superfícies #151A21 · hover #1D2430
   · bordas hairline #272E39. Verde #4ADE80 SÓ pra sucesso/seleção/
   progresso/ação principal. Secundária indigo #6366F1. Cantos 10–14px,
   hierarquia tipográfica clara, espaço negativo.
   ============================================================ */

* { font-family: "Inter", "Geist", "Segoe UI", system-ui, sans-serif; }

/* ---------- ESCALA TIPOGRÁFICA (única fonte de verdade) ----------
   11px  legenda      — descrições de apoio, contadores
   12px  secundário   — labels de campo, status, barra de progresso
   13px  corpo        — padrão de todo widget, botões, inputs
   14px  subtítulo    — títulos de painel, abas, título de cartão
   18px  título       — wordmark da marca
   Nada de tamanho fracionário (11.5/10.5 renderizam borrado no Qt).
   ------------------------------------------------------------------ */

/* Fundo neutro fosco FLAT (sem degradê). Um único tom slate matte, levantado
   o bastante pra ler como cinza-neutro e não "preto chapado". Os painéis
   (#1B202A) ficam um passo acima, criando profundidade só pelo contraste de
   superfície — sem gradiente. */
/* ORDEM IMPORTA: `QWidget` casa com QMainWindow/QDialog também (o seletor de
   tipo pega subclasses) e tem a MESMA especificidade CSS, então a última regra
   vence. Por isso o transparente genérico vem PRIMEIRO e as janelas depois —
   senão o fundo da janela/diálogo vira transparente e pinta preto. */
QWidget { background: transparent; color: #E6E9EF; font-size: 13px; }
QMainWindow { background: #161B22; }
QDialog { background: #161B22; }
/* Container principal: mesmo flat (seguro caso o central sobreponha a janela). */
QWidget#appCanvas { background: #161B22; }
/* Scroll da janela de Configurações: sem moldura. O fundo flat do viewport é
   forçado no próprio settings_dialog.py (viewport + container), porque QSS de
   viewport de QScrollArea é traiçoeiro e uma regra ampla aqui sobrescreveria
   a superfície dos QGroupBox. */
QScrollArea { border: none; }

/* Painéis: superfície com gradiente vertical PRÓPRIO (topo mais claro → base
   mais escura) — profundidade fosca visível em cada painel, sem chapado.
   Hairline sutil. */
QGroupBox {
    background: #1B202A;
    border: 1px solid #2A313D; border-radius: 13px;
    margin-top: 0px; padding: 32px 14px 12px 14px; font-size: 13px;
}
/* Título DENTRO da box (sem "chip" flutuante na borda): origem no padding-box,
   fundo transparente. O padding-top acima reserva a faixa onde ele fica. */
QGroupBox::title {
    subcontrol-origin: margin; subcontrol-position: top left;
    left: 15px; top: 11px; padding: 0;
    background: transparent; color: #FFFFFF;
    font-weight: 700; font-size: 14px;
}
/* Painéis de apoio (1 e 2 da aba Analisar): menos respiro e título em cinza
   secundário — ficam discretos pra que o painel 3 (progresso) seja o herói. */
QGroupBox[compact="true"] { padding: 25px 12px 9px 12px; }
QGroupBox[compact="true"]::title {
    left: 13px; top: 8px; color: #9AA4B2; font-size: 13px; font-weight: 600;
}
/* Campos mais baixos SÓ dentro dos painéis compactos — o resto do app
   (Configurações, Resultados) mantém a altura confortável. */
/* min-height = altura REAL da linha (17px na fonte de 13px). Abaixo disso o
   Qt usa esse valor como altura do conteúdo e corta as maiúsculas/descidas —
   foi o que aconteceu com 9px. O ganho de compactação vem do padding menor. */
QGroupBox[compact="true"] QLineEdit,
QGroupBox[compact="true"] QSpinBox,
QGroupBox[compact="true"] QDoubleSpinBox,
QGroupBox[compact="true"] QComboBox { padding: 5px 9px; min-height: 17px; }
QGroupBox[compact="true"] QLabel#fieldLabel {
    font-size: 11px; padding: 1px 0 0 2px;
}
QLabel { background: transparent; color: #C7CDD6; }
QLabel#fieldLabel { color: #9AA4B2; font-size: 12px; font-weight: 600; padding: 2px 0 1px 2px; }

/* Inputs Raycast: recuados no fundo, hairline, focus verde. */
QLineEdit, QSpinBox, QDoubleSpinBox, QComboBox, QPlainTextEdit, QTextEdit {
    background: #0E1116; border: 1px solid #272E39; border-radius: 9px;
    padding: 7px 10px; color: #FFFFFF; min-height: 18px;
    selection-background-color: #1f5133; selection-color: #FFFFFF;
}
QLineEdit:hover, QSpinBox:hover, QComboBox:hover { border-color: #313A48; background: #10151C; }
QLineEdit:focus, QSpinBox:focus, QDoubleSpinBox:focus, QComboBox:focus,
QPlainTextEdit:focus, QTextEdit:focus { border: 1px solid #4ADE80; }
QLineEdit:disabled, QComboBox:disabled { background: #12161C; color: #6B7280; }

/* ComboBox */
QComboBox::drop-down { border: none; width: 22px; }
QComboBox::down-arrow {
    image: none; border-left: 4px solid transparent; border-right: 4px solid transparent;
    border-top: 5px solid #9AA4B2; margin-right: 8px;
}
QComboBox QAbstractItemView {
    background: #151A21; border: 1px solid #272E39; border-radius: 10px;
    padding: 5px; outline: 0; selection-background-color: #1D2430;
}
QComboBox QAbstractItemView::item { padding: 7px 10px; border-radius: 8px; }

/* SpinBox */
QSpinBox::up-button, QDoubleSpinBox::up-button,
QSpinBox::down-button, QDoubleSpinBox::down-button {
    background: #1D2430; border: none; width: 18px; border-radius: 5px; margin: 2px;
}
QSpinBox::up-button:hover, QSpinBox::down-button:hover { background: #272E39; }
QSpinBox::up-arrow { image: none; border-left: 4px solid transparent; border-right: 4px solid transparent; border-bottom: 5px solid #9AA4B2; }
QSpinBox::down-arrow { image: none; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid #9AA4B2; }

/* Botões — 3 níveis. Secundário (cinza). */
QPushButton {
    background: #1D2430; color: #E6E9EF; border: 1px solid #272E39;
    padding: 7px 13px; border-radius: 9px; font-weight: 600;
}
QPushButton:hover { background: #232C3A; border-color: #313A48; }
QPushButton:pressed { background: #171D26; }
QPushButton:disabled { background: #151A21; color: #6B7280; border-color: #1F2530; }
/* Primário verde (ação principal). */
QPushButton[accent="true"] { background: #4ADE80; color: #052012; border: none; font-weight: 700; }
QPushButton[accent="true"]:hover { background: #5AE68D; }
QPushButton[accent="true"]:pressed { background: #3ECB72; }
QPushButton[accent="true"]:disabled { background: #1C3524; color: #5C7A68; }
/* Especial IA: gradiente azul→roxo. */
QPushButton#aiButton { background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #4F46E5, stop:1 #7C3AED); color: #FFFFFF; border: none; font-weight: 700; }
QPushButton#aiButton:hover { background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #5B52EE, stop:1 #8A4BF2); }
QPushButton#aiButton:disabled { background: #2B2B4A; color: #7D7BA3; }
/* Cancelar. */
QPushButton#dangerButton { background: #7F1D1D; color: #FFFFFF; border: none; font-weight: 700; }
QPushButton#dangerButton:hover { background: #991F1F; }

/* Cartões do modo de reconhecimento. */
QFrame#modeCard { background: #0E1116; border: 1px solid #272E39; border-radius: 12px; }
QFrame#modeCard:hover { background: #12171F; border-color: #313A48; }
QFrame#modeCard[selected="true"] { border: 1px solid #4ADE80; background: #10201699; }
QRadioButton#modeRadio { font-weight: 700; color: #FFFFFF; font-size: 14px; spacing: 8px; }
QRadioButton#modeRadio:checked { color: #FFFFFF; }
QLabel#modeDesc { color: #9AA4B2; font-size: 12px; padding-left: 24px; }

/* Progresso: fino, verde. */
QProgressBar {
    background: #0E1116; border: 1px solid #272E39; border-radius: 7px;
    text-align: center; height: 8px; color: #9AA4B2; font-size: 12px;
}
QProgressBar::chunk { border-radius: 6px; background: #4ADE80; }

/* Abas: pill discreta. O `left` recua a barra pra mesma margem do logo e dos
   painéis (14px) — sem isso ela nasce colada na borda da janela e fica
   desalinhada de todo o resto do cabeçalho. */
QTabWidget::pane { border: none; top: 0; }
QTabWidget::tab-bar { left: 14px; }
QTabBar { qproperty-drawBase: 0; }
QTabBar::tab {
    background: transparent; color: #9AA4B2; padding: 8px 18px; margin-right: 4px;
    border: none; border-radius: 10px; font-weight: 600; font-size: 14px;
}
QTabBar::tab:hover { color: #FFFFFF; background: #1D2430; }
QTabBar::tab:selected { color: #FFFFFF; background: #1D2430; }

/* Listas / grade — gradiente sutil (não chapado). */
QListWidget { background: #12161D; border: 1px solid #272E39; border-radius: 11px; outline: 0; padding: 4px; }
QListWidget::item { border-radius: 9px; padding: 6px 8px; margin: 2px; color: #C7CDD6; }
QListWidget::item:hover { background: #1D2430; }
QListWidget::item:selected { background: #14251B; border: 1px solid #4ADE80; color: #FFFFFF; }

/* Sliders genéricos (ex.: escala da grade de clips). */
QSlider::groove:horizontal { height: 4px; background: #272E39; border-radius: 2px; }
QSlider::sub-page:horizontal { background: #4ADE80; border-radius: 2px; }
QSlider::handle:horizontal { background: #FFFFFF; width: 13px; height: 13px; margin: -5px 0; border-radius: 7px; }

/* ---------------- Player de prévia ---------------- */
/* Scrubber: trilho grosso e arredondado, progresso verde, punho branco que
   cresce no hover/arrasto. Área de clique generosa (margin negativa). */
QSlider#scrubber { min-height: 22px; }
QSlider#scrubber::groove:horizontal {
    height: 6px; background: #272E39; border-radius: 3px;
}
QSlider#scrubber::sub-page:horizontal {
    background: #4ADE80; border-radius: 3px;
}
QSlider#scrubber::add-page:horizontal {
    background: #272E39; border-radius: 3px;
}
QSlider#scrubber::handle:horizontal {
    background: #FFFFFF; width: 14px; height: 14px;
    margin: -4px 0; border-radius: 7px;
}
QSlider#scrubber::handle:horizontal:hover,
QSlider#scrubber::handle:horizontal:pressed {
    background: #FFFFFF; width: 18px; height: 18px;
    margin: -6px 0; border-radius: 9px;
}

/* Volume: mesma linguagem, porém discreto (cinza, não rouba o verde). */
QSlider#volumeSlider::groove:horizontal { height: 4px; background: #272E39; border-radius: 2px; }
QSlider#volumeSlider::sub-page:horizontal { background: #6B7280; border-radius: 2px; }
QSlider#volumeSlider::handle:horizontal {
    background: #C7CDD6; width: 11px; height: 11px; margin: -4px 0; border-radius: 6px;
}
QSlider#volumeSlider::handle:horizontal:hover { background: #FFFFFF; }

/* Botão principal do player: círculo verde.
   font-family explícita — os glifos de mídia só existem na Segoe UI Symbol. */
QPushButton#previewPlay {
    background: #4ADE80; color: #052012; border: none;
    border-radius: 19px; font-size: 15px; font-weight: 700; padding: 0;
    font-family: "Segoe UI Symbol", "Segoe UI", sans-serif;
}
QPushButton#previewPlay:hover { background: #5AE68D; }
QPushButton#previewPlay:pressed { background: #3ECB72; }
QPushButton#previewPlay:disabled { background: #1C3524; color: #5C7A68; }

/* Botões secundários do player: fantasma redondo, acende no hover. */
QPushButton#previewIcon, QPushButton#previewToggle {
    background: transparent; color: #9AA4B2; border: 1px solid transparent;
    border-radius: 16px; font-size: 14px; font-weight: 600; padding: 0;
    font-family: "Segoe UI Symbol", "Segoe UI", sans-serif;
}
QPushButton#previewIcon:hover, QPushButton#previewToggle:hover {
    background: #1D2430; color: #FFFFFF; border-color: #313A48;
}
QPushButton#previewIcon:pressed, QPushButton#previewToggle:pressed { background: #171D26; }
QPushButton#previewIcon:disabled, QPushButton#previewToggle:disabled {
    color: #4A5260; background: transparent; border-color: transparent;
}
/* Só o loop acende verde quando ativo. O mudo apenas apaga (ver abaixo):
   verde ali seria lido como "som ligado", que é o contrário do estado. */
QPushButton#previewToggle:checked { background: #14251B; color: #4ADE80; border-color: #4ADE80; }
QPushButton#previewIcon:checked { color: #6B7280; background: transparent; }

QLabel#previewTitle { color: #9AA4B2; font-size: 12px; padding: 2px; }
QLabel#previewTime {
    color: #9AA4B2; font-size: 12px; font-weight: 600;
    font-family: "Consolas", "Cascadia Mono", monospace;
}

QSplitter::handle { background: transparent; }
QSplitter::handle:horizontal { width: 10px; }
QSplitter::handle:hover { background: #4ADE8033; border-radius: 4px; }

/* Scrollbars finas. */
QScrollBar:vertical { background: transparent; width: 10px; margin: 3px; }
QScrollBar::handle:vertical { background: #272E39; min-height: 30px; border-radius: 5px; }
QScrollBar::handle:vertical:hover { background: #313A48; }
QScrollBar:horizontal { background: transparent; height: 10px; margin: 3px; }
QScrollBar::handle:horizontal { background: #272E39; min-width: 30px; border-radius: 5px; }
QScrollBar::handle:horizontal:hover { background: #313A48; }
QScrollBar::add-line, QScrollBar::sub-line { width: 0; height: 0; }
QScrollBar::add-page, QScrollBar::sub-page { background: transparent; }

QToolTip { background: #151A21; color: #E6E9EF; border: 1px solid #272E39; border-radius: 8px; padding: 6px 9px; }
QMenu { background: #151A21; border: 1px solid #272E39; border-radius: 12px; padding: 6px; }
QMenu::item { padding: 8px 22px; border-radius: 8px; color: #C7CDD6; }
QMenu::item:selected { background: #1D2430; color: #FFFFFF; }
QMenu::separator { height: 1px; background: #272E39; margin: 6px 10px; }

/* Radio / checkbox com acento verde. */
QRadioButton, QCheckBox { spacing: 8px; color: #C7CDD6; }
QRadioButton::indicator { width: 16px; height: 16px; border-radius: 9px; border: 2px solid #3A4250; background: #0E1116; }
QRadioButton::indicator:hover { border-color: #4ADE80; }
QRadioButton::indicator:checked {
    border-color: #4ADE80;
    background: qradialgradient(cx:0.5, cy:0.5, radius:0.5, fx:0.5, fy:0.5,
        stop:0 #4ADE80, stop:0.5 #4ADE80, stop:0.62 #0E1116, stop:1 #0E1116);
}
QRadioButton:checked { color: #FFFFFF; font-weight: 600; }
QCheckBox::indicator { width: 16px; height: 16px; border-radius: 5px; border: 2px solid #3A4250; background: #0E1116; }
QCheckBox::indicator:hover { border-color: #4ADE80; }
QCheckBox::indicator:checked { border-color: #4ADE80; background: #4ADE80; }
"""


_VIDEO_EXTS = (".mp4", ".mkv", ".mov", ".avi", ".webm", ".ts", ".m2ts")


class MainWindow(QMainWindow):
    def __init__(self, config: Config) -> None:
        super().__init__()
        self.config = config
        self.setWindowTitle("AnCut HUB — Analisador de Anime")
        self.resize(1100, 720)
        self.setStyleSheet(_DARK_QSS)
        # Drop an episode file anywhere on the window to load it in Analisar.
        self.setAcceptDrops(True)

        self.tabs = QTabWidget()
        self.analyze = AnalyzeTab(config, self)
        self.results = ResultsTab(config, self)

        self.tabs.addTab(self.analyze, "Analisar")
        self.tabs.addTab(self.results, "Resultados")

        # Top bar: marca (logo + nome) à esquerda; badge de GPU e Configurações
        # à direita. Dá cara de "produto" em vez de só uma fileira de abas.
        top_bar = QHBoxLayout()
        top_bar.setContentsMargins(14, 10, 14, 8)
        top_bar.setSpacing(10)
        # Tudo do cabeçalho centrado na mesma linha ótica (o padrão alinha
        # pelo topo e o badge/botão ficavam desencontrados da marca).
        top_bar.setAlignment(Qt.AlignmentFlag.AlignVCenter)

        logo = QLabel()
        # logo_header.png é a marca recortada (sem a margem do ícone quadrado),
        # em 2x — no cabeçalho ela ocupa a altura toda em vez de flutuar com
        # sobra em cima e embaixo. Cai no ícone quadrado se faltar o arquivo.
        assets = Path(__file__).resolve().parent.parent / "assets"
        for name in ("logo_header.png", "icon_64.png", "icon_32.png"):
            logo_path = assets / name
            if not logo_path.exists():
                continue
            pm = QPixmap(str(logo_path))
            if pm.isNull():
                continue
            logo.setPixmap(
                pm.scaledToHeight(28, Qt.TransformationMode.SmoothTransformation)
            )
            break
        top_bar.addWidget(logo, 0, Qt.AlignmentFlag.AlignVCenter)

        brand_col = QVBoxLayout()
        brand_col.setSpacing(0)
        brand_col.setContentsMargins(2, 0, 0, 0)
        wordmark = QLabel("AnCut&nbsp;<span style='color:#4ADE80;'>HUB</span>")
        wordmark.setTextFormat(Qt.TextFormat.RichText)
        wordmark.setStyleSheet(
            "font-size:18px; font-weight:800; color:#FFFFFF; letter-spacing:0.3px;"
        )
        brand_col.addWidget(wordmark)
        subtitle = QLabel("Anime Scene Analyzer")
        subtitle.setStyleSheet("font-size:11px; color:#9AA4B2; letter-spacing:0.4px;")
        brand_col.addWidget(subtitle)
        top_bar.addLayout(brand_col)

        top_bar.addStretch(1)

        self.device_label = QLabel(_device_badge_text())
        self.device_label.setStyleSheet(_device_badge_style())
        self.device_label.setToolTip(
            "Verde: rodando em GPU NVIDIA (rápido).\n"
            "Amarelo: sem GPU detectada, roda em CPU (~20x mais lento)."
        )
        # Mesma altura do botão ao lado pra os dois lerem como um par.
        self.device_label.setFixedHeight(34)
        self.device_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        top_bar.addWidget(self.device_label, 0, Qt.AlignmentFlag.AlignVCenter)

        self.settings_btn = QPushButton("⚙  Configurações")
        self.settings_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.settings_btn.setStyleSheet(
            "QPushButton{"
            "background:#151A21;color:#C7CDD6;border:1px solid #272E39;"
            "border-radius:10px;padding:7px 15px;font-size:13px;"
            "}"
            "QPushButton:hover{background:#1D2430;color:#fff;border-color:#313A48;}"
        )
        self.settings_btn.setFixedHeight(34)
        self.settings_btn.clicked.connect(self._open_settings)
        top_bar.addWidget(self.settings_btn, 0, Qt.AlignmentFlag.AlignVCenter)

        central = QWidget()
        # Pinta o gradiente direto no container (seguro caso o fundo da
        # QMainWindow não pinte por causa do widget central sobrepor).
        central.setObjectName("appCanvas")
        central.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        root = QVBoxLayout(central)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(4)
        root.addLayout(top_bar)
        root.addWidget(self.tabs)

        self.analyze.pipeline_finished.connect(self._on_pipeline_finished)

        self.setCentralWidget(central)

    @staticmethod
    def _video_from_mime(mime) -> str | None:
        if not mime.hasUrls():
            return None
        for url in mime.urls():
            if not url.isLocalFile():
                continue
            path = url.toLocalFile()
            if path.lower().endswith(_VIDEO_EXTS):
                return path
        return None

    def dragEnterEvent(self, event) -> None:
        if self._video_from_mime(event.mimeData()):
            event.acceptProposedAction()

    def dropEvent(self, event) -> None:
        path = self._video_from_mime(event.mimeData())
        if not path:
            return
        event.acceptProposedAction()
        self.tabs.setCurrentWidget(self.analyze)
        self.analyze.set_video(path)

    def _open_settings(self) -> None:
        dlg = SettingsDialog(self.config, self)
        if dlg.exec():
            # Sync the output-dir field in AnalyzeTab so the user sees the
            # updated value without restarting the app.
            try:
                self.analyze.output_edit.setText(self.config.output_dir)
            except Exception:
                pass
            # AI review button's enabled state depends on whether a key is set.
            try:
                self.results._refresh_char_buttons()
            except Exception:
                pass

    def _on_pipeline_finished(self, result: PipelineResult) -> None:
        self.results.display_result(result)
        self.tabs.setCurrentWidget(self.results)

    def closeEvent(self, event) -> None:
        """Stop any background workers before letting Qt destroy the window,
        so we don't get 'QThread: Destroyed while thread is still running'.
        """
        running: list[QThread] = []
        for t in (
            getattr(self.analyze, "_thread", None),
            getattr(self.results, "_worker_thread", None),
        ):
            if isinstance(t, QThread) and t.isRunning():
                running.append(t)

        if running:
            reply = quiet.question(
                self,
                "Análise em andamento",
                "Tem uma análise rodando. Fechar mesmo assim?\n"
                "(O processamento vai ser interrompido; shots já cortados ficam salvos.)",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No,
            )
            if reply != QMessageBox.StandardButton.Yes:
                event.ignore()
                return
            for t in running:
                t.quit()
                t.wait(3000)
                if t.isRunning():
                    t.terminate()
                    t.wait(1000)
        event.accept()
