from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, QUrl, Signal
from PySide6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSizePolicy,
    QSlider,
    QVBoxLayout,
    QWidget,
)

# QtMultimedia é opcional: em builds sem os plugins de mídia (ou sem o backend
# FFmpeg do Qt), o import falha. Nesse caso MULTIMEDIA_OK=False e a ResultsTab
# volta pro comportamento antigo (abrir no player externo do sistema).
try:
    from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
    from PySide6.QtMultimediaWidgets import QVideoWidget

    MULTIMEDIA_OK = True
except Exception:  # pragma: no cover - depende do empacotamento
    MULTIMEDIA_OK = False


# Glifos do transporte. Todos existem na "Segoe UI Symbol" (verificado) e o
# QSS aponta os botões pra essa família — não use nenhum caractere aqui sem
# conferir, senão volta a aparecer quadradinho.
# U+FE0E (VARIATION SELECTOR-15) força apresentação de TEXTO: sem ele o
# Windows entrega a versão colorida (Segoe UI Emoji) e o ícone destoa dos
# outros, que são monocromáticos.
_TEXT = "︎"
ICON_PLAY = "▶" + _TEXT
ICON_PAUSE = "⏸" + _TEXT
ICON_LOOP = "↻"
ICON_SOUND = "\U0001F568"   # 🕨 alto-falante (monocromático, não-emoji)
ICON_MUTED = "\U0001F507" + _TEXT
ICON_EXTERNAL = "↗"


def _fmt_ms(ms: int) -> str:
    s = max(0, ms) // 1000
    return f"{s // 60:d}:{s % 60:02d}"


class SeekSlider(QSlider):
    """Barra de progresso que salta pro ponto clicado.

    O QSlider padrão anda de "página" a cada clique no trilho, o que num player
    é sempre frustrante: você clica no meio da cena e ele dá um passinho. Aqui
    o clique posiciona direto e já entra em modo de arrasto.
    """

    def mousePressEvent(self, event) -> None:
        if (
            event.button() == Qt.MouseButton.LeftButton
            and self.maximum() > self.minimum()
        ):
            span = self.maximum() - self.minimum()
            ratio = event.position().x() / max(1, self.width())
            value = self.minimum() + round(min(1.0, max(0.0, ratio)) * span)
            self.setValue(value)
            self.sliderMoved.emit(value)
        super().mousePressEvent(event)


