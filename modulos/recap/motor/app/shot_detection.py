from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from scenedetect import AdaptiveDetector, SceneManager, open_video

#: [recap] O1: em quantos pedidos paralelos o video e lido na deteccao. Medido
#: no Ryzen 9900X: 1 = 387 quadros/s, 4 = ~700 (a leitura satura na memoria;
#: 8 nao passa de 720). 1 = a deteccao sequencial de sempre.
PEDACOS_DA_DETECCAO = 4
#: Quadros que cada pedaco le A MAIS antes do comeco dele: o 1o serve de
#: quadro anterior e os outros conferem, nota por nota, que o pedaco leu os
#: mesmos quadros que o vizinho (o seek do OpenCV caiu no lugar certo).
SOBRA_DO_PEDACO = 8

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
    paralelo: int | None = None,
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
    # [recap] O1: a mesma deteccao em PEDACOS paralelos (_cenas_em_paralelo):
    # a leitura do video (decodificar + converter cada quadro) era o gargalo,
    # ~98 s num episodio de 24 min. O resultado e conferido e, em qualquer
    # duvida, cai na sequencial de sempre.
    scenes = None
    if paralelo is None:
        paralelo = PEDACOS_DA_DETECCAO
    if paralelo > 1:
        try:
            scenes = _cenas_em_paralelo(
                video_path, video, adaptive_ratio, min_content_val, paralelo, on_progress
            )
        except _NaoDaEmParalelo as e:
            print(f"[CorteCenas] deteccao em paralelo nao serviu ({e}); fazendo na sequencia.", flush=True)
            scenes = None
    if scenes is None:
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


# ---------------------------------------------------------------------------
# [recap] O1: a deteccao em pedacos paralelos, com o MESMO resultado.
#
# O AdaptiveDetector decide os cortes por uma nota por quadro (a diferenca
# HSV do quadro reduzido para o anterior: ContentDetector._calculate_frame_score)
# e por uma janela de 2 quadros de cada lado dessa nota. A nota de um quadro so
# depende dele e do anterior. Entao:
#   1. K leitores leem o video em K pedacos ao mesmo tempo (cada um com o seu
#      VideoStreamCv2, como a deteccao de sempre), reduzem o quadro do MESMO
#      jeito (cv2.resize LINEAR para o tamanho do SceneManager) e calculam a
#      nota com o MESMO metodo do detector;
#   2. cada pedaco comeca SOBRA_DO_PEDACO quadros antes: o anterior da nota do
#      1o quadro dele e os outros tem que bater, nota por nota e tempo por
#      tempo, com o que o vizinho leu. Nao bateu (seek fora do lugar, quadro
#      de tamanho diferente, video que nao abre): a deteccao volta para a
#      sequencial;
#   3. as notas, em ordem, passam pelo AdaptiveDetector de verdade dentro de
#      um SceneManager de verdade (so o calculo da nota e trocado pela nota ja
#      calculada): os cortes, os tempos e a lista de cenas saem do mesmo codigo.
# ---------------------------------------------------------------------------


class _NaoDaEmParalelo(RuntimeError):
    """A deteccao em pedacos nao serve para este video: volta a sequencial."""


def _tamanho_reduzido(largura: int, altura: int) -> tuple[int, int] | None:
    """O tamanho em que o SceneManager reduz o quadro (auto_downscale), ou None."""
    from scenedetect.scene_manager import compute_downscale_factor

    fator = compute_downscale_factor(max(largura, altura))
    if fator <= 1.0:
        return None
    return (max(1, round(largura / fator)), max(1, round(altura / fator)))


def _ler_pedaco(video_path, de: int, ate: int | None, ratio: float, piso: float, contador: list, parar):
    """[(posicao, nota)] dos quadros [de, ate) (ate None = ate o fim) e a
    posicao final do video (so no ultimo pedaco), como o SceneManager le."""
    import cv2

    v = open_video(str(video_path))
    if de > 0:
        v.seek(de)
    det = AdaptiveDetector(adaptive_threshold=ratio, min_content_val=piso)
    saida = []
    tamanho = None
    alvo = None
    while not parar.is_set():
        quadro = v.read()
        if quadro is False:
            break
        pos = v.position
        if ate is not None and pos.frame_num >= ate:
            break
        dec = (quadro.shape[1], quadro.shape[0])
        if tamanho is None:
            tamanho = dec
            alvo = _tamanho_reduzido(*dec)
        elif dec != tamanho:
            raise _NaoDaEmParalelo("quadro com tamanho diferente no meio do video")
        if alvo is not None:
            quadro = cv2.resize(quadro, alvo, interpolation=cv2.INTER_LINEAR)
        saida.append((pos, det._calculate_frame_score(pos, quadro)))
        contador[0] += 1
    return saida, (v.position if ate is None else None)


