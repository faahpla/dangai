from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from scenedetect import AdaptiveDetector, SceneManager, open_video

#: Identidade do detector dentro do cache de cortes (`shot_bounds.json`).
#:
#: MUDE isto junto com qualquer coisa que altere ONDE os cortes caem. O cache
#: é por episódio e sobrevive à reanálise: sem trocar a identidade, episódio
#: já analisado reusaria os cortes velhos, e a melhora não apareceria
#: justamente pra quem já tem acervo.
DETECTOR_ID = "adaptive/ratio=2.0/floor=15.0/curta-cola"


@dataclass
class ShotBounds:
    idx: int
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


def detect_shots(
    video_path: str | Path,
    min_content_val: float = 15.0,
    adaptive_ratio: float = 2.0,
    min_seconds: float = 0.6,
    on_progress: Callable[[float], None] | None = None,
) -> list[ShotBounds]:
    """Onde cada cena começa e termina, por detecção ADAPTATIVA.

    O `ContentDetector` comparava cada quadro com o anterior e cortava quando
    a diferença passava de um número fixo (27). Isso falha exatamente onde o
    anime mais precisa: cena escura, chuva, diálogo em close. Dois planos
    diferentes de rostos escuros têm diferença numérica pequena, não chegam
    aos 27, e viram UM clipe só.

    Medido no acervo: 334 clipes de 8s ou mais FORA dos créditos, em 11
    episódios — uns 30 por episódio. O pior, no Re:ZERO S04E11, tinha 40,6s
    com Subaru e Emilia se revezando quatro vezes. Um clipe assim não serve
    pra nenhum dos dois: ele não é de ninguém.

    O `AdaptiveDetector` compara a diferença de cada quadro com a VIZINHANÇA
    dela (`adaptive_ratio` vezes a média móvel) em vez de com uma constante,
    então um corte dentro de uma cena escura se destaca do próprio escuro ao
    redor. `min_content_val` é só um piso contra ruído de cena parada — não é
    mais o gatilho.

    Medido naquele clipe de 40,6s: acha os 4 cortes, nos lugares certos. No
    Bleach S01E06 inteiro, 419 -> 466 cenas (+11%) e ~14% mais rápido.

    **A razão 3,0 original tinha o defeito espelhado.** Comparar com a
    vizinhança falha quando a vizinhança inteira já está agitada: numa
    batalha de magia — flash, raio, tela piscando — nenhum corte chega a ser
    3x a média, porque a média já é enorme. Medido num clipe do Slime
    S04E23 com ~9 cenas em 10,3s: razão 3,0 achou ZERO cortes (o
    ContentDetector antigo achava 1, e mesmo assim errava). A 2,0 acha 6.

    2,0 e não menos: a 1,5 acha os 12 do mesmo clipe, mas o episódio inteiro
    ganha só 5% de cenas e o dobro de fragmentos curtos. Vale medir de novo
    num episódio de ação antes de descer mais.
    """
    video = open_video(str(video_path))
    sm = SceneManager()
    sm.add_detector(
        AdaptiveDetector(adaptive_threshold=adaptive_ratio, min_content_val=min_content_val)
    )
    # detect_scenes blocks for the whole episode (minutes). The per-cut
    # callback (fires every few seconds of video) feeds real progress to the
    # UI — and gives the cancel button a place to land mid-detection.
    callback = None
    if on_progress is not None:
        total_frames = max(int(video.duration.get_frames() or 0), 1)

        def callback(_image, frame_num) -> None:
            # scenedetect 0.7.x passa um FrameTimecode aqui (antes era int).
            # get_frames() dá o número inteiro do frame nas duas versões.
            fn = frame_num.get_frames() if hasattr(frame_num, "get_frames") else int(frame_num)
            on_progress(min(fn / total_frames, 1.0))

    sm.detect_scenes(video, show_progress=False, callback=callback)
    scenes = sm.get_scene_list()

    # Cena curta demais COLA na anterior, não some.
    #
    # Antes era `continue`: o trecho saía da lista e nenhum clipe cobria
    # aqueles segundos — episódio perdido em silêncio. Passava despercebido
    # porque eram poucos (11 num episódio), mas é o que impedia subir a
    # sensibilidade: com `adaptive_ratio` menor os fragmentos passam de 100, e
    # aí o buraco deixa de ser detalhe. Colando, ficar mais sensível não custa
    # mais material nenhum.
    shots: list[ShotBounds] = []
    for s, e in scenes:
        start = s.get_seconds()
        end = e.get_seconds()
        if end - start < min_seconds and shots:
            shots[-1].end = end
            continue
        shots.append(ShotBounds(idx=len(shots), start=start, end=end))

    if not shots:
        # fallback: whole video as one shot
        dur = video.duration.get_seconds()
        shots = [ShotBounds(idx=0, start=0.0, end=dur)]

    if on_progress is not None:
        on_progress(1.0)
    return shots