class PreviewPanel(QWidget):
    """Player embutido pra rever um shot sem abrir o player externo.

    Um clique na grade carrega o clipe (pausado no 1º frame); duplo clique
    dá play. Por padrão o clipe fica em loop — cenas são curtas e a ideia é
    revisar/curar rápido. O botão ⧉ ainda abre no player do sistema pra quem
    preferir (emite `open_external_requested`).
    """

    open_external_requested = Signal(Path)

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._current_path: Path | None = None
        self._seeking = False
        self._loop = True

        self.player = QMediaPlayer(self)
        self.audio = QAudioOutput(self)
        self.audio.setVolume(0.8)
        self.audio.setMuted(True)  # áudio OFF por padrão (o usuário liga no botão)
        self.player.setAudioOutput(self.audio)
        if self._loop:
            self.player.setLoops(QMediaPlayer.Loops.Infinite)

        self.video = QVideoWidget(self)
        self.video.setMinimumSize(240, 135)
        # Vertical FIXO — a altura é setada em resizeEvent pra manter 16:9 e não
        # esticar num bloco preto alto. O espaço que sobra fica limpo (bg do app).
        self.video.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        self.video.setStyleSheet("background:#0A0C10; border-radius:10px;")
        self.player.setVideoOutput(self.video)

        self.title = QLabel("Selecione uma cena para pré-visualizar.")
        self.title.setObjectName("previewTitle")
        self.title.setWordWrap(True)

        # --- transporte ---
        # NOTA: os glifos de mídia (▶ ⏸ ↻ 🔊) NÃO existem na Segoe UI — só na
        # "Segoe UI Symbol". Como o QSS global força font-family sem ela, eles
        # caíam em quadradinho. Os objectName abaixo recebem a família certa
        # no QSS (previewPlay / previewIcon).
        self.btn_play = QPushButton(ICON_PLAY)
        self.btn_play.setObjectName("previewPlay")
        self.btn_play.setFixedSize(38, 38)
        self.btn_play.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_play.setToolTip("Play / Pause")
        self.btn_play.clicked.connect(self.toggle_play)

        self.pos_slider = SeekSlider(Qt.Orientation.Horizontal)
        self.pos_slider.setObjectName("scrubber")
        self.pos_slider.setRange(0, 0)
        self.pos_slider.setCursor(Qt.CursorShape.PointingHandCursor)
        self.pos_slider.sliderPressed.connect(lambda: setattr(self, "_seeking", True))
        self.pos_slider.sliderReleased.connect(self._on_seek_released)
        # Scrub ao vivo: o vídeo acompanha o arrasto (e o clique-pra-saltar do
        # SeekSlider, que emite sliderMoved).
        self.pos_slider.sliderMoved.connect(self.player.setPosition)

        self.time_label = QLabel("0:00 / 0:00")
        self.time_label.setObjectName("previewTime")

        self.btn_loop = QPushButton(ICON_LOOP)
        # Toggle "de verdade": acende verde quando ativo (o mudo NÃO usa isso —
        # verde ali leria como "som ligado", o oposto do estado real).
        self.btn_loop.setObjectName("previewToggle")
        self.btn_loop.setCheckable(True)
        self.btn_loop.setChecked(True)
        self.btn_loop.setFixedSize(32, 32)
        self.btn_loop.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_loop.setToolTip("Repetir a cena em loop")
        self.btn_loop.toggled.connect(self._on_loop_toggled)

        self.btn_mute = QPushButton(ICON_MUTED)
        self.btn_mute.setObjectName("previewIcon")
        self.btn_mute.setCheckable(True)
        self.btn_mute.setFixedSize(32, 32)
        self.btn_mute.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_mute.setToolTip("Mudo")
        self.btn_mute.toggled.connect(self._on_mute_toggled)
        self.btn_mute.setChecked(True)  # começa mudo (reflete o áudio off padrão)

        self.vol_slider = QSlider(Qt.Orientation.Horizontal)
        self.vol_slider.setObjectName("volumeSlider")
        self.vol_slider.setRange(0, 100)
        self.vol_slider.setValue(80)
        self.vol_slider.setFixedWidth(72)
        self.vol_slider.setCursor(Qt.CursorShape.PointingHandCursor)
        self.vol_slider.setToolTip("Volume")
        self.vol_slider.valueChanged.connect(self._on_volume_changed)

        self.btn_external = QPushButton(ICON_EXTERNAL)
        self.btn_external.setObjectName("previewIcon")
        self.btn_external.setFixedSize(32, 32)
        self.btn_external.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_external.setToolTip("Abrir no player do sistema")
        self.btn_external.clicked.connect(self._emit_external)

        # Duas linhas, como player moderno: a barra de progresso ocupa a
        # largura toda (num painel estreito ela ficava espremida entre os
        # botões e virava um traço inútil), e o transporte vem embaixo.
        controls = QVBoxLayout()
        controls.setSpacing(2)
        controls.addWidget(self.pos_slider)

        transport = QHBoxLayout()
        transport.setSpacing(6)
        transport.addWidget(self.btn_play)
        transport.addWidget(self.time_label)
        transport.addStretch(1)
        transport.addWidget(self.btn_loop)
        transport.addWidget(self.btn_mute)
        transport.addWidget(self.vol_slider)
        transport.addWidget(self.btn_external)
        controls.addLayout(transport)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)
        layout.addWidget(self.title)
        layout.addWidget(self.video, 0)          # 16:9, altura fixa (resizeEvent)
        layout.addLayout(controls)               # scrubber + transporte abaixo
        layout.addStretch(1)                     # sobra fica limpa (sem bloco preto)

        self.player.positionChanged.connect(self._on_position)
        self.player.durationChanged.connect(self._on_duration)
        self.player.playbackStateChanged.connect(self._on_state)

        self._set_controls_enabled(False)

    def resizeEvent(self, event) -> None:
        # Mantém o vídeo em 16:9: a altura segue a largura disponível, então
        # não vira um bloco preto alto com letterbox.
        super().resizeEvent(event)
        w = self.video.width()
        if w > 0:
            self.video.setFixedHeight(round(w * 9 / 16))

    # ------------------------------------------------------------------ API
    def load_shot(
        self, root: Path, row: dict, autoplay: bool = False, muted: bool | None = None
    ) -> None:
        """Carrega o clipe do shot. `root` é o episode_root; `row['file']` é o
        caminho relativo do clipe (mesmo que a ResultsTab usa no player externo).
        `muted`: None mantém o estado atual; True/False força mudo (usado pela
        prévia no hover, que é sempre muda; e pelo play explícito, com som)."""
        rel = row.get("file")
        if not rel:
            return
        path = Path(root) / rel
        if not path.exists():
            self.title.setText(f"Arquivo não encontrado: {rel}")
            self._set_controls_enabled(False)
            return
        if muted is not None:
            self.audio.setMuted(muted)
            self.btn_mute.setChecked(muted)
        self._current_path = path
        idx = row.get("idx")
        conf = row.get("confidence")
        head = f"#{idx:04d}  ·  confiança {conf:.2f}" if idx is not None else path.name
        self.title.setText(head)
        self.player.setSource(QUrl.fromLocalFile(str(path)))
        self._set_controls_enabled(True)
        if autoplay:
            self.player.play()
        else:
            # Mostra o 1º frame sem tocar áudio: play + pause imediato.
            self.player.play()
            self.player.pause()

    def play_shot(self, root: Path, row: dict) -> None:
        # Play explícito (duplo clique): mantém o estado de mudo atual — o
        # áudio começa OFF por padrão; o usuário liga no botão se quiser.
        self.load_shot(root, row, autoplay=True, muted=None)

    def hover_preview(self, root: Path, row: dict) -> None:
        # Prévia animada (GIF-like) do hover: sempre muda, em loop.
        self.load_shot(root, row, autoplay=True, muted=True)

    def toggle_play(self) -> None:
        if self._current_path is None:
            return
        if self.player.playbackState() == QMediaPlayer.PlaybackState.PlayingState:
            self.player.pause()
        else:
            self.player.play()

    def clear(self) -> None:
        self.player.stop()
        self.player.setSource(QUrl())
        self._current_path = None
        self.title.setText("Selecione uma cena para pré-visualizar.")
        self.pos_slider.setRange(0, 0)
        self.time_label.setText("0:00 / 0:00")
        self._set_controls_enabled(False)

    def stop(self) -> None:
        self.player.stop()

    # -------------------------------------------------------------- internos
    def _set_controls_enabled(self, on: bool) -> None:
        for w in (self.btn_play, self.pos_slider, self.btn_loop, self.btn_mute,
                  self.vol_slider, self.btn_external):
            w.setEnabled(on)

    def _on_seek_released(self) -> None:
        self._seeking = False
        self.player.setPosition(self.pos_slider.value())

    def _on_position(self, pos: int) -> None:
        if not self._seeking:
            self.pos_slider.setValue(pos)
        self.time_label.setText(f"{_fmt_ms(pos)} / {_fmt_ms(self.player.duration())}")

    def _on_duration(self, dur: int) -> None:
        self.pos_slider.setRange(0, dur)
        self.time_label.setText(f"{_fmt_ms(self.player.position())} / {_fmt_ms(dur)}")

    def _on_state(self, state) -> None:
        playing = state == QMediaPlayer.PlaybackState.PlayingState
        self.btn_play.setText(ICON_PAUSE if playing else ICON_PLAY)

    def _on_loop_toggled(self, on: bool) -> None:
        self._loop = on
        self.player.setLoops(
            QMediaPlayer.Loops.Infinite if on else QMediaPlayer.Loops.Once
        )

    def _on_mute_toggled(self, on: bool) -> None:
        self.audio.setMuted(on)
        self.btn_mute.setText(ICON_MUTED if on else ICON_SOUND)

    def _on_volume_changed(self, val: int) -> None:
        self.audio.setVolume(val / 100.0)
        if val == 0:
            self.btn_mute.setChecked(True)
        elif self.btn_mute.isChecked():
            self.btn_mute.setChecked(False)

    def _emit_external(self) -> None:
        if self._current_path is not None:
            self.open_external_requested.emit(self._current_path)
