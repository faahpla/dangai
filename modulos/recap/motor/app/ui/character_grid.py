from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QEvent, QRect, QRectF, QSize, Qt, QTimer, Signal
from PySide6.QtGui import (
    QAction,
    QColor,
    QFont,
    QIcon,
    QImageReader,
    QPainter,
    QPen,
    QPixmap,
    QPixmapCache,
)
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QMenu,
    QSlider,
    QStyle,
    QStyledItemDelegate,
    QVBoxLayout,
    QWidget,
)

from ..storage.db import Database

# Áudio no hover (item 4) depende do QtMultimedia — opcional, como no preview.
try:
    from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer

    MULTIMEDIA_OK = True
except Exception:  # pragma: no cover
    MULTIMEDIA_OK = False

# Miniaturas decodificadas em resolução maior que o card base, pra continuarem
# nítidas quando o usuário aumenta a escala da grade (slider até 300px).
_THUMB = QSize(320, 180)
_CACHE_SIZED = False

# Geometria do card (item 3). O grid da lista usa esses números.
_PAD = 6
_CAPTION_H = 26
_CARD_W = _THUMB.width() + 2 * _PAD
_CARD_H = _THUMB.height() + _CAPTION_H + 2 * _PAD
_GRID = QSize(_CARD_W + 8, _CARD_H + 8)


def _ensure_cache_size() -> None:
    """Miniaturas de keyframe cabem folgado em 64 MB (~80 KB cada depois de
    reduzidas). O padrão do Qt (10 MB) expulsava as antigas no meio de uma
    pasta grande, refazendo o trabalho a cada recarga da grade. Chamado no
    primeiro ShotGrid (com o QApplication já vivo, não no import)."""
    global _CACHE_SIZED
    if not _CACHE_SIZED:
        _CACHE_SIZED = True
        QPixmapCache.setCacheLimit(64 * 1024)  # em KB


def _thumbnail(path: Path) -> QPixmap | None:
    """Miniatura de um keyframe, com cache.

    Duas otimizações contra a 'travadinha' ao recarregar a grade (que
    acontece a cada remover/mover/aprovar):
    - QImageReader.setScaledSize: o JPEG é decodificado JÁ pequeno (o formato
      permite decodificar em resolução reduzida) em vez de abrir o quadro
      1080p inteiro pra depois encolher;
    - QPixmapCache: cada keyframe vira miniatura UMA vez por sessão — as
      recargas seguintes só repovoam a grade com pixmaps prontos.
    """
    key = f"cc_thumb:{path}"
    pix = QPixmapCache.find(key)
    if pix is not None and not pix.isNull():
        return pix
    reader = QImageReader(str(path))
    size = reader.size()
    if size.isValid():
        scaled = size.scaled(_THUMB, Qt.AspectRatioMode.KeepAspectRatio)
        reader.setScaledSize(scaled)
    img = reader.read()
    if img.isNull():
        return None
    pix = QPixmap.fromImage(img)
    QPixmapCache.insert(key, pix)
    return pix


def _conf_color(conf: float) -> QColor:
    """Cor do selo de confiança: verde (alta) → âmbar (média) → vermelho."""
    if conf >= 0.90:
        return QColor("#4CAF50")
    if conf >= 0.75:
        return QColor("#DDB077")
    return QColor("#c77b7b")


