"""QThread workers around the pipeline / harvest / reframe entry points.

Imports here MUST stay light. Heavy modules (`torch`, `open_clip`, `cv2`,
`ultralytics`) are pulled in inside each `run()` — that's the moment the
user actually clicked Analisar / Harvest / Reframe and is prepared to
wait. Importing them at module scope would tack ~10 seconds onto every
cold app start just so the UI can render.
"""
from __future__ import annotations

import logging
import sys
import traceback
from pathlib import Path

_log = logging.getLogger("cortecenas")

from PySide6.QtCore import QObject, QThread, Signal

from ..config import Config
from ..pipeline_types import (
    AIMode,
    AnimeNotFoundError,
    InsufficientRefsError,
    PipelineCancelled,
    PipelineResult,
)
from ..video_ingest import EpisodeInfo


class PipelineWorker(QObject):
    stage = Signal(str, float, str)          # (stage_id, fraction, message)
    finished = Signal(object)                 # PipelineResult
    failed = Signal(str)
    cancelled = Signal()
    refs_missing = Signal(str, str)          # (message, refs_folder)
    anime_not_found = Signal(str)            # UI oferece o Modo Descoberta
    discovery_ready = Signal(object)         # DiscoveryResult → tela de batismo

    def __init__(
        self,
        config: Config,
        info: EpisodeInfo,
        use_ai_recognition: bool = False,
        ai_mode: AIMode = AIMode.FULL,
        ai_review_ambiguous: bool = False,
        discovery: bool = False,
        merge_previous: bool = False,
    ) -> None:
        super().__init__()
        self.config = config
        self.info = info
        self.use_ai_recognition = use_ai_recognition
        self.ai_mode = ai_mode
        self.ai_review_ambiguous = ai_review_ambiguous
        self.discovery = discovery
        self.merge_previous = merge_previous
        self._cancel_requested = False

    def request_cancel(self) -> None:
        """Called from the UI thread. The worker notices on its next progress
        emission (i.e. at the next shot/stage boundary) — a blocking step in
        flight (one ffmpeg cut, one API call) finishes first."""
        self._cancel_requested = True

    def run(self) -> None:
        try:
            _log.info(
                "=== Análise iniciada: %s (S%02dE%02d, ai=%s, modo=%s, revisão=%s) ===",
                self.info.anime, self.info.season, self.info.episode,
                self.use_ai_recognition, self.ai_mode.value, self.ai_review_ambiguous,
            )
            # First analysis of the session pays the ~5s "torch import" tax.
            # We emit before the import so the UI shows something instead of
            # appearing frozen.
            self._emit("parse", -1.0, "Preparando ambiente de análise (só na primeira vez)...")
            from ..pipeline import Pipeline  # heavy — deferred to click-time
            pipeline = Pipeline(self.config)
            if self.discovery:
                disc = pipeline.run_discovery(self.info, on_progress=self._emit)
                _log.info(
                    "=== Descoberta pronta: %d rostos, %d grupos ===",
                    disc.total_faces, len(disc.groups),
                )
                self.discovery_ready.emit(disc)
                return
            result = pipeline.run(
                self.info,
                on_progress=self._emit,
                use_ai_recognition=self.use_ai_recognition,
                ai_mode=self.ai_mode,
                ai_review_ambiguous=self.ai_review_ambiguous,
                merge_previous=self.merge_previous,
            )
            _log.info(
                "=== Análise concluída: %d shots, %d personagens (%s) ===",
                result.total_shots, result.total_characters,
                ", ".join(result.identified_characters) or "nenhum",
            )
            self.finished.emit(result)
        except AnimeNotFoundError as e:
            _log.info("=== Anime não encontrado: oferecendo Modo Descoberta ===")
            self.anime_not_found.emit(str(e))
        except InsufficientRefsError as e:
            _log.info("=== Análise abortada: refs insuficientes (pasta: %s) ===", e.refs_dir)
            self.refs_missing.emit(str(e), e.refs_dir)
        except PipelineCancelled:
            _log.info("=== Análise CANCELADA pelo usuário ===")
            self.cancelled.emit()
        except Exception as e:
            tb = traceback.format_exc()
            print("\n=== Pipeline falhou ===", file=sys.stderr)
            print(tb, file=sys.stderr, flush=True)
            self.failed.emit(f"{e}\n\n{tb}")

    def _emit(self, stage: str, frac: float, msg: str) -> None:
        if self._cancel_requested:
            raise PipelineCancelled()
        # Mirror every progress message into app.log — this is the timeline
        # that lets us reconstruct a remote user's run. Per-shot ticks
        # ("Shot 12/332") are skipped to keep the log readable; stage
        # boundaries and status text are what matter.
        if msg and not msg.startswith("Shot "):
            _log.info("[%s] %s", stage, msg)
        self.stage.emit(stage, float(frac), str(msg))


