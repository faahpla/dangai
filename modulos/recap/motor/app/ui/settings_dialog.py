from __future__ import annotations

from PySide6.QtCore import Qt, QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QFileDialog,
    QFormLayout,
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

from .. import __version__
from ..config import Config
from ..deps_check import cuda_available, gpu_name
from ..updater import check_and_offer_update


class SettingsDialog(QDialog):
    """Central settings panel. Today it holds the NavyAI / AI integration
    credentials; more groups can be added here (paths, cache, etc.)
    without burying them in the Analisar tab.
    """

    def __init__(self, config: Config, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.config = config
        self.setWindowTitle("Configurações")
        # Fits comfortably on a 1366×768 laptop with room for the taskbar;
        # anything smaller gets scrolled via the scroll area.
        self.setMinimumSize(540, 420)
        self.resize(580, 640)
        self._build_ui()

    def _build_ui(self) -> None:
        # OUTER layout: scroll area on top (grows), fixed buttons on bottom.
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        # INNER container that holds all the option groups. Wrapped in a
        # QScrollArea so the dialog stays usable on small screens — the Save
        # button never gets pushed offscreen.
        inner = QWidget()
        # Pinta o mesmo flat neutro do app direto no container do scroll — o
        # viewport do QScrollArea, por padrão, usa a cor Base da palette (preto)
        # e ignora o fundo do QDialog, dando o bug "todo preto". Forçar aqui
        # garante o flat de cima a baixo.
        inner.setObjectName("settingsInner")
        inner.setStyleSheet("QWidget#settingsInner { background: #161B22; }")
        root = QVBoxLayout(inner)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(12)

        # --- Output folder ---
        out_group = QGroupBox("Pasta de saída dos clipes")
        out_form = QFormLayout(out_group)

        self.output_edit = QLineEdit(self.config.output_dir)
        self.output_edit.setToolTip(
            "Onde ficam os shots cortados e as pastas by_character/by_pair "
            "de cada episódio analisado."
        )
        browse_btn = QPushButton("Escolher...")
        browse_btn.setFixedWidth(100)
        browse_btn.clicked.connect(self._pick_output_dir)

        row = QHBoxLayout()
        row.setContentsMargins(0, 0, 0, 0)
        row.addWidget(self.output_edit, 1)
        row.addWidget(browse_btn)
        wrap = QWidget()
        wrap.setLayout(row)
        out_form.addRow("Saída:", wrap)

        info_out = QLabel(
            "Aqui dentro vão ser criadas subpastas por anime/episódio. "
            "Ex: <code>&lt;saída&gt;/Dr. Stone/S04E25/shots/</code>."
        )
        info_out.setWordWrap(True)
        info_out.setStyleSheet("color:#aaa;font-size:11px;")
        out_form.addRow("", info_out)

        root.addWidget(out_group)

        # --- Pastas, cache e limpeza ---
        cache_group = QGroupBox("Referências e cache")
        cache_layout = QVBoxLayout(cache_group)

        open_row = QHBoxLayout()
        refs_btn = QPushButton("📂  Abrir pasta de referências")
        refs_btn.setToolTip(
            "Um anime por pasta, um personagem por subpasta em characters/. "
            "Pode apagar/adicionar fotos à vontade — a próxima análise usa "
            "o que estiver lá."
        )
        refs_btn.clicked.connect(self._open_refs)
        open_row.addWidget(refs_btn)
        cache_btn = QPushButton("📂  Abrir pasta de cache")
        cache_btn.clicked.connect(self._open_cache)
        open_row.addWidget(cache_btn)
        open_row.addStretch(1)
        cache_layout.addLayout(open_row)

        clean_row = QHBoxLayout()
        merge_btn = QPushButton("🧩  Fundir duplicados")
        merge_btn.setToolTip(
            "Acha pastas que são o MESMO personagem escrito diferente "
            "(\"Tempest, Rimuru\" ≡ \"Rimuru Tempest\") ou o mesmo anime com "
            "id diferente, mostra o plano e funde tudo com um clique."
        )
        merge_btn.clicked.connect(self._merge_dupes)
        clean_row.addWidget(merge_btn)
        clean_btn = QPushButton("🧹  Limpar fotos baixadas")
        clean_btn.setToolTip(
            "Apaga SÓ as imagens que vieram das galerias online (as que têm "
            "nome de código). Fotos de batismo (auto_disc_*) e as que você "
            "colocou na mão ficam intactas."
        )
        clean_btn.clicked.connect(self._clean_refs)
        clean_row.addWidget(clean_btn)
        reset_btn = QPushButton("♻️  Restaurar padrões de análise")
        reset_btn.setToolTip(
            "Volta os parâmetros de identificação (rigor, margem, mínimos) "
            "pros valores padrão do app."
        )
        reset_btn.clicked.connect(self._reset_analysis_defaults)
        clean_row.addWidget(reset_btn)
        wipe_btn = QPushButton("🗑  Apagar TODO o cache")
        wipe_btn.setStyleSheet("QPushButton{color:#e08585;}")
        wipe_btn.clicked.connect(self._wipe_cache)
        clean_row.addWidget(wipe_btn)
        clean_row.addStretch(1)
        cache_layout.addLayout(clean_row)

        cache_info = QLabel(
            "Foto de personagem errado no meio das referências suja a "
            "identificação. <b>Limpar fotos baixadas</b> zera só o que veio "
            "da internet (a próxima análise baixa de novo); pra cirurgia "
            "fina, abra a pasta e apague o que não presta. O apagão total "
            "remove <b>tudo</b> — inclusive batismos e a memória de "
            "curadoria — use só como último recurso."
        )
        cache_info.setWordWrap(True)
        cache_info.setStyleSheet("color:#aaa;font-size:11px;")
        cache_layout.addWidget(cache_info)

        root.addWidget(cache_group)

        # --- Primary AI: NavyAI ---
        ai_group = QGroupBox("AI principal (NavyAI / OpenAI-compatible)")
        ai_form = QFormLayout(ai_group)

        self.key_edit = QLineEdit(self.config.navyai_api_key)
        self.key_edit.setEchoMode(QLineEdit.EchoMode.Password)
        self.key_edit.setPlaceholderText("sk-navy-...")
        show_key = QPushButton("Mostrar")
        show_key.setCheckable(True)
        show_key.setFixedWidth(80)
        show_key.toggled.connect(
            lambda on: self.key_edit.setEchoMode(
                QLineEdit.EchoMode.Normal if on else QLineEdit.EchoMode.Password
            )
        )
        key_row = QHBoxLayout()
        key_row.setContentsMargins(0, 0, 0, 0)
        key_row.addWidget(self.key_edit, 1)
        key_row.addWidget(show_key)
        key_wrap = QWidget()
        key_wrap.setLayout(key_row)
        ai_form.addRow("API key:", key_wrap)

        self.model_edit = QLineEdit(self.config.navyai_model or "gemini-2.5-flash")
        ai_form.addRow("Modelo:", self.model_edit)

        self.base_edit = QLineEdit(self.config.navyai_base_url or "https://api.navy/v1")
        ai_form.addRow("Endpoint:", self.base_edit)

        info = QLabel(
            "Usado por padrão pelos botões <b>Analisar com IA</b>. "
            "Se falhar (rate-limit, quota, 5xx), cai automaticamente no Gemini abaixo."
        )
        info.setWordWrap(True)
        info.setStyleSheet("color:#aaa;font-size:11px;")
        ai_form.addRow("", info)

        root.addWidget(ai_group)

        # --- Fallback AI: Gemini direto ---
        gem_group = QGroupBox("AI fallback (Gemini direto, plano free)")
        gem_form = QFormLayout(gem_group)

        self.gem_key_edit = QLineEdit(self.config.gemini_api_key)
        self.gem_key_edit.setEchoMode(QLineEdit.EchoMode.Password)
        self.gem_key_edit.setPlaceholderText("AIza...")
        show_gem_key = QPushButton("Mostrar")
        show_gem_key.setCheckable(True)
        show_gem_key.setFixedWidth(80)
        show_gem_key.toggled.connect(
            lambda on: self.gem_key_edit.setEchoMode(
                QLineEdit.EchoMode.Normal if on else QLineEdit.EchoMode.Password
            )
        )
        gem_row = QHBoxLayout()
        gem_row.setContentsMargins(0, 0, 0, 0)
        gem_row.addWidget(self.gem_key_edit, 1)
        gem_row.addWidget(show_gem_key)
        gem_wrap = QWidget()
        gem_wrap.setLayout(gem_row)
        gem_form.addRow("API key:", gem_wrap)

        self.gem_model_edit = QLineEdit(self.config.gemini_model or "gemini-2.5-flash")
        gem_form.addRow("Modelo:", self.gem_model_edit)

        gem_info = QLabel(
            "Pega a key gratuita em <a href='https://aistudio.google.com/apikey' style='color:#7FCC7F'>"
            "aistudio.google.com/apikey</a>. "
            "Se as duas keys estiverem preenchidas, NavyAI é usada primeiro e o Gemini "
            "só entra em ação se ela falhar. Se só uma tiver, ela é usada sozinha. "
            "As keys ficam salvas em <code>~/AppData/Local/CorteCenas/config.json</code>."
        )
        gem_info.setOpenExternalLinks(True)
        gem_info.setWordWrap(True)
        gem_info.setStyleSheet("color:#aaa;font-size:11px;")
        gem_form.addRow("", gem_info)

        root.addWidget(gem_group)

        # --- App / Atualizações ---
        app_group = QGroupBox("Sobre / Atualizações")
        app_layout = QVBoxLayout(app_group)

        version_row = QHBoxLayout()
        version_label = QLabel(
            f"AnCut HUB <b>v{__version__}</b> — "
            "<a href='https://github.com/leviclementino1-creator/corte-cenas/releases' "
            "style='color:#7FCC7F'>ver histórico de versões</a>"
        )
        version_label.setOpenExternalLinks(True)
        version_row.addWidget(version_label)
        version_row.addStretch(1)
        app_layout.addLayout(version_row)

        # GPU / device status
        if cuda_available():
            gpu_html = f"GPU: <span style='color:#7FCC7F'>{gpu_name() or 'CUDA'}</span>"
        else:
            gpu_html = "GPU: <span style='color:#DDB077'>não detectada — rodando em CPU (~20x mais lento)</span>"
        gpu_label = QLabel(gpu_html)
        gpu_label.setStyleSheet("font-size:11px;")
        app_layout.addWidget(gpu_label)

        update_row = QHBoxLayout()
        self.update_btn = QPushButton("🔄  Verificar atualizações agora")
        self.update_btn.clicked.connect(self._check_updates)
        update_row.addWidget(self.update_btn)
        logs_btn = QPushButton("📂  Abrir pasta de logs")
        logs_btn.clicked.connect(self._open_logs)
        update_row.addWidget(logs_btn)
        update_row.addStretch(1)
        app_layout.addLayout(update_row)

        upd_info = QLabel(
            "O app já verifica atualizações ao abrir. Deu algum problema numa análise? "
            "Abra a pasta de logs e mande o arquivo <code>app.log</code> pra quem "
            "te passou o app — ele registra tudo que aconteceu na última execução."
        )
        upd_info.setWordWrap(True)
        upd_info.setStyleSheet("color:#aaa;font-size:11px;")
        app_layout.addWidget(upd_info)

        root.addWidget(app_group)
        root.addStretch(1)  # push groups up; empty space below scrolls last

        # Scroll wrapper around the inner content.
        scroll = QScrollArea()
        scroll.setWidget(inner)
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        # Viewport transparente pra não pintar o preto da palette Base por baixo
        # do container (que já é flat).
        scroll.viewport().setStyleSheet("background: transparent;")
        outer.addWidget(scroll, 1)

        # A subtle separator line so the fixed button bar reads as its own strip.
        sep = QFrame()
        sep.setFrameShape(QFrame.Shape.HLine)
        sep.setStyleSheet("color:#3a3d43;")
        outer.addWidget(sep)

        # Fixed button bar at the bottom of the dialog — never scrolls away.
        btns = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Save
            | QDialogButtonBox.StandardButton.Cancel
        )
        btns.button(QDialogButtonBox.StandardButton.Save).setText("Salvar")
        btns.button(QDialogButtonBox.StandardButton.Cancel).setText("Cancelar")
        btns.accepted.connect(self._save)
        btns.rejected.connect(self.reject)
        btn_row = QHBoxLayout()
        btn_row.setContentsMargins(12, 8, 12, 12)
        btn_row.addWidget(btns)
        outer.addLayout(btn_row)

    def _pick_output_dir(self) -> None:
        path = QFileDialog.getExistingDirectory(
            self, "Pasta de saída", self.output_edit.text()
        )
        if path:
            self.output_edit.setText(path)

    def _open_logs(self) -> None:
        from ..applog import log_dir
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(log_dir())))

    def _open_refs(self) -> None:
        from ..cache_tools import refs_root
        p = refs_root(self.config.cache_path)
        p.mkdir(parents=True, exist_ok=True)
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(p)))

    def _open_cache(self) -> None:
        p = self.config.cache_path
        p.mkdir(parents=True, exist_ok=True)
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(p)))

    def _clean_refs(self) -> None:
        from ..cache_tools import clean_catalog_refs, refs_summary
        catalog, disc, manual = refs_summary(self.config.cache_path)
        if catalog == 0:
            QMessageBox.information(
                self, "Nada a limpar",
                "Nenhuma foto baixada de catálogo no cache — só "
                f"{disc} de batismo e {manual} manuais, que não são tocadas.",
            )
            return
        box = QMessageBox(self)
        box.setIcon(QMessageBox.Icon.Question)
        box.setWindowTitle("Limpar fotos baixadas")
        box.setText(
            f"Apagar <b>{catalog}</b> fotos baixadas das galerias online?"
        )
        box.setInformativeText(
            f"Ficam intactas: {disc} fotos de batismo (auto_disc_*) e "
            f"{manual} adicionadas manualmente.\n\n"
            "A próxima análise baixa as galerias de novo (e você pode "
            "limpar o que vier errado pela pasta de referências)."
        )
        yes = box.addButton("🧹 Limpar", QMessageBox.ButtonRole.AcceptRole)
        box.addButton("Cancelar", QMessageBox.ButtonRole.RejectRole)
        box.exec()
        if box.clickedButton() is not yes:
            return
        removed, animes = clean_catalog_refs(self.config.cache_path)
        QMessageBox.information(
            self, "Limpeza concluída",
            f"{removed} fotos de catálogo apagadas em {animes} anime(s). "
            "Batismos e fotos manuais preservados.",
        )

    def _merge_dupes(self) -> None:
        from ..cache_tools import merge_duplicates
        plan = merge_duplicates(self.config.cache_path, apply=False)
        if not plan["anime"] and not plan["chars"]:
            QMessageBox.information(
                self, "Sem duplicatas",
                "Nenhuma pasta duplicada de personagem ou anime encontrada. 👌",
            )
            return
        lines: list[str] = []
        for srcs, canon in plan["anime"]:
            lines.append(f"🎬 {' + '.join(srcs)}  →  {canon}")
        for anime, srcs, canon in plan["chars"]:
            lines.append(f"👤 [{anime.split(' [')[0]}] {' + '.join(srcs)}  →  {canon}")
        preview = "\n".join(lines[:20])
        if len(lines) > 20:
            preview += f"\n… e mais {len(lines) - 20} fusões."
        box = QMessageBox(self)
        box.setIcon(QMessageBox.Icon.Question)
        box.setWindowTitle("Fundir duplicados")
        box.setText(
            f"Encontrei <b>{len(plan['chars'])}</b> personagem(ns) e "
            f"<b>{len(plan['anime'])}</b> anime(s) duplicados. Fundir assim?"
        )
        box.setInformativeText(
            preview + "\n\nAs fotos são movidas pra pasta de nome mais "
            "completo (nada é apagado, só duplicata exata de download). "
            "Reanalise os episódios depois pra refazer as contagens."
        )
        yes = box.addButton("🧩 Fundir", QMessageBox.ButtonRole.AcceptRole)
        box.addButton("Cancelar", QMessageBox.ButtonRole.RejectRole)
        box.exec()
        if box.clickedButton() is not yes:
            return
        result = merge_duplicates(self.config.cache_path, apply=True)
        QMessageBox.information(
            self, "Fusão concluída",
            f"{len(result['chars'])} personagem(ns) e {len(result['anime'])} "
            f"anime(s) fundidos, {result['moved']} arquivos reorganizados.\n\n"
            "A partir de agora o app reusa a pasta existente mesmo quando a "
            "fonte escreve o nome diferente — isso não volta a acontecer.",
        )

    def _reset_analysis_defaults(self) -> None:
        defaults = Config()
        fields = (
            "default_threshold", "argmax_margin", "min_shots_per_character",
            "face_crop_padding", "credit_edge_threshold",
        )
        current = {f: getattr(self.config, f) for f in fields}
        changed = {
            f: (current[f], getattr(defaults, f))
            for f in fields if current[f] != getattr(defaults, f)
        }
        if not changed:
            QMessageBox.information(
                self, "Já está no padrão",
                "Os parâmetros de análise já estão nos valores padrão.",
            )
            return
        detail = "\n".join(
            f"• {f}: {old} → {new}" for f, (old, new) in changed.items()
        )
        box = QMessageBox(self)
        box.setIcon(QMessageBox.Icon.Question)
        box.setWindowTitle("Restaurar padrões de análise")
        box.setText("Voltar estes parâmetros pro padrão do app?")
        box.setInformativeText(detail)
        yes = box.addButton("♻️ Restaurar", QMessageBox.ButtonRole.AcceptRole)
        box.addButton("Cancelar", QMessageBox.ButtonRole.RejectRole)
        box.exec()
        if box.clickedButton() is not yes:
            return
        for f in fields:
            setattr(self.config, f, getattr(defaults, f))
        self.config.save()
        QMessageBox.information(
            self, "Padrões restaurados",
            "Parâmetros de análise de volta ao padrão — valem já na "
            "próxima análise.",
        )

    def _wipe_cache(self) -> None:
        from ..cache_tools import wipe_cache
        box = QMessageBox(self)
        box.setIcon(QMessageBox.Icon.Warning)
        box.setWindowTitle("Apagar TODO o cache")
        box.setText("Apagar o cache INTEIRO? Isso remove:")
        box.setInformativeText(
            "• TODAS as referências — inclusive fotos de batismo e as "
            "adicionadas manualmente\n"
            "• A memória de curadoria (remover/mover/aprovar lembrados)\n"
            "• Resultados de análises no banco e elencos cacheados\n\n"
            "Os clipes na pasta de saída e os modelos baixados ficam. "
            "Não use durante uma análise em andamento.\n\n"
            "Isso não tem volta."
        )
        yes = box.addButton(
            "🗑 Apagar tudo", QMessageBox.ButtonRole.DestructiveRole
        )
        box.addButton("Cancelar", QMessageBox.ButtonRole.RejectRole)
        box.exec()
        if box.clickedButton() is not yes:
            return
        wipe_cache(self.config.cache_path)
        self.config.ensure_dirs()
        QMessageBox.information(
            self, "Cache apagado",
            "Cache zerado. A próxima análise baixa elencos e fotos do zero "
            "(os modelos e seus clipes não foram tocados).",
        )

    def _check_updates(self) -> None:
        self.update_btn.setEnabled(False)
        self.update_btn.setText("Verificando...")
        try:
            check_and_offer_update(parent=self, verbose=True)
        finally:
            self.update_btn.setEnabled(True)
            self.update_btn.setText("🔄  Verificar atualizações agora")

    def _save(self) -> None:
        out_path = self.output_edit.text().strip()
        if out_path:
            self.config.output_dir = out_path
        self.config.navyai_api_key = self.key_edit.text().strip()
        self.config.navyai_model = self.model_edit.text().strip() or "gemini-2.5-flash"
        self.config.navyai_base_url = self.base_edit.text().strip() or "https://api.navy/v1"
        self.config.gemini_api_key = self.gem_key_edit.text().strip()
        self.config.gemini_model = self.gem_model_edit.text().strip() or "gemini-2.5-flash"
        self.config.save()
        self.accept()