class ShotCardDelegate(QStyledItemDelegate):
    """Desenha cada shot como um card: thumbnail com cantos arredondados +
    barra inferior com o número da cena e um selo de confiança colorido.

    Substitui o visual 'ícone + texto embaixo' padrão do QListWidget por algo
    mais perto do grid do AMVerge, sem trocar o widget (continua QListWidget em
    IconMode, então seleção múltipla/laço/menu de contexto seguem funcionando).
    """

    def sizeHint(self, option, index) -> QSize:  # noqa: D102
        # Tamanho dinâmico: segue o gridSize atual da lista (ajustável pelo
        # slider de escala). Cai no _GRID base se algo der errado.
        view = self.parent()
        gs = view.gridSize() if hasattr(view, "gridSize") else _GRID
        return gs if gs.isValid() and gs.width() > 0 else _GRID

    def paint(self, painter: QPainter, option, index) -> None:  # noqa: D102
        painter.save()
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)

        row = index.data(Qt.ItemDataRole.UserRole) or {}
        selected = bool(option.state & QStyle.StateFlag.State_Selected)
        hover = bool(option.state & QStyle.StateFlag.State_MouseOver)

        card = QRectF(option.rect).adjusted(4, 4, -4, -4)

        # Fundo do card + borda (estado de seleção/hover).
        if selected:
            bg, border = QColor("#33513a"), QColor("#4CAF50")
        elif hover:
            bg, border = QColor("#2b2e33"), QColor("#3f434a")
        else:
            bg, border = QColor("#232529"), QColor("#2e3036")
        painter.setPen(QPen(border, 1))
        painter.setBrush(bg)
        painter.drawRoundedRect(card, 8, 8)

        # Thumbnail.
        thumb_rect = QRectF(
            card.left() + _PAD,
            card.top() + _PAD,
            card.width() - 2 * _PAD,
            card.height() - _CAPTION_H - 2 * _PAD,
        )
        icon = index.data(Qt.ItemDataRole.DecorationRole)
        pix = icon.pixmap(_THUMB) if isinstance(icon, QIcon) else None
        if pix is not None and not pix.isNull():
            scaled = pix.scaled(
                thumb_rect.size().toSize(),
                Qt.AspectRatioMode.KeepAspectRatioByExpanding,
                Qt.TransformationMode.SmoothTransformation,
            )
            painter.save()
            clip = QRectF(thumb_rect)
            painter.setClipRect(clip)
            x = clip.left() + (clip.width() - scaled.width()) / 2
            y = clip.top() + (clip.height() - scaled.height()) / 2
            painter.drawPixmap(int(x), int(y), scaled)
            painter.restore()
        else:
            painter.setPen(QColor("#555"))
            painter.drawText(thumb_rect, Qt.AlignmentFlag.AlignCenter, "sem\nthumb")

        # Legenda: número da cena (esquerda) + selo de confiança (direita).
        idx = row.get("idx")
        conf = row.get("confidence")
        cap_rect = QRect(
            int(card.left() + _PAD),
            int(card.bottom() - _CAPTION_H),
            int(card.width() - 2 * _PAD),
            _CAPTION_H,
        )
        f = QFont(painter.font())
        f.setPointSizeF(9.0)
        painter.setFont(f)
        painter.setPen(QColor("#dcdcdc") if not selected else QColor("#ffffff"))
        label = f"#{idx:04d}" if idx is not None else ""
        painter.drawText(
            cap_rect, Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft, label
        )

        if conf is not None:
            badge_txt = f"{conf:.2f}"
            fm = painter.fontMetrics()
            bw = fm.horizontalAdvance(badge_txt) + 14
            bh = 17
            badge = QRectF(
                cap_rect.right() - bw,
                cap_rect.center().y() - bh / 2,
                bw,
                bh,
            )
            col = _conf_color(conf)
            painter.setBrush(QColor(col.red(), col.green(), col.blue(), 60))
            painter.setPen(QPen(col, 1))
            painter.drawRoundedRect(badge, 8, 8)
            painter.setPen(col.lighter(120))
            painter.drawText(badge, Qt.AlignmentFlag.AlignCenter, badge_txt)

        # Marca de "aprovado".
        if row.get("approved") == 1:
            painter.setPen(QColor("#4CAF50"))
            painter.drawText(
                QRectF(thumb_rect.right() - 22, thumb_rect.top() + 2, 20, 18),
                Qt.AlignmentFlag.AlignCenter,
                "✓",
            )

        painter.restore()