class DiscoveryCommitWorker(QObject):
    """Fecha o Modo Descoberta depois do batismo: cria personagens, refs e
    pastas. Roda em thread porque grava dezenas de arquivos + hardlinks."""

    stage = Signal(str, float, str)
    finished = Signal(object)   # PipelineResult
    failed = Signal(str)

    def __init__(
        self,
        config: Config,
        result,
        names: dict[int, str],
        removed: dict[int, list[int]] | None = None,
    ) -> None:
        super().__init__()
        self.config = config
        self.result = result
        self.names = names
        self.removed = removed or {}

    def run(self) -> None:
        try:
            from ..pipeline import Pipeline
            pipeline = Pipeline(self.config)
            out = pipeline.commit_discovery(
                self.result, self.names,
                on_progress=lambda s, f, m: self.stage.emit(s, float(f), str(m)),
                removed=self.removed,
            )
            _log.info(
                "=== Descoberta salva: %d shots, %d personagens (%s) ===",
                out.total_shots, out.total_characters,
                ", ".join(out.identified_characters) or "nenhum",
            )
            self.finished.emit(out)
        except Exception as e:
            tb = traceback.format_exc()
            print("\n=== Commit da descoberta falhou ===", file=sys.stderr)
            print(tb, file=sys.stderr, flush=True)
            self.failed.emit(f"{e}\n\n{tb}")


class RefsPreviewWorker(QObject):
    """Runs ONLY the ref-fetching portion of the pipeline:
    AniList resolve → Jikan + Danbooru fetch URLs → download images.
    No CLIP, no shot detection, no classification.
    """

    status = Signal(str)
    finished = Signal(dict)   # {"folder": str, "per_char": {name: count}, "title": str}
    failed = Signal(str)

    def __init__(self, config: Config, anime_name: str, season: int = 1) -> None:
        super().__init__()
        self.config = config
        self.anime_name = anime_name
        self.season = season

    def _status(self, msg: str) -> None:
        if msg:
            _log.info("[refs] %s", msg)
        self.status.emit(msg)

    def run(self) -> None:
        try:
            from ..providers.anime_provider import AnimeProvider
            from ..references.reference_store import ReferenceStore

            self.config.ensure_dirs()
            provider = AnimeProvider(self.config.cache_path)
            try:
                bundle = provider.resolve(
                    self.anime_name,
                    max_characters=self.config.max_characters_per_anime,
                    images_per_character=self.config.references_per_character,
                    on_status=self._status,
                    use_danbooru=self.config.use_danbooru,
                    season=self.season,
                )
            finally:
                provider.close()

            self._status("Baixando imagens...")
            store = ReferenceStore(self.config.cache_path)
            if bundle.franchise_root_id:
                cache_id = f"al{bundle.franchise_root_id}"
            elif bundle.anilist_id:
                cache_id = f"al{bundle.anilist_id}"
            else:
                cache_id = f"mal{bundle.mal_id}"
            refs = store.ensure_references(
                cache_id, bundle, on_status=self._status
            )
            per_char = {name: len(paths) for name, paths in refs.items()}
            folder = str(store.anime_dir(cache_id) / "characters")
            self.finished.emit(
                {
                    "folder": folder,
                    "per_char": per_char,
                    "title": bundle.title,
                    # Fonte fora do ar durante a busca? O diálogo mostra na
                    # cara — sem isso o usuário vê a lista bonita da reserva
                    # e acha que o MyAnimeList funcionou.
                    "warnings": list(provider.source_warnings),
                }
            )
        except Exception as e:
            tb = traceback.format_exc()
            print("\n=== Refs preview falhou ===", file=sys.stderr)
            print(tb, file=sys.stderr, flush=True)
            self.failed.emit(f"{e}\n\n{tb}")


