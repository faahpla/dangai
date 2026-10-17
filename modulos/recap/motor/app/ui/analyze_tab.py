from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QElapsedTimer, Qt, QThread, QTimer, QUrl, Signal
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (
    QApplication,
    QButtonGroup,
    QCheckBox,
    QDoubleSpinBox,
    QFileDialog,
    QFormLayout,
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QRadioButton,
    QSizePolicy,
    QSpinBox,
    QSystemTrayIcon,
    QVBoxLayout,
    QWidget,
)


def _fmt_clock(seconds: float) -> str:
    s = max(0, int(round(seconds)))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


PRESETS = {
    "strict": {
        "label": "Muito Fiel",
        "desc": "Máxima precisão, menos resultados",
        "tooltip": "Menos falsos positivos. Pode perder cenas rápidas ou ambíguas.",
        "threshold": 0.86, "margin": 0.05, "min_shots": 8,
        "padding": 0.25, "credit": 0.50,
    },
    "auto": {
        "label": "Auto (recomendado)",
        "desc": "Melhor equilíbrio entre precisão e quantidade",
        "tooltip": "Bom equilíbrio entre captura e precisão. Começa aqui.",
        "threshold": 0.80, "margin": 0.03, "min_shots": 3,
        "padding": 0.25, "credit": 0.55,
    },
    "loose": {
        "label": "Pouco Fiel",
        "desc": "Mais resultados, menos precisão",
        "tooltip": "Captura mais cenas. Aceita mais erros pra não perder nada.",
        "threshold": 0.74, "margin": 0.02, "min_shots": 2,
        "padding": 0.30, "credit": 0.70,
    },
}

from ..config import Config
from ..pipeline_types import AIMode, PipelineResult, STAGES
from ..storage.skip_ranges import SkipRangesStore
from ..video_ingest import EpisodeInfo, format_mmss, parse_filename, parse_mmss
from .discovery_dialog import DiscoveryNamingDialog
from .quiet import set_quiet_icon
from .worker import DiscoveryCommitWorker, PipelineWorker, RefsPreviewWorker


