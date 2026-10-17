"""Lightweight types shared between the pipeline and the UI.

Importing this module MUST be cheap — no torch, no cv2, no open_clip.
The main window imports from here so the app can open in ~2s instead of
paying the ~10s tax of loading torch just to render UI. The heavy
`Pipeline` class stays in `pipeline.py` and is only imported when the
user actually starts an analysis (from `ui/worker.py` at click time).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Callable


class AIMode(str, Enum):
    """How the AI recognition path should look at each shot."""
    FULL = "full"       # send the middle keyframe as a whole to the model
    HYBRID = "hybrid"   # send only YOLO face crops


class AnimeNotFoundError(RuntimeError):
    """O anime não existe (ou não foi achado) na AniList nem no MAL, e não
    há banco local descoberto. A UI oferece o Modo Descoberta como saída."""


@dataclass
class DiscoveredGroup:
    """Um 'personagem sem nome' encontrado pelo clustering de rostos."""
    key: int                      # id do grupo dentro do resultado
    n_faces: int
    n_shots: int
    thumbs_jpg: list[bytes]       # crops representativos pra tela de batismo
    ref_crops_jpg: list[bytes]    # crops que viram refs quando o grupo é nomeado
    shot_ids: list[int]           # ids (DB) dos shots onde o grupo aparece
    shot_positions: list[int]     # posições em DiscoveryResult.shots
    shot_conf: dict[int, float]   # pos -> melhor similaridade ao centroide
    centroid_bytes: bytes         # embedding do centroide serializado
    # Quando o anime JÁ é conhecido: nome pré-sugerido pelo match do
    # centroide do grupo contra os personagens do banco ("parece a Eris").
    suggested_name: str = ""
    suggested_sim: float = 0.0
    # O nome não é palpite: o grupo bateu com folga num personagem batizado
    # em outro episódio (`face_clustering.reconhece`). A tela já traz o nome
    # preenchido e põe o grupo na seção "reconhecidos".
    known: bool = False
    # Fica atrás do botão de figurantes na tela: poucas cenas, ou um grupo
    # que é mais nuca e cabelo do que rosto. Decidido no pipeline.
    minor: bool = False


@dataclass
class DiscoveryShot:
    """Shot cortado durante a descoberta, com tudo que o commit precisa."""
    pos: int
    shot_id: int
    idx: int
    file: str                     # caminho absoluto do .mp4 do shot
    keyframes: list[str]          # caminhos absolutos dos keyframes
    start: float
    end: float


@dataclass
class DiscoveryResult:
    """Saída do Modo Descoberta, antes do batismo. Autossuficiente: carrega
    tudo que commit_discovery precisa, pra poder cruzar threads como dado."""
    anime_title: str
    season: int
    episode: int
    anime_id: int                 # id no DB local
    episode_id: int
    episode_root: Path
    cache_id: str                 # pasta de refs: al<id> (online) ou local-<slug>
    shots: list[DiscoveryShot]
    groups: list[DiscoveredGroup]
    total_faces: int
    # True quando o anime resolveu online: refs reforçam o banco real e o
    # metadata local não é gravado (o anime se resolve sozinho).
    online: bool = False
    # Elenco oficial (nomes das bases online) — vira dropdown na tela de
    # batismo, pro usuário escolher em vez de digitar.
    roster: list[str] = field(default_factory=list)


class InsufficientRefsError(RuntimeError):
    """No character ended up with usable reference images (dead APIs, brand
    new season...). Carries the refs folder so the UI can offer to open it —
    the user can drop face images in per-character subfolders and re-run."""

    def __init__(self, message: str, refs_dir: str) -> None:
        super().__init__(message)
        self.refs_dir = refs_dir


class PipelineCancelled(BaseException):
    """Raised from inside the progress callback when the user hits Cancelar.
    The pipeline reports progress at every loop iteration, so raising here
    unwinds the whole run at the next stage/shot boundary without every loop
    needing its own cancel check.

    Subclasses BaseException (like KeyboardInterrupt) on purpose: the raise
    happens deep inside loops that are wrapped in generic `except Exception`
    blocks — ours and third-party — and none of them may swallow a cancel."""


ProgressCb = Callable[[str, float, str], None]
"""(stage_id, fraction_0_to_1, message) — fraction may be -1 when indeterminate."""


class StageTimer:
    """Mede a duração real de cada estágio embrulhando o progress callback.

    O início de um estágio é o instante do último evento anterior a ele (não
    o primeiro callback dele — estágios que só reportam no fim, como o corte,
    fariam o trabalho sumir da conta). O relatório vai pro app.log e pro
    timings.json do episódio — é ele que diz onde investir otimização."""

    def __init__(self) -> None:
        import time
        self._clock = time.perf_counter
        self._t0 = self._clock()
        self._last = self._t0
        self._start: dict[str, float] = {}
        self._end: dict[str, float] = {}

    def wrap(self, cb: ProgressCb) -> ProgressCb:
        def wrapped(stage: str, frac: float, msg: str) -> None:
            now = self._clock()
            if stage not in self._start:
                self._start[stage] = self._last
            self._end[stage] = now
            self._last = now
            cb(stage, frac, msg)
        return wrapped

    def durations(self) -> dict[str, float]:
        labels = dict(STAGES)
        out: dict[str, float] = {}
        for sid, _ in STAGES:
            if sid in self._start:
                out[sid] = max(0.0, self._end[sid] - self._start[sid])
        for sid in self._start:  # estágios fora da lista oficial, se houver
            if sid not in labels:
                out[sid] = max(0.0, self._end[sid] - self._start[sid])
        return out

    def total(self) -> float:
        return self._clock() - self._t0

    def report(self) -> str:
        labels = dict(STAGES)
        parts = [
            f"{labels.get(sid, sid)}: {dur:.1f}s"
            for sid, dur in self.durations().items()
            if dur >= 0.05
        ]
        return " | ".join(parts) + f" | TOTAL: {self.total():.1f}s"

    def to_json(self) -> dict:
        return {
            "total_seconds": round(self.total(), 2),
            "stages": {k: round(v, 2) for k, v in self.durations().items()},
        }


STAGES = [
    ("parse", "Lendo arquivo"),
    ("detect_shots", "Detectando shots"),
    ("cut_shots", "Cortando clipes"),
    ("fetch_characters", "Buscando personagens"),
    ("download_refs", "Baixando referências"),
    ("embed_refs", "Gerando embeddings das referências"),
    ("analyze_shots", "Analisando shots"),
    ("second_pass", "Resgatando cenas parecidas"),
    ("ai_review", "Revisão IA dos duvidosos"),
    ("organize", "Organizando resultados"),
]


@dataclass
class PipelineResult:
    episode_root: Path
    total_shots: int
    total_characters: int
    identified_characters: list[str]
    pair_counts: dict[str, int]
    anime_title: str
    season: int
    episode: int
    episode_id: int
    #: "" = episódio, "OP" = abertura, "ED" = encerramento. Vem do
    #: EpisodeInfo e segue até a interface, que rotula o resultado.
    kind: str = ""
    # Set when the run proceeded with a skeleton crew (1-2 characters with
    # usable refs while others were skipped) — the UI turns it into a dialog
    # offering the refs folder. 3+ usable characters = no nagging.
    low_refs_warning: str | None = None
    refs_dir: str | None = None
    # Ponte verde→batismo: grupos de cenas que o resgate por grupo não
    # conseguiu nomear, empacotados como DiscoveryResult — a UI oferece a
    # tela de batismo no fim da análise. None = nada sobrou.
    leftover_groups: "DiscoveryResult | None" = None