class HarvestWorker(QObject):
    """Extracts high-confidence face crops from the current episode as
    additional references for each character, saving into their ref folder.
    """

    progress = Signal(str, int, int)
    finished = Signal(dict)
    failed = Signal(str)

    def __init__(
        self,
        config: Config,
        episode_id: int,
        episode_root: Path,
        anime_cache_id: str,
        conf_threshold: float = 0.90,
        max_new_refs_per_char: int = 3,
    ) -> None:
        super().__init__()
        self.config = config
        self.episode_id = episode_id
        self.episode_root = Path(episode_root)
        self.anime_cache_id = anime_cache_id
        self.conf_threshold = conf_threshold
        self.max_new_refs = max_new_refs_per_char

    def run(self) -> None:
        try:
            from ..harvest import harvest_all_characters
            from ..matching.embedding_engine import EmbeddingEngine
            from ..matching.face_detector import AnimeFaceDetector
            from ..references.reference_store import ReferenceStore
            from ..storage.db import Database

            print(f"[harvest] Iniciando para episode_id={self.episode_id}", flush=True)
            face_det = AnimeFaceDetector()
            engine = EmbeddingEngine(
                model_name=self.config.clip_model,
                pretrained=self.config.clip_pretrained,
                use_cuda=self.config.use_cuda,
            )
            db = Database(self.config.cache_path / "index.db")
            store = ReferenceStore(self.config.cache_path)

            results = harvest_all_characters(
                self.episode_root,
                self.episode_id,
                self.anime_cache_id,
                db,
                store,
                face_det,
                engine,
                conf_threshold=self.conf_threshold,
                max_new_refs_per_char=self.max_new_refs,
                on_progress=lambda name, d, t: self.progress.emit(name, d, t),
            )
            self.finished.emit(results)
        except Exception as e:
            tb = traceback.format_exc()
            print("\n=== Harvest falhou ===", file=sys.stderr)
            print(tb, file=sys.stderr, flush=True)
            self.failed.emit(f"{e}\n\n{tb}")


class ReframeWorker(QObject):
    """Reframes all shots of a character to vertical 9:16 centered on the
    detected face (with motion-energy fallback when no face is found).
    """

    progress = Signal(int, int)
    finished = Signal(dict)
    failed = Signal(str)

    def __init__(
        self,
        config: Config,
        episode_root: Path,
        character_id: int,
        character_name: str,
        shot_rows: list[dict],
        target_w: int = 1080,
        target_h: int = 1920,
    ) -> None:
        super().__init__()
        self.config = config
        self.episode_root = Path(episode_root)
        self.character_id = character_id
        self.character_name = character_name
        self.shot_rows = shot_rows
        self._target_w = target_w
        self._target_h = target_h

    def run(self) -> None:
        try:
            from ..matching.face_detector import AnimeFaceDetector, ensure_cascade
            from ..reframe import ReframeTarget, reframe_character

            target = ReframeTarget(width=self._target_w, height=self._target_h)
            face_det = AnimeFaceDetector(ensure_cascade(self.config.models_path))
            folder, ok, total = reframe_character(
                self.episode_root,
                self.character_name,
                self.shot_rows,
                face_det,
                target,
                on_progress=lambda d, t: self.progress.emit(d, t),
            )
            self.finished.emit(
                {"folder": str(folder), "ok": ok, "total": total, "name": self.character_name}
            )
        except Exception as e:
            tb = traceback.format_exc()
            print("\n=== Reframe falhou ===", file=sys.stderr)
            print(tb, file=sys.stderr, flush=True)
            self.failed.emit(f"{e}\n\n{tb}")


def start_pipeline(parent: QObject, config: Config, info: EpisodeInfo) -> tuple[QThread, PipelineWorker]:
    thread = QThread(parent)
    worker = PipelineWorker(config, info)
    worker.moveToThread(thread)
    thread.started.connect(worker.run)
    worker.finished.connect(thread.quit)
    worker.failed.connect(thread.quit)
    return thread, worker