class ModeCard(QFrame):
    """Cartão clicável de modo de reconhecimento (Muito/Auto/Pouco fiel).
    Envolve o QRadioButton real (que continua no QButtonGroup) num cartão com
    título + descrição. Clicar em qualquer lugar do cartão marca o radio; o
    estado selecionado acende a borda verde (via property 'selected' + QSS)."""

    def __init__(self, radio: QRadioButton, title: str, desc: str,
                 parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("modeCard")
        self.radio = radio
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        v = QVBoxLayout(self)
        v.setContentsMargins(12, 8, 12, 8)
        v.setSpacing(2)
        radio.setText(title)
        radio.setObjectName("modeRadio")
        v.addWidget(radio)
        d = QLabel(desc)
        d.setObjectName("modeDesc")
        d.setWordWrap(True)
        v.addWidget(d)

    def mousePressEvent(self, event) -> None:
        self.radio.setChecked(True)
        super().mousePressEvent(event)


class AnalyzeTab(QWidget):
    pipeline_finished = Signal(object)  # PipelineResult

    def __init__(self, config: Config, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.config = config
        self.skip_store = SkipRangesStore(self.config.cache_path)
        self._thread: QThread | None = None
        self._worker: PipelineWorker | None = None
        # Cronômetro + estimativa de término ("tipo Claude"): decorrido pelo
        # relógio, restante extrapolado do progresso real com suavização.
        self._clock = QElapsedTimer()
        self._overall = 0.0
        self._eta_smooth: float | None = None
        self._tick = QTimer(self)
        self._tick.setInterval(1000)
        self._tick.timeout.connect(self._update_clock)
        self._tray: QSystemTrayIcon | None = None
        self._build_ui()

    def _build_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(14, 10, 14, 12)
        layout.setSpacing(9)

        # --- input group (labels ACIMA dos campos, estilo Raycast/mockup) ---
        inputs = QGroupBox("1. Configurações do episódio")
        # Painel de apoio: compacto e travado na altura mínima, pra sobrar
        # espaço pro painel 3 (progresso), que é o que o usuário fica olhando.
        inputs.setProperty("compact", True)
        inputs.setSizePolicy(
            QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Maximum
        )
        iv = QVBoxLayout(inputs)
        iv.setSpacing(3)

        def flabel(text: str) -> QLabel:
            lb = QLabel(text)
            lb.setObjectName("fieldLabel")
            return lb

        iv.addWidget(flabel("Arquivo de vídeo"))
        file_row = QHBoxLayout()
        file_row.setSpacing(8)
        self.video_edit = QLineEdit()
        self.video_edit.setPlaceholderText(
            "Arraste o episódio pra cá (.mp4/.mkv) ou clique em Selecionar…"
        )
        btn_pick = QPushButton("📁  Selecionar…")
        btn_pick.clicked.connect(self._pick_video)
        file_row.addWidget(self.video_edit, 1)
        file_row.addWidget(btn_pick)
        iv.addLayout(file_row)

        iv.addWidget(flabel("Anime"))
        self.anime_edit = QLineEdit()
        if self.config.last_anime:
            self.anime_edit.setPlaceholderText(f"último: {self.config.last_anime}")
        iv.addWidget(self.anime_edit)

        te_row = QHBoxLayout()
        te_row.setSpacing(12)
        tcol = QVBoxLayout()
        tcol.setSpacing(5)
        self.season_spin = QSpinBox()
        self.season_spin.setRange(1, 50)
        self.season_spin.setValue(self.config.last_season)
        self.season_spin.setMinimumWidth(120)
        tcol.addWidget(flabel("Temporada"))
        tcol.addWidget(self.season_spin)
        ecol = QVBoxLayout()
        ecol.setSpacing(5)
        self.episode_spin = QSpinBox()
        self.episode_spin.setRange(1, 999)
        self.episode_spin.setValue(self.config.last_episode)
        self.episode_spin.setMinimumWidth(120)
        ecol.addWidget(flabel("Episódio"))
        ecol.addWidget(self.episode_spin)
        te_row.addLayout(tcol)
        te_row.addLayout(ecol)
        te_row.addStretch(1)
        iv.addLayout(te_row)

        iv.addWidget(flabel("Saída"))
        out_row = QHBoxLayout()
        out_row.setSpacing(8)
        self.output_edit = QLineEdit(self.config.output_dir)
        btn_out = QPushButton("📂  Escolher pasta…")
        btn_out.clicked.connect(self._pick_output)
        out_row.addWidget(self.output_edit, 1)
        out_row.addWidget(btn_out)
        iv.addLayout(out_row)

        opd_row = QHBoxLayout()
        opd_row.setSpacing(12)
        hcol = QVBoxLayout()
        hcol.setSpacing(5)
        self.skip_head_edit = QLineEdit()
        self.skip_head_edit.setPlaceholderText("🕐  01:30")
        hcol.addWidget(flabel("Ignorar abertura (OP)"))
        hcol.addWidget(self.skip_head_edit)
        tlcol = QVBoxLayout()
        tlcol.setSpacing(5)
        self.skip_tail_edit = QLineEdit()
        self.skip_tail_edit.setPlaceholderText("🕐  01:30")
        tlcol.addWidget(flabel("Ignorar encerramento (ED)"))
        tlcol.addWidget(self.skip_tail_edit)
        opd_row.addLayout(hcol, 1)
        opd_row.addLayout(tlcol, 1)
        iv.addLayout(opd_row)

        self.anime_edit.editingFinished.connect(self._load_skip_for_anime)

        layout.addWidget(inputs)

        # --- matching mode (presets) ---
        mode_box = QGroupBox("2. Modo de reconhecimento")
        mode_box.setProperty("compact", True)
        mode_box.setSizePolicy(
            QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Maximum
        )
        mode_v = QVBoxLayout(mode_box)
        mode_v.setSpacing(4)

        preset_row = QHBoxLayout()
        preset_row.setSpacing(10)
        self.preset_group = QButtonGroup(self)
        self.preset_buttons: dict[str, QRadioButton] = {}
        self._mode_cards: dict[str, ModeCard] = {}
        for key, p in PRESETS.items():
            rb = QRadioButton(p["label"])
            rb.setToolTip(p["tooltip"])
            self.preset_buttons[key] = rb
            self.preset_group.addButton(rb)
            card = ModeCard(rb, p["label"], p["desc"])
            self._mode_cards[key] = card
            preset_row.addWidget(card, 1)
        mode_v.addLayout(preset_row)
        self.preset_group.buttonToggled.connect(lambda *_: self._refresh_mode_cards())

        self.show_adv_btn = QPushButton("Mostrar valores manuais ⌄")
        self.show_adv_btn.setCheckable(True)
        self.show_adv_btn.setFlat(True)
        self.show_adv_btn.setStyleSheet("text-align:left; color:#aaa; padding:2px;")
        mode_v.addWidget(self.show_adv_btn)

        layout.addWidget(mode_box)

        # --- advanced filters (hidden by default) ---
        adv = QGroupBox("Valores manuais")
        adv.setVisible(False)
        adv_form = QFormLayout(adv)
        self._adv_box = adv
        self.show_adv_btn.toggled.connect(self._toggle_advanced)

        self.threshold_spin = QDoubleSpinBox()
        self.threshold_spin.setRange(0.60, 0.98)
        self.threshold_spin.setSingleStep(0.01)
        self.threshold_spin.setDecimals(2)
        self.threshold_spin.setValue(self.config.default_threshold)
        self.threshold_spin.setToolTip("Score mínimo pra casar (cosine). Mais alto = mais exigente.")
        adv_form.addRow("Confiança mínima:", self.threshold_spin)

        self.margin_spin = QDoubleSpinBox()
        self.margin_spin.setRange(0.00, 0.20)
        self.margin_spin.setSingleStep(0.01)
        self.margin_spin.setDecimals(2)
        self.margin_spin.setValue(self.config.argmax_margin)
        self.margin_spin.setToolTip("O personagem vencedor precisa ganhar do 2º por esta margem. Mais alto = menos falso positivo.")
        adv_form.addRow("Margem do top-1:", self.margin_spin)

        self.min_shots_spin = QSpinBox()
        self.min_shots_spin.setRange(1, 50)
        self.min_shots_spin.setValue(self.config.min_shots_per_character)
        self.min_shots_spin.setToolTip("Personagens com menos shots que isso são considerados ruído e removidos.")
        adv_form.addRow("Mín. shots por personagem:", self.min_shots_spin)

        self.pad_spin = QDoubleSpinBox()
        self.pad_spin.setRange(0.00, 0.60)
        self.pad_spin.setSingleStep(0.05)
        self.pad_spin.setDecimals(2)
        self.pad_spin.setValue(self.config.face_crop_padding)
        self.pad_spin.setToolTip("Margem ao redor do rosto detectado. Mais alto inclui cabelo/roupa (bom pra distinguir personagens). Muito alto traz fundo demais.")
        adv_form.addRow("Padding do rosto:", self.pad_spin)

        self.credit_spin = QDoubleSpinBox()
        self.credit_spin.setRange(0.10, 1.00)
        self.credit_spin.setSingleStep(0.05)
        self.credit_spin.setDecimals(2)
        self.credit_spin.setValue(self.config.credit_edge_threshold)
        self.credit_spin.setToolTip("Score mínimo pra flagar um keyframe como 'créditos/texto'. Mais alto = menos shots pulados.")
        adv_form.addRow("Limiar de créditos:", self.credit_spin)

        self.credit_enable_cb = QCheckBox("Detectar shots de créditos/texto automaticamente")
        self.credit_enable_cb.setChecked(self.config.skip_credit_shots)
        self.credit_enable_cb.setToolTip(
            "Desligado por padrão — o detector costuma marcar cenas normais "
            "como créditos em animes com traço rico (Witch Hat, Dr. Stone). "
            "Pra remover OP/ED de verdade, use o campo 'Pular início até' / "
            "'Pular fim após' (tempo manual, 100% confiável)."
        )
        adv_form.addRow("", self.credit_enable_cb)

        self.danbooru_cb = QCheckBox("Usar Danbooru como fonte extra de refs")
        self.danbooru_cb.setChecked(self.config.use_danbooru)
        self.danbooru_cb.setToolTip(
            "Danbooru tem mais imagens, mas muita fan art com múltiplos personagens "
            "que contamina o centroide. Deixe ligado só se souber que o anime tem "
            "tag Danbooru boa e pouca fan art coletiva."
        )
        adv_form.addRow("", self.danbooru_cb)

        layout.addWidget(adv)

        # Hook preset clicks and select initial preset based on current config
        for key, rb in self.preset_buttons.items():
            rb.toggled.connect(lambda checked, k=key: self._apply_preset(k) if checked else None)
        self._select_matching_preset()
        self._refresh_mode_cards()

        # --- action ---
        action_row = QHBoxLayout()
        self.preview_btn = QPushButton("Testar refs (preview)")
        self.preview_btn.setToolTip(
            "Só busca+baixa as imagens de referência e abre a pasta. "
            "Não corta shots nem roda CLIP. Útil pra inspecionar o que o sistema vai usar."
        )
        self.preview_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.preview_btn.clicked.connect(self._start_preview)

        self.run_btn = QPushButton("Analisar episódio")
        self.run_btn.setProperty("accent", True)
        self.run_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.run_btn.clicked.connect(self._start)

        # A análise "premium": o mesmo pipeline do botão verde + IA revisando
        # só os shots duvidosos. Clique direto — os modos "IA em tudo" foram
        # aposentados da UI (o híbrido faz o mesmo com ~10% do custo).
        self.run_ai_btn = QPushButton("Analisar + IA nos duvidosos")
        self.run_ai_btn.setToolTip(
            "Igual ao Analisar episódio, com um extra: os shots em que o "
            "reconhecimento local ficou em dúvida vão pra IA desempatar.\n"
            "Gasta pouquíssima quota (~10-20% do modo IA antigo). "
            "Precisa de API key em ⚙ Configurações."
        )
        self.run_ai_btn.setObjectName("aiButton")
        self.run_ai_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.run_ai_btn.clicked.connect(lambda: self._start(ai_review=True))

        self.discovery_btn = QPushButton("🔍 Modo Descoberta")
        self.discovery_btn.setToolTip(
            "Agrupa os rostos do episódio por semelhança e você dá os nomes "
            "— os prints viram referências.\n"
            "• Anime novo/desconhecido: cria o banco do zero, sem depender "
            "de nenhum site\n"
            "• Anime conhecido: reforça as refs, com os nomes já sugeridos"
        )
        self.discovery_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.discovery_btn.clicked.connect(lambda: self._start(discovery=True))

        # Only visible while an analysis is running. Cooperative cancel: the
        # worker stops at the next shot/stage boundary, so the click can take
        # a few seconds to land (one ffmpeg cut / API call finishes first).
        self.cancel_btn = QPushButton("✕  Cancelar análise")
        self.cancel_btn.setObjectName("dangerButton")
        self.cancel_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.cancel_btn.clicked.connect(self._cancel_analysis)
        self.cancel_btn.setVisible(False)

        action_row.addStretch(1)
        action_row.addWidget(self.preview_btn)
        action_row.addSpacing(6)
        action_row.addWidget(self.discovery_btn)
        action_row.addSpacing(16)
        action_row.addWidget(self.run_btn)
        action_row.addSpacing(8)
        action_row.addWidget(self.run_ai_btn)
        action_row.addSpacing(8)
        action_row.addWidget(self.cancel_btn)
        action_row.addStretch(1)
        layout.addLayout(action_row)

        # --- progress ---
        progress_box = QGroupBox("3. Progresso da análise")
        # O herói da aba: fica com todo o espaço que os painéis 1/2 não usam.
        progress_box.setSizePolicy(
            QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Expanding
        )
        pv = QVBoxLayout(progress_box)

        self.progress = QProgressBar()
        self.progress.setRange(0, 100)
        prow = QHBoxLayout()
        prow.addWidget(self.progress, 1)
        self.clock_label = QLabel("")
        self.clock_label.setStyleSheet(
            "color:#9fdca3;font-family:Consolas,monospace;font-size:12px;"
        )
        self.clock_label.setToolTip(
            "Tempo decorrido · estimativa de término (calculada pelo ritmo "
            "real das etapas — fica mais precisa conforme avança)"
        )
        prow.addWidget(self.clock_label)
        pv.addLayout(prow)

        self.status_label = QLabel("Aguardando...")
        self.status_label.setAlignment(Qt.AlignmentFlag.AlignLeft)
        self.status_label.setStyleSheet("color:#bbb;")
        pv.addWidget(self.status_label)

        self.stage_list = QListWidget()
        for stage_id, label in STAGES:
            item = QListWidgetItem(f"○  {label}")
            item.setData(Qt.ItemDataRole.UserRole, stage_id)
            self.stage_list.addItem(item)
        pv.addWidget(self.stage_list, 1)

        layout.addWidget(progress_box, 1)

    def _refresh_mode_cards(self) -> None:
        """Acende a borda verde no cartão do modo selecionado (property + QSS)."""
        for key, rb in self.preset_buttons.items():
            card = self._mode_cards.get(key)
            if card is None:
                continue
            card.setProperty("selected", rb.isChecked())
            card.style().unpolish(card)
            card.style().polish(card)

    @staticmethod
    def _wrap(inner):
        w = QWidget()
        if hasattr(inner, "setContentsMargins"):
            inner.setContentsMargins(0, 0, 0, 0)
        w.setLayout(inner)
        return w

    def _pick_video(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "Selecionar episódio", "", "Vídeo (*.mp4 *.mkv *.mov *.avi *.webm *.ts)"
        )
        if path:
            self.set_video(path)

    def set_video(self, path: str) -> None:
        """Set the episode file and auto-fill anime/season/episode from the
        filename. Shared by the file picker and window-wide drag-and-drop."""
        self.video_edit.setText(path)
        info = parse_filename(path)
        self.anime_edit.setText(info.anime)
        self.season_spin.setValue(info.season)
        self.episode_spin.setValue(info.episode)
        self._load_skip_for_anime()

    def _load_skip_for_anime(self) -> None:
        name = self.anime_edit.text().strip()
        if not name:
            return
        head, tail = self.skip_store.get(name)
        self.skip_head_edit.setText(format_mmss(head))
        self.skip_tail_edit.setText(format_mmss(tail))

    def _apply_preset(self, key: str) -> None:
        p = PRESETS[key]
        self.threshold_spin.setValue(p["threshold"])
        self.margin_spin.setValue(p["margin"])
        self.min_shots_spin.setValue(p["min_shots"])
        self.pad_spin.setValue(p["padding"])
        self.credit_spin.setValue(p["credit"])

    def _select_matching_preset(self) -> None:
        """Pick the preset that matches the current config values, or Auto."""
        current = (
            round(self.threshold_spin.value(), 2),
            round(self.margin_spin.value(), 2),
            int(self.min_shots_spin.value()),
            round(self.pad_spin.value(), 2),
            round(self.credit_spin.value(), 2),
        )
        for key, p in PRESETS.items():
            ref = (p["threshold"], p["margin"], p["min_shots"], p["padding"], p["credit"])
            if current == ref:
                self.preset_buttons[key].setChecked(True)
                return
        # No exact match — default to Auto without overwriting values
        self.preset_buttons["auto"].blockSignals(True)
        self.preset_buttons["auto"].setChecked(True)
        self.preset_buttons["auto"].blockSignals(False)

    def _toggle_advanced(self, checked: bool) -> None:
        self._adv_box.setVisible(checked)
        self.show_adv_btn.setText("Esconder valores manuais ⌃" if checked else "Mostrar valores manuais ⌄")

    def _pick_output(self) -> None:
        path = QFileDialog.getExistingDirectory(self, "Pasta de saída", self.output_edit.text())
        if path:
            self.output_edit.setText(path)

    def _start(
        self,
        use_ai: bool = False,
        ai_mode: AIMode = AIMode.FULL,
        ai_review: bool = False,
        discovery: bool = False,
    ) -> None:
        video = self.video_edit.text().strip()
        anime = self.anime_edit.text().strip()
        out = self.output_edit.text().strip()
        if not video or not Path(video).is_file():
            self.status_label.setText("⚠ Selecione um arquivo de vídeo válido.")
            return
        if not anime:
            self.status_label.setText("⚠ Informe o nome do anime.")
            return
        if not out:
            self.status_label.setText("⚠ Escolha uma pasta de saída.")
            return
        if (use_ai or ai_review) and not (
            (self.config.navyai_api_key or "").strip()
            or (self.config.gemini_api_key or "").strip()
        ):
            self.status_label.setText(
                "⚠ Modo IA precisa de uma API key (NavyAI ou Gemini). Abre em ⚙ Configurações."
            )
            return

        self.config.output_dir = out
        self.config.last_anime = anime
        self.config.last_season = int(self.season_spin.value())
        self.config.last_episode = int(self.episode_spin.value())
        self.config.default_threshold = float(self.threshold_spin.value())
        self.config.argmax_margin = float(self.margin_spin.value())
        self.config.min_shots_per_character = int(self.min_shots_spin.value())
        self.config.face_crop_padding = float(self.pad_spin.value())
        self.config.credit_edge_threshold = float(self.credit_spin.value())
        self.config.skip_credit_shots = self.credit_enable_cb.isChecked()
        self.config.use_danbooru = self.danbooru_cb.isChecked()
        self.config.save()

        head_s = parse_mmss(self.skip_head_edit.text())
        tail_s = parse_mmss(self.skip_tail_edit.text())
        self.skip_store.set(anime, head_s, tail_s)

        info = EpisodeInfo(
            anime=anime,
            season=int(self.season_spin.value()),
            episode=int(self.episode_spin.value()),
            source=Path(video),
            skip_head_seconds=head_s,
            skip_tail_seconds=tail_s,
        )

        # Reanálise de um episódio que já tem resultado salvo: o usuário
        # escolhe se o resultado novo SUBSTITUI o antigo (padrão — chutes
        # ruins da análise anterior somem) ou SOMA por cima (nada que já foi
        # identificado se perde; erros antigos ficam até serem removidos na
        # mão). A curadoria manual sobrevive nas duas opções.
        merge_previous = False
        if not discovery:
            try:
                from ..storage.db import Database
                _db = Database(self.config.cache_path / "index.db")
                already = _db.has_analysis(
                    str(info.source), info.anime, info.season, info.episode
                )
            except Exception:
                already = False
            if already:
                box = QMessageBox(self)
                set_quiet_icon(box, QMessageBox.Icon.Question)
                box.setWindowTitle("Reanalisar episódio")
                box.setText(
                    "Este episódio já tem uma análise salva.\n"
                    "Como aplicar o resultado novo?"
                )
                box.setInformativeText(
                    "• Substituir: as pastas refletem só a análise nova — "
                    "chutes errados da antiga somem (recomendado após "
                    "reforçar refs).\n"
                    "• Adicionar: mantém tudo que já foi identificado e soma "
                    "o novo — nada se perde, mas erros antigos ficam até "
                    "você remover.\n\n"
                    "Sua curadoria manual (remover/mover/aprovar) é "
                    "respeitada nas duas opções."
                )
                btn_replace = box.addButton(
                    "Substituir (recomendado)", QMessageBox.ButtonRole.AcceptRole
                )
                btn_merge = box.addButton(
                    "Adicionar por cima", QMessageBox.ButtonRole.ActionRole
                )
                btn_cancel = box.addButton("Cancelar", QMessageBox.ButtonRole.RejectRole)
                box.setDefaultButton(btn_replace)
                box.exec()
                clicked = box.clickedButton()
                if clicked is btn_cancel:
                    return
                merge_previous = clicked is btn_merge

        self.run_btn.setEnabled(False)
        self.run_ai_btn.setEnabled(False)
        self.discovery_btn.setEnabled(False)
        self.cancel_btn.setEnabled(True)
        self.cancel_btn.setVisible(True)
        self._reset_stages()
        self._reset_status_style()
        self.progress.setValue(0)
        self._clock.start()
        self._overall = 0.0
        self._eta_smooth = None
        self.clock_label.setText("⏱ 0:00")
        self._tick.start()
        if discovery:
            suffix = " (Modo Descoberta)"
        elif use_ai:
            suffix = " (IA)"
        elif ai_review:
            suffix = " (CLIP + revisão IA)"
        else:
            suffix = ""
        self.status_label.setText("Iniciando..." + suffix)

        self._thread = QThread(self)
        self._worker = PipelineWorker(
            self.config, info, use_ai_recognition=use_ai, ai_mode=ai_mode,
            ai_review_ambiguous=ai_review, discovery=discovery,
            merge_previous=merge_previous,
        )
        self._worker.moveToThread(self._thread)
        self._thread.started.connect(self._worker.run)
        self._worker.stage.connect(self._on_stage)
        self._worker.finished.connect(self._on_finished)
        self._worker.failed.connect(self._on_failed)
        self._worker.cancelled.connect(self._on_cancelled)
        self._worker.refs_missing.connect(self._on_refs_missing)
        self._worker.anime_not_found.connect(self._on_anime_not_found)
        self._worker.discovery_ready.connect(self._on_discovery_ready)
        for sig in (self._worker.finished, self._worker.failed,
                    self._worker.cancelled, self._worker.refs_missing,
                    self._worker.anime_not_found, self._worker.discovery_ready):
            sig.connect(self._thread.quit)
        self._thread.finished.connect(self._cleanup_thread)
        self._thread.start()

    def _on_anime_not_found(self, message: str) -> None:
        """Anime sem match na AniList/MAL e sem banco local — em vez de um
        beco sem saída, oferece o Modo Descoberta na hora."""
        self._stop_clock("")
        self.run_btn.setEnabled(True)
        self.run_ai_btn.setEnabled(True)
        self.discovery_btn.setEnabled(True)
        self.cancel_btn.setVisible(False)
        self.status_label.setText("Anime não encontrado nas bases online.")
        self.status_label.setStyleSheet("color:#DDB077;font-weight:bold;")

        box = QMessageBox(self)
        set_quiet_icon(box, QMessageBox.Icon.Question)
        box.setWindowTitle("Anime não encontrado")
        box.setText(message.splitlines()[0] if message else "Anime não encontrado.")
        box.setInformativeText(
            "Quer rodar o Modo Descoberta? O app identifica os personagens "
            "pelo próprio episódio (agrupando os rostos parecidos) e você dá "
            "os nomes no final. Os rostos nomeados viram referências pros "
            "próximos episódios."
        )
        disc_btn = box.addButton("🔍 Rodar Modo Descoberta", QMessageBox.ButtonRole.AcceptRole)
        box.addButton("Fechar", QMessageBox.ButtonRole.RejectRole)
        box.exec()
        if box.clickedButton() is disc_btn:
            self._start(discovery=True)

    def _on_discovery_ready(self, disc) -> None:
        """Grupos prontos — abre a tela de batismo; confirmado, o commit
        roda em thread própria e desagua no fluxo normal de conclusão."""
        secs = self._stop_clock()
        self._notify(
            "AnCut HUB — Descoberta pronta",
            f"{len(disc.groups)} personagens encontrados em {_fmt_clock(secs)}. "
            "Hora de dar os nomes!",
        )
        self.status_label.setText(
            f"{len(disc.groups)} personagens descobertos — dê os nomes na janela."
        )
        dlg = DiscoveryNamingDialog(disc, self)
        if not dlg.exec():
            self.run_btn.setEnabled(True)
            self.run_ai_btn.setEnabled(True)
            self.discovery_btn.setEnabled(True)
            self.cancel_btn.setVisible(False)
            self.status_label.setText(
                "Descoberta cancelada — nada foi salvo (os shots cortados "
                "ficam em cache)."
            )
            return

        self.status_label.setText("Salvando personagens descobertos...")
        self._start_discovery_commit(disc, dlg.names(), dlg.removed())

    def _start_discovery_commit(
        self, disc, names: dict, removed: dict
    ) -> None:
        """Commit do batismo em thread própria — usado tanto pelo Modo
        Descoberta quanto pela ponte verde→batismo (grupos sem nome)."""
        self.run_btn.setEnabled(False)
        self.run_ai_btn.setEnabled(False)
        self.discovery_btn.setEnabled(False)
        self._thread = QThread(self)
        self._worker = DiscoveryCommitWorker(self.config, disc, names, removed)
        self._worker.moveToThread(self._thread)
        self._thread.started.connect(self._worker.run)
        self._worker.stage.connect(self._on_stage)
        self._worker.finished.connect(self._on_finished)
        self._worker.failed.connect(self._on_failed)
        self._worker.finished.connect(self._thread.quit)
        self._worker.failed.connect(self._thread.quit)
        self._thread.finished.connect(self._cleanup_thread)
        self._thread.start()

    def _cancel_analysis(self) -> None:
        if self._worker is None or not isinstance(self._worker, PipelineWorker):
            return
        self.cancel_btn.setEnabled(False)
        self.status_label.setText(
            "Cancelando — espera a operação atual terminar "
            "(um download de modelo pode levar minutos)..."
        )
        self._worker.request_cancel()

    def _on_cancelled(self) -> None:
        self._stop_clock("")
        self.cancel_btn.setVisible(False)
        self.run_btn.setEnabled(True)
        self.run_ai_btn.setEnabled(True)
        self.discovery_btn.setEnabled(True)
        self.progress.setValue(0)
        self._reset_stages()
        self.status_label.setText(
            "Análise cancelada. Os shots já cortados ficam em cache — "
            "rodar de novo continua de onde parou."
        )

    def _reset_stages(self) -> None:
        for i in range(self.stage_list.count()):
            it = self.stage_list.item(i)
            label = STAGES[i][1]
            it.setText(f"○  {label}")

    def _on_stage(self, stage_id: str, fraction: float, msg: str) -> None:
        stage_labels = dict(STAGES)
        label = stage_labels.get(stage_id, stage_id)
        # global progress: each stage = 1/N
        idx = next((i for i, s in enumerate(STAGES) if s[0] == stage_id), -1)
        if idx >= 0:
            frac = max(0.0, min(1.0, fraction)) if fraction >= 0 else 0.5
            overall = (idx + frac) / len(STAGES)
            self._overall = overall
            self.progress.setValue(int(overall * 100))
            for i in range(self.stage_list.count()):
                it = self.stage_list.item(i)
                if i < idx:
                    it.setText(f"●  {STAGES[i][1]}")
                elif i == idx:
                    marker = "▸" if fraction < 1.0 else "●"
                    it.setText(f"{marker}  {label}  —  {msg}")
                else:
                    it.setText(f"○  {STAGES[i][1]}")
        self.status_label.setText(msg)

    def _on_finished(self, result: PipelineResult) -> None:
        self.progress.setValue(100)
        for i in range(self.stage_list.count()):
            self.stage_list.item(i).setText(f"●  {STAGES[i][1]}")
        secs = self._stop_clock()
        tempo = f" em {_fmt_clock(secs)}" if secs >= 1 else ""
        self.status_label.setText(
            f"Concluído{tempo}: {result.total_shots} shots · "
            f"{result.total_characters} personagens identificados."
        )
        self.clock_label.setText(f"✅ {_fmt_clock(secs)}")
        self._notify(
            "AnCut HUB — Análise concluída",
            f"{result.anime_title} {result.season}x{result.episode:02d}: "
            f"{result.total_shots} cenas, {result.total_characters} "
            f"personagens{tempo}.",
        )
        self.run_btn.setEnabled(True)
        self.run_ai_btn.setEnabled(True)
        self.discovery_btn.setEnabled(True)
        self.cancel_btn.setVisible(False)
        self.pipeline_finished.emit(result)
        # Skeleton-crew run (1-2 characters usable, rest skipped for lack of
        # refs): worth a heads-up + the way to fix it. 3+ = no nagging.
        if result.low_refs_warning:
            box = QMessageBox(self)
            set_quiet_icon(box, QMessageBox.Icon.Warning)
            box.setWindowTitle("Poucos personagens com referências")
            box.setText(result.low_refs_warning)
            box.setInformativeText(
                "Pra identificar os que ficaram de fora: adicione prints do "
                "episódio (um personagem só por imagem) nas subpastas deles "
                "na pasta de refs, 3-8 por personagem, e analise de novo — "
                "os shots ficam em cache."
            )
            open_btn = None
            if result.refs_dir:
                open_btn = box.addButton(
                    "📂 Abrir pasta de refs", QMessageBox.ButtonRole.AcceptRole
                )
            box.addButton("Fechar", QMessageBox.ButtonRole.RejectRole)
            box.exec()
            if open_btn is not None and box.clickedButton() is open_btn:
                p = Path(result.refs_dir)
                p.mkdir(parents=True, exist_ok=True)
                QDesktopServices.openUrl(QUrl.fromLocalFile(str(p)))

        # Ponte verde→batismo: sobraram grupos de rostos que se parecem
        # entre si mas não bateram com referência nenhuma — oferece dar
        # nome agora, sem precisar rodar o Modo Descoberta separado.
        if result.leftover_groups and result.leftover_groups.groups:
            lg = result.leftover_groups
            box = QMessageBox(self)
            set_quiet_icon(box, QMessageBox.Icon.Question)
            box.setWindowTitle("Grupos sem nome")
            box.setText(
                f"{len(lg.groups)} grupo(s) de cenas ficaram sem personagem — "
                "rostos que se parecem entre si, mas não bateram com nenhuma "
                "referência conhecida."
            )
            box.setInformativeText(
                "Quer batizar agora? Dar nome coloca essas cenas nas pastas "
                "e vira referência — os próximos episódios já reconhecem "
                "sozinhos. Grupo de figurante? Deixa o nome vazio."
            )
            bat_btn = box.addButton(
                "🔍 Batizar agora", QMessageBox.ButtonRole.AcceptRole
            )
            box.addButton("Depois", QMessageBox.ButtonRole.RejectRole)
            box.exec()
            if box.clickedButton() is bat_btn:
                dlg = DiscoveryNamingDialog(lg, self)
                if dlg.exec():
                    self.status_label.setText("Salvando personagens batizados...")
                    self._start_discovery_commit(lg, dlg.names(), dlg.removed())

    def _on_refs_missing(self, message: str, refs_dir: str) -> None:
        """Zero characters got usable reference photos. Instead of a dead-end
        error, offer the way out: open the refs folder so the user can drop
        face images per character and re-run."""
        self._stop_clock("")
        first_line = message.splitlines()[0] if message else "refs insuficientes"
        self._notify("AnCut HUB — Análise parou", first_line)
        self.status_label.setText(f"Erro: {first_line}")
        self.status_label.setStyleSheet("color:#ff6b6b;font-weight:bold;")
        self.run_btn.setEnabled(True)
        self.run_ai_btn.setEnabled(True)
        self.discovery_btn.setEnabled(True)
        self.cancel_btn.setVisible(False)

        box = QMessageBox(self)
        set_quiet_icon(box, QMessageBox.Icon.Warning)
        box.setWindowTitle("Sem referências suficientes")
        box.setText(first_line)
        box.setInformativeText(
            "Você pode adicionar fotos manualmente: cada personagem tem uma "
            "subpasta na pasta de refs. Jogue imagens .jpg/.png com o rosto "
            "bem visível — prints do próprio episódio funcionam ótimo — umas "
            "3-8 por personagem, e clique em Analisar de novo (os shots já "
            "cortados ficam em cache).\n\n"
            "As fotos valem pra todos os próximos episódios desse anime."
        )
        box.setDetailedText(message)
        open_btn = box.addButton("📂 Abrir pasta de refs", QMessageBox.ButtonRole.AcceptRole)
        disc_btn = box.addButton("🔍 Modo Descoberta", QMessageBox.ButtonRole.ActionRole)
        box.addButton("Fechar", QMessageBox.ButtonRole.RejectRole)
        box.exec()
        if box.clickedButton() is open_btn:
            p = Path(refs_dir)
            p.mkdir(parents=True, exist_ok=True)
            QDesktopServices.openUrl(QUrl.fromLocalFile(str(p)))
        elif box.clickedButton() is disc_btn:
            self._start(discovery=True)

    def _on_failed(self, message: str) -> None:
        self._stop_clock("")
        first_line = message.splitlines()[0] if message else "falhou"
        self._notify("AnCut HUB — Análise falhou", first_line)
        self.status_label.setText(f"Erro: {first_line}")
        self.status_label.setStyleSheet("color:#ff6b6b;font-weight:bold;")
        self.run_btn.setEnabled(True)
        self.run_ai_btn.setEnabled(True)
        self.discovery_btn.setEnabled(True)
        self.cancel_btn.setVisible(False)

        box = QMessageBox(self)
        set_quiet_icon(box, QMessageBox.Icon.Critical)
        box.setWindowTitle("Falha ao analisar episódio")
        box.setText(first_line)
        box.setInformativeText(
            "A pipeline foi interrompida. O traceback completo está em 'Mostrar detalhes' "
            "e também foi escrito no terminal."
        )
        box.setDetailedText(message or "(sem detalhes)")
        box.setStandardButtons(QMessageBox.StandardButton.Ok)
        box.exec()

    def _reset_status_style(self) -> None:
        self.status_label.setStyleSheet("color:#bbb;")

    # --- cronômetro + notificação ---

    def _update_clock(self) -> None:
        if not self._clock.isValid():
            return
        secs = self._clock.elapsed() / 1000.0
        txt = f"⏱ {_fmt_clock(secs)}"
        # Estimativa só depois de progresso real (antes disso seria chute):
        # extrapola pelo ritmo global e suaviza pra não ficar pulando.
        if self._overall >= 0.06 and secs > 12:
            remaining = secs / self._overall - secs
            if self._eta_smooth is None:
                self._eta_smooth = remaining
            else:
                self._eta_smooth = 0.85 * self._eta_smooth + 0.15 * remaining
            txt += f"  ·  resta ~{_fmt_clock(self._eta_smooth)}"
        self.clock_label.setText(txt)

    def _stop_clock(self, final_text: str | None = None) -> float:
        """Para o tique e devolve o total em segundos."""
        secs = self._clock.elapsed() / 1000.0 if self._clock.isValid() else 0.0
        self._tick.stop()
        self.clock_label.setText(
            final_text if final_text is not None else f"⏱ {_fmt_clock(secs)}"
        )
        return secs

    def _notify(self, title: str, body: str) -> None:
        """Toast do Windows — só quando a janela NÃO está em foco (análise é
        longa, o usuário foi fazer outra coisa; se está olhando, não enche).
        Sem som próprio, regra da casa; o clique traz a janela de volta."""
        win = self.window()
        if win.isActiveWindow():
            return
        QApplication.alert(win)  # pisca na barra de tarefas
        if not QSystemTrayIcon.isSystemTrayAvailable():
            return
        if self._tray is None:
            self._tray = QSystemTrayIcon(win.windowIcon(), self)
            self._tray.setToolTip("AnCut HUB")
            self._tray.activated.connect(lambda *_: self._focus_from_tray())
            self._tray.messageClicked.connect(self._focus_from_tray)
        self._tray.show()
        self._tray.showMessage(
            title, body, QSystemTrayIcon.MessageIcon.Information, 8000
        )
        QTimer.singleShot(15000, self._hide_tray)

    def _focus_from_tray(self) -> None:
        w = self.window()
        w.showNormal()
        w.raise_()
        w.activateWindow()
        self._hide_tray()

    def _hide_tray(self) -> None:
        if self._tray is not None:
            self._tray.hide()

    def _cleanup_thread(self) -> None:
        if self._worker is not None:
            self._worker.deleteLater()
            self._worker = None
        if self._thread is not None:
            self._thread.deleteLater()
            self._thread = None

    # --- Refs preview ---

    def _start_preview(self) -> None:
        anime = self.anime_edit.text().strip()
        if not anime:
            self.status_label.setText("⚠ Informe o nome do anime.")
            return
        self.config.last_anime = anime
        self.config.save()

        self.run_btn.setEnabled(False)
        self.preview_btn.setEnabled(False)
        self._reset_status_style()
        self.status_label.setText("Buscando refs...")

        self._thread = QThread(self)
        self._worker = RefsPreviewWorker(
            self.config, anime, season=int(self.season_spin.value())
        )
        self._worker.moveToThread(self._thread)
        self._thread.started.connect(self._worker.run)
        self._worker.status.connect(lambda m: self.status_label.setText(m))
        self._worker.finished.connect(self._on_preview_finished)
        self._worker.failed.connect(self._on_failed)
        self._worker.finished.connect(self._thread.quit)
        self._worker.failed.connect(self._thread.quit)
        self._thread.finished.connect(self._cleanup_thread)
        self._thread.start()

    def _on_preview_finished(self, info: dict) -> None:
        self.run_btn.setEnabled(True)
        self.preview_btn.setEnabled(True)
        per_char = info.get("per_char", {})
        total = sum(per_char.values())
        top = sorted(per_char.items(), key=lambda kv: kv[1], reverse=True)[:8]
        summary = ", ".join(f"{n}={c}" for n, c in top)
        self.status_label.setText(
            f"{info.get('title')}: {total} imagens em {len(per_char)} personagens ({summary}...)"
        )

        warnings = info.get("warnings") or []
        box = QMessageBox(self)
        set_quiet_icon(
            box,
            QMessageBox.Icon.Warning if warnings else QMessageBox.Icon.Information,
        )
        box.setWindowTitle("Refs baixadas" + (" (com aviso)" if warnings else ""))
        head = f"{info.get('title')}\n{total} imagens em {len(per_char)} personagens."
        if warnings:
            head += (
                "\n\n⚠️ ATENÇÃO: o MyAnimeList estava fora do ar — estas fotos "
                "vieram das reservas (AniList/Kitsu), poucas por personagem.\n"
                + "\n".join(f"• {w}" for w in warnings)
                + "\n\nTente de novo mais tarde pra completar as galerias, ou "
                "use o Modo Descoberta agora."
            )
        box.setText(head)
        box.setInformativeText(
            "Abre a pasta pra inspecionar o que foi baixado.\n\n"
            "Cada personagem tem sua subpasta. Você pode adicionar .jpg/.png "
            "manualmente dentro dessas subpastas ANTES de clicar em 'Analisar "
            "episódio' — qualquer imagem ali vira referência no próximo run."
        )
        open_btn = box.addButton("Abrir pasta", QMessageBox.ButtonRole.AcceptRole)
        box.addButton("Fechar", QMessageBox.ButtonRole.RejectRole)
        box.exec()
        if box.clickedButton() is open_btn:
            import os, subprocess, sys as _sys
            folder = info.get("folder")
            if folder:
                if _sys.platform.startswith("win"):
                    os.startfile(folder)  # type: ignore[attr-defined]
                elif _sys.platform == "darwin":
                    subprocess.Popen(["open", folder])
                else:
                    subprocess.Popen(["xdg-open", folder])