class ShotGrid(QWidget):
    """Thumbnail grid of shots for one character.

    Emits actions that let the user clean up the current folder without
    re-running the pipeline: remove a wrongly-assigned shot, move it to
    another character, or approve it as correct (stored in the DB).
    """

    shot_activated = Signal(dict)
    # Clique simples: carrega a cena no preview embutido (sem dar play).
    shot_selected = Signal(dict)
    # Hover com "prévia animada" ligada: toca a cena (muda, em loop) no preview.
    shot_hovered = Signal(dict)
    # action_name in {"remove", "move", "approve"}, plus the SELECTED shot
    # rows (1..N — Ctrl/Shift/laço selecionam vários de uma vez).
    shot_action = Signal(str, list)

    def __init__(self, episode_root: Path, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        _ensure_cache_size()
        self.episode_root = episode_root
        self.character_name: str | None = None

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(6)

        # Cabeçalho: info à esquerda, toggle de áudio no hover à direita.
        head = QHBoxLayout()
        self.info_label = QLabel("")
        self.info_label.setStyleSheet("color:#bbb;")
        head.addWidget(self.info_label, 1)

        self.hover_preview_chk = QCheckBox("🎞 Prévia no hover")
        self.hover_preview_chk.setToolTip(
            "Passa o mouse sobre uma cena e ela toca (muda, em loop) no painel\n"
            "de preview — dá pra varrer os clipes sem clicar (efeito de GIF)."
        )
        self.hover_preview_chk.setEnabled(MULTIMEDIA_OK)
        head.addWidget(self.hover_preview_chk, 0)

        self.hover_audio_chk = QCheckBox("🔊 Áudio no hover")
        self.hover_audio_chk.setToolTip(
            "Toca o áudio da cena ao passar o mouse por cima (curto).\n"
            "Desligado por padrão pra não conflitar com o preview embutido."
        )
        self.hover_audio_chk.setEnabled(MULTIMEDIA_OK)
        self.hover_audio_chk.toggled.connect(self._on_hover_audio_toggled)
        head.addWidget(self.hover_audio_chk, 0)

        # Escala da grade: slider muda o tamanho dos cards (mais/menos colunas).
        head.addSpacing(8)
        zoom_lbl = QLabel("⊞")
        zoom_lbl.setToolTip("Tamanho dos clips")
        head.addWidget(zoom_lbl, 0)
        self.scale_slider = QSlider(Qt.Orientation.Horizontal)
        self.scale_slider.setRange(130, 300)
        self.scale_slider.setValue(192)
        self.scale_slider.setFixedWidth(110)
        self.scale_slider.setToolTip(
            "Tamanho dos clips — arraste pra ESQUERDA pra mais colunas "
            "(clips menores) ou pra DIREITA pra menos colunas (maiores)."
        )
        head.addWidget(self.scale_slider, 0)
        layout.addLayout(head)

        self.list = QListWidget()
        self.list.setViewMode(QListWidget.ViewMode.IconMode)
        self.list.setIconSize(QSize(192, 108))
        self.list.setGridSize(_GRID)
        self.list.setResizeMode(QListWidget.ResizeMode.Adjust)
        self.list.setMovement(QListWidget.Movement.Static)
        self.list.setUniformItemSizes(True)
        # Cards custom (item 3): thumbnail arredondado + selo de confiança.
        self.list.setItemDelegate(ShotCardDelegate(self.list))
        # Extended = Ctrl+clique adiciona, Shift+clique estende, arrastar no
        # vazio desenha laço — as ações do botão direito valem pra todos.
        self.list.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        self.list.setSpacing(6)
        self.list.itemClicked.connect(self._on_clicked)
        self.list.itemDoubleClicked.connect(self._on_activate)
        self.list.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.list.customContextMenuRequested.connect(self._show_context_menu)
        layout.addWidget(self.list, 1)

        # Liga o slider de escala agora que a lista existe e aplica o inicial.
        self.scale_slider.valueChanged.connect(self.set_card_width)
        self.set_card_width(self.scale_slider.value())

        # --- Áudio no hover (item 4) ---
        self._hover_player = None
        self._hover_audio = None
        self._pending_hover: Path | None = None
        self._pending_row: dict | None = None
        if MULTIMEDIA_OK:
            self._hover_player = QMediaPlayer(self)
            self._hover_audio = QAudioOutput(self)
            self._hover_audio.setVolume(0.7)
            self._hover_player.setAudioOutput(self._hover_audio)
            self._hover_timer = QTimer(self)
            self._hover_timer.setSingleShot(True)
            self._hover_timer.setInterval(220)  # evita disparar em passadas rápidas
            self._hover_timer.timeout.connect(self._play_pending_hover)
            self.list.setMouseTracking(True)
            self.list.viewport().setMouseTracking(True)
            self.list.itemEntered.connect(self._on_item_entered)
            self.list.viewport().installEventFilter(self)

    def set_card_width(self, w: int) -> None:
        """Escala da grade: define a largura do card (thumb 16:9 + legenda).
        Menor = mais colunas. O delegate lê o gridSize novo e repinta."""
        thumb_h = round(w * 9 / 16)
        card_w = w + 2 * _PAD
        card_h = thumb_h + _CAPTION_H + 2 * _PAD
        self.list.setIconSize(QSize(w, thumb_h))
        self.list.setGridSize(QSize(card_w + 8, card_h + 8))
        self.list.doItemsLayout()  # força relayout com o tamanho novo

    def load_for_character(self, shots: list[dict], character_name: str) -> None:
        self.list.clear()
        self.character_name = character_name
        self.info_label.setText(
            f"{character_name}: {len(shots)} shots · "
            f"confiança média {self._mean([s['confidence'] for s in shots]):.2f}"
        )
        for row in shots:
            icon = self._icon_for(row.get("keyframe"))
            text = f"#{row['idx']:04d}  ({row['confidence']:.2f})"
            it = QListWidgetItem(icon, text)
            it.setData(Qt.ItemDataRole.UserRole, row)
            it.setToolTip(
                f"Shot {row['idx']:04d}\n"
                f"{row['start']:.2f}s → {row['end']:.2f}s  ({row['duration']:.2f}s)\n"
                f"confiança: {row['confidence']:.3f}"
            )
            self.list.addItem(it)

    def _icon_for(self, rel: str | None) -> QIcon:
        if not rel:
            return QIcon()
        p = self.episode_root / rel
        if not p.exists():
            return QIcon()
        pix = _thumbnail(p)
        return QIcon(pix) if pix is not None else QIcon()

    @staticmethod
    def _mean(xs: list[float]) -> float:
        return sum(xs) / len(xs) if xs else 0.0

    def _on_clicked(self, item: QListWidgetItem) -> None:
        data = item.data(Qt.ItemDataRole.UserRole)
        if data:
            self.shot_selected.emit(data)

    def _on_activate(self, item: QListWidgetItem) -> None:
        data = item.data(Qt.ItemDataRole.UserRole)
        if data:
            self.shot_activated.emit(data)

    # ------------------------------------------------------ áudio no hover
    def _on_hover_audio_toggled(self, on: bool) -> None:
        if not on:
            self._stop_hover()

    def _on_item_entered(self, item: QListWidgetItem) -> None:
        want_audio = self.hover_audio_chk.isChecked() and self._hover_player is not None
        want_preview = self.hover_preview_chk.isChecked()
        if not (want_audio or want_preview):
            return
        row = item.data(Qt.ItemDataRole.UserRole) or {}
        rel = row.get("file")
        if not rel:
            return
        path = self.episode_root / rel
        self._pending_row = row
        self._pending_hover = path if path.exists() else None
        self._hover_timer.start()

    def _play_pending_hover(self) -> None:
        from PySide6.QtCore import QUrl

        # Áudio no hover (trecho curto do clipe).
        if (
            self.hover_audio_chk.isChecked()
            and self._hover_player is not None
            and self._pending_hover is not None
        ):
            self._hover_player.setSource(QUrl.fromLocalFile(str(self._pending_hover)))
            self._hover_player.play()

        # Prévia animada no hover: o painel de preview toca a cena (muda, loop).
        if self.hover_preview_chk.isChecked() and self._pending_row:
            self.shot_hovered.emit(self._pending_row)

    def _stop_hover(self) -> None:
        if self._hover_player is not None:
            self._hover_timer.stop()
            self._hover_player.stop()
            self._pending_hover = None

    def eventFilter(self, obj, event) -> bool:
        # Mouse saiu da grade → corta o áudio do hover.
        if self._hover_player is not None and event.type() == QEvent.Type.Leave:
            self._stop_hover()
        return super().eventFilter(obj, event)

    def _show_context_menu(self, pos) -> None:
        item = self.list.itemAt(pos)
        if item is None:
            return
        # Right-click on an unselected thumb targets just it (and selects it,
        # like the Explorer); on a selected one, the action hits the whole
        # selection.
        if not item.isSelected():
            self.list.clearSelection()
            item.setSelected(True)
        rows = [
            it.data(Qt.ItemDataRole.UserRole)
            for it in self.list.selectedItems()
            if it.data(Qt.ItemDataRole.UserRole)
        ]
        if not rows:
            return

        n = len(rows)
        suffix = f" ({n} shots)" if n > 1 else ""
        pending = [r for r in rows if r.get("approved") != 1]

        menu = QMenu(self)
        if not pending:
            approve_label = "✓ Aprovado" if n == 1 else f"✓ Aprovados ({n})"
        else:
            approve_label = f"Aprovar (marcar correto){suffix}"
        act_approve = QAction(approve_label, self)
        act_approve.setEnabled(bool(pending))
        act_approve.triggered.connect(lambda: self.shot_action.emit("approve", pending))

        act_remove = QAction(f"Remover dessa pasta{suffix}", self)
        act_remove.triggered.connect(lambda: self.shot_action.emit("remove", rows))

        act_move = QAction(f"Mover pra outro personagem...{suffix}", self)
        act_move.triggered.connect(lambda: self.shot_action.emit("move", rows))

        menu.addAction(act_approve)
        menu.addSeparator()
        menu.addAction(act_remove)
        menu.addAction(act_move)
        menu.exec(self.list.mapToGlobal(pos))