class _NotaPronta(AdaptiveDetector):
    """O AdaptiveDetector de sempre, com a nota de cada quadro ja calculada."""

    def __init__(self, notas: list[float], **kw) -> None:
        super().__init__(**kw)
        self._notas = iter(notas)

    def _calculate_frame_score(self, timecode, frame_img) -> float:
        return next(self._notas)


def _cenas_em_paralelo(video_path, video, ratio: float, piso: float, pedacos: int, on_progress):
    import threading
    import time
    from concurrent.futures import ThreadPoolExecutor

    import numpy as np

    total = int(video.duration.frame_num or 0) if video.duration is not None else 0
    if total < pedacos * 400:
        raise _NaoDaEmParalelo("video curto")
    sm = SceneManager()
    for nome in ("_process_frame", "_post_process", "_start_pos", "_last_pos", "_base_timecode"):
        if not hasattr(sm, nome):
            raise _NaoDaEmParalelo(f"scenedetect sem {nome}")
    bordas = [total * i // pedacos for i in range(pedacos)]
    parar = threading.Event()
    contadores = [[0] for _ in range(pedacos)]
    with ThreadPoolExecutor(max_workers=pedacos) as pool:
        futuros = []
        for i, b in enumerate(bordas):
            de = 0 if i == 0 else b - SOBRA_DO_PEDACO
            ate = bordas[i + 1] if i + 1 < pedacos else None
            futuros.append(pool.submit(_ler_pedaco, video_path, de, ate, ratio, piso, contadores[i], parar))
        try:
            while not all(f.done() for f in futuros):
                time.sleep(0.25)
                if on_progress is not None:
                    feitos = sum(c[0] for c in contadores)
                    on_progress(min(0.99, feitos / max(total, 1)))
        except BaseException:
            # Cancelado (o on_progress levanta): os leitores param no proximo quadro.
            parar.set()
            raise
        resultados = []
        for f in futuros:
            try:
                resultados.append(f.result())
            except _NaoDaEmParalelo:
                raise
            except Exception as e:  # noqa: BLE001 -- qualquer erro de leitura volta a sequencial
                raise _NaoDaEmParalelo(f"{type(e).__name__}: {e}") from e

    juntos: list = []
    for i, (lidos, _fim) in enumerate(resultados):
        if not lidos:
            raise _NaoDaEmParalelo(f"pedaco {i} vazio")
        if i == 0:
            if lidos[0][0].frame_num != 0:
                raise _NaoDaEmParalelo("o 1o quadro nao e o 0")
            juntos.extend(lidos)
            continue
        # A sobra tem que bater com o vizinho: mesmo quadro, mesmo tempo e
        # (fora o 1o, que nao tem anterior no pedaco) a mesma nota.
        anteriores = {p.frame_num: (p, n) for p, n in juntos[-SOBRA_DO_PEDACO:]}
        conferidos = 0
        for j, (p, n) in enumerate(lidos):
            if p.frame_num >= bordas[i]:
                break
            viz = anteriores.get(p.frame_num)
            if viz is None or p != viz[0] or (j > 0 and n != viz[1]):
                raise _NaoDaEmParalelo(f"a sobra do pedaco {i} nao bate no quadro {p.frame_num}")
            conferidos += 1
        if conferidos < SOBRA_DO_PEDACO:
            raise _NaoDaEmParalelo(f"o pedaco {i} comecou fora do lugar")
        novos = [(p, n) for p, n in lidos if p.frame_num >= bordas[i]]
        if not novos or novos[0][0].frame_num != juntos[-1][0].frame_num + 1:
            raise _NaoDaEmParalelo(f"buraco entre os pedacos {i - 1} e {i}")
        juntos.extend(novos)
    for a, b in zip(juntos, juntos[1:]):
        if b[0].frame_num != a[0].frame_num + 1:
            raise _NaoDaEmParalelo(f"quadro fora de ordem perto de {a[0].frame_num}")
    fim = resultados[-1][1]
    if fim is None:
        raise _NaoDaEmParalelo("sem a posicao final")

    # A decisao: o AdaptiveDetector e o SceneManager de verdade, com as notas prontas.
    sm.add_detector(_NotaPronta([n for _, n in juntos], adaptive_threshold=ratio, min_content_val=piso))
    sm._base_timecode = video.base_timecode
    sm._start_pos = juntos[0][0]
    vazio = np.zeros((1, 1, 3), dtype=np.uint8)
    for p, _n in juntos:
        sm._process_frame(p, vazio)
    sm._last_pos = fim
    sm._post_process(fim)
    if on_progress is not None:
        on_progress(1.0)
    return sm.get_scene_list()
