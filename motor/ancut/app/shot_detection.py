from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from scenedetect import AdaptiveDetector, SceneManager, open_video

from .corte_v2 import quadros, refinar_cortes
from .corte_v3 import refinar_v3, sinais_v3

#: Em quantos pedaços paralelos o vídeo é lido na detecção (do motor do
#: Dangai). Medido lá no Ryzen 9900X: 1 = 387 quadros/s, 4 = ~700 (a leitura
#: satura na memória; 8 não passa de 720). 1 = a detecção sequencial.
PEDACOS_DA_DETECCAO = 4
#: Quadros que cada pedaço lê A MAIS antes do começo dele: o 1º serve de
#: quadro anterior e os outros conferem, nota por nota, que o pedaço leu os
#: mesmos quadros que o vizinho (o seek do OpenCV caiu no lugar certo).
SOBRA_DO_PEDACO = 8

#: Identidades do corte dentro do cache (`shot_bounds.json`).
#:
#: As três primeiras são as MESMAS do Dangai (o "Gerar recap" do Levi), que
#: usa o mesmo motor: os dois apps aceitam o cache um do outro e dão os
#: mesmos cortes. Ver `corte_v2.py` e `corte_v3.py`, copiados de lá sem
#: mudança.
#:
#: v1 — o AdaptiveDetector sozinho (razão 2,0, piso 15, curta-cola).
DETECTOR_ID_V1 = "adaptive/ratio=2.0/floor=15.0/curta-cola"
#: v2 — mais flash, luz, fade na saída do escuro e 2ª chance.
DETECTOR_ID_V2 = "adaptive/ratio=2.0/floor=15.0/curta-cola/v2-flash-luz-fade"
#: v3 — mais cor, saída do branco e a nota aprendida no estudo do Levi.
DETECTOR_ID_V3 = "adaptive/ratio=2.0/floor=15.0/curta-cola/v3-cor-branco-nota"
#: O da 1.32.x do AnCut: o documento do aniFlow portado ao pé da letra. Saiu
#: porque o estudo do Levi achou dois defeitos nele — a regra de flash
#: confundia "a luz ainda não mudou" com "voltou" (12 de 23 cortes tirados
#: eram troca de câmera de verdade) e o dissolve inventava corte em pan e
#: efeito (34 de 50). Continua ACEITO no cache pelo motivo abaixo.
DETECTOR_ID_ANIFLOW = "adaptive/ratio=2.0/floor=15.0/curta-cola/refino-aniflow-1"

#: A versão do corte que episódio NOVO ganha.
VERSAO_DO_CORTE = 3
_IDENTIDADES = {1: DETECTOR_ID_V1, 2: DETECTOR_ID_V2, 3: DETECTOR_ID_V3}
DETECTOR_ID = _IDENTIDADES[min(max(VERSAO_DO_CORTE, 1), 3)]

#: Episódio com QUALQUER uma destas no cache nunca é recortado, nem na
#: reanálise.
#:
#: Antes, trocar o corte recortava o acervo inteiro na reanálise seguinte —
#: e os números das cenas mudavam. A curadoria manual (cena tirada ou movida
#: de personagem) é guardada pelo NÚMERO da cena, então passava a valer pra
#: outra cena. O Dangai já tinha essa regra; agora os dois concordam. Cache de
#: um corte anterior a estes (razão 3,0, ou sem identidade) continua sendo
#: refeito, como sempre foi.
DETECTORES_ACEITOS = frozenset(
    {DETECTOR_ID_V1, DETECTOR_ID_V2, DETECTOR_ID_V3, DETECTOR_ID_ANIFLOW}
)


class Cortes(list):
    """A lista de ShotBounds, com a identidade do corte que saiu de verdade
    (o v3 que falha volta ao v2, o v2 ao v1, e o cache grava o que saiu)."""

    def __init__(self, shots=(), detector: str = DETECTOR_ID_V1) -> None:
        super().__init__(shots)
        self.detector = detector


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
    versao: int | None = None,
    paralelo: int | None = None,
) -> Cortes:
    """Onde cada cena começa e termina: o AdaptiveDetector e, por cima, o
    corte v3 (ou o v2, se o v3 falhar), com os sinais tirados do mesmo quadro
    que o detector já usa, na mesma leitura do vídeo.

    **Por que adaptativo.** O `ContentDetector` comparava cada quadro com o
    anterior e cortava quando a diferença passava de um número fixo (27). Isso
    falha exatamente onde o anime mais precisa: cena escura, chuva, diálogo em
    close — dois planos de rostos escuros não chegam aos 27 e viram UM clipe.
    Medido no acervo: 334 clipes de 8s ou mais fora dos créditos em 11
    episódios; o pior, no Re:ZERO S04E11, com 40,6s e Subaru e Emilia se
    revezando quatro vezes. O `AdaptiveDetector` compara a diferença com a
    VIZINHANÇA dela, e um corte dentro de cena escura se destaca do escuro.

    **Razão 2,0, não 3,0.** Comparar com a vizinhança falha quando ela inteira
    já está agitada: numa batalha de magia nenhum corte chega a 3x a média.
    Num clipe do Slime S04E23 com ~9 cenas em 10,3s, a 3,0 achou zero cortes;
    a 2,0 acha 6. A 1,5 achava 12, mas com o dobro de fragmentos curtos.

    **O v3 por cima** (estudo do Levi, quadro a quadro, 6 episódios, 3 deles
    nunca vistos pelo ajuste): nos três novos, "dois planos viram um" caiu de
    21 pra 4 e os cortes inventados de 122 pra 78. Ver `corte_v3.py`.
    """
    if versao is None:
        versao = VERSAO_DO_CORTE
    v2 = versao >= 2
    nivel = 3 if versao >= 3 else (2 if v2 else 0)
    video = open_video(str(video_path))
    fps = float(video.frame_rate)
    minimo = quadros(15, fps) if v2 else 15
    # A mesma detecção em PEDAÇOS paralelos (_cenas_em_paralelo, do motor do
    # Dangai): ler o vídeo (decodificar + converter cada quadro) é o gargalo,
    # ~2 min num episódio. O resultado é conferido e, em qualquer dúvida, cai
    # na sequencial de sempre — os cortes saem idênticos.
    scenes = None
    sinais: list | None = None
    if paralelo is None:
        paralelo = PEDACOS_DA_DETECCAO
    if paralelo > 1:
        try:
            sinais = [] if v2 else None
            scenes = _cenas_em_paralelo(
                video_path, video, adaptive_ratio, min_content_val, paralelo, on_progress,
                sinais=sinais, minimo=minimo, nivel=nivel,
            )
        except _NaoDaEmParalelo as e:
            print(f"[corte] deteccao em paralelo nao serviu ({e}); fazendo na sequencia.", flush=True)
            scenes = None
    if scenes is None:
        sm = SceneManager()
        if v2:
            detector = _AdaptiveComSinais(
                adaptive_threshold=adaptive_ratio, min_content_val=min_content_val,
                min_scene_len=minimo, nivel=nivel,
            )
        else:
            detector = AdaptiveDetector(
                adaptive_threshold=adaptive_ratio, min_content_val=min_content_val,
                min_scene_len=minimo,
            )
        sm.add_detector(detector)
        # detect_scenes blocks for the whole episode (minutes). The per-cut
        # callback (fires every few seconds of video) feeds real progress to the
        # UI — and gives the cancel button a place to land mid-detection.
        callback = None
        if on_progress is not None:
            total_frames = max(int(video.duration.get_frames() or 0), 1)

            def callback(_image, frame_num) -> None:
                # scenedetect 0.7.x passa um FrameTimecode aqui (antes era int).
                fn = frame_num.get_frames() if hasattr(frame_num, "get_frames") else int(frame_num)
                on_progress(min(fn / total_frames, 1.0))

        sm.detect_scenes(video, show_progress=False, callback=callback)
        scenes = sm.get_scene_list()
        sinais = detector.sinais if v2 else None

    identidade = DETECTOR_ID_V1
    feito = False
    if nivel >= 3:
        try:
            scenes = _cenas_v2(scenes, sinais, fps, adaptive_ratio, min_content_val, v3=True)
            identidade = DETECTOR_ID_V3
            feito = True
        except Exception as e:  # noqa: BLE001 -- o corte v2 continua valendo
            print(f"[corte] corte v3 nao serviu ({type(e).__name__}: {e}); tentando o v2.", flush=True)
    if v2 and not feito:
        try:
            scenes = _cenas_v2(scenes, sinais, fps, adaptive_ratio, min_content_val)
            identidade = DETECTOR_ID_V2
        except Exception as e:  # noqa: BLE001 -- o corte v1 continua valendo
            print(f"[corte] corte v2 nao serviu ({type(e).__name__}: {e}); fica o corte v1.", flush=True)

    # Cena curta demais COLA na anterior, não some.
    #
    # Antes era `continue`: o trecho saía da lista e nenhum clipe cobria
    # aqueles segundos — episódio perdido em silêncio. Colando, ficar mais
    # sensível não custa material nenhum.
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
    return Cortes(shots, identidade)


def _luz_e_hist(quadro):
    """A luz e o histograma do corte v2. ``quadro`` é o quadro que o
    SceneManager já reduziu (256x144 num 1080p), levado a 128x72 com
    INTER_AREA. luz = luma média / 255, com luma = (77R + 150G + 29B) >> 8;
    hist = a luma em 16 faixas (luma >> 4), somando 1."""
    import cv2
    import numpy as np

    p = cv2.resize(quadro, (128, 72), interpolation=cv2.INTER_AREA)
    b = p[..., 0].astype(np.uint32)
    g = p[..., 1].astype(np.uint32)
    r = p[..., 2].astype(np.uint32)
    y = (77 * r + 150 * g + 29 * b) >> 8
    return float(y.mean()) / 255, (np.bincount((y >> 4).ravel(), minlength=16) / y.size).astype(np.float32)


def _sinais_do_quadro(quadro, nivel: int) -> tuple:
    """(luz, hist) no v2; (luz, hist, hs, mini) no v3."""
    return sinais_v3(quadro) if nivel >= 3 else _luz_e_hist(quadro)


class _AdaptiveComSinais(AdaptiveDetector):
    """O AdaptiveDetector guardando, quadro a quadro, a posição, a nota, a luz
    e o histograma (e, no v3, o hs e a mini)."""

    def __init__(self, nivel: int = 2, **kw) -> None:
        super().__init__(**kw)
        self.nivel = nivel
        self.sinais: list = []

    def _calculate_frame_score(self, timecode, frame_img) -> float:
        nota = super()._calculate_frame_score(timecode, frame_img)
        self.sinais.append((timecode, nota, *_sinais_do_quadro(frame_img, self.nivel)))
        return nota


def _indices_dos_cortes(pos, inicios) -> list[int]:
    """O índice, na lista de quadros lidos, de cada início de cena.

    Casa pela ORDEM dos quadros: cada corte é procurado a partir do quadro
    seguinte ao do corte anterior. Vale o próprio objeto da posição (o
    detector devolve no corte a posição que recebeu do quadro); sem ele, o 1º
    quadro com a mesma posição exata (o PTS). NÃO use um dicionário
    frame_num → índice: vídeo com dois quadros do mesmo frame_num (o frame_num
    é o tempo arredondado; o Cyberpunk Edgerunners S02E01 tem dois 8098)
    derrubava o episódio inteiro pro v1.
    """
    cortes: list[int] = []
    j = 1
    for s in inicios:
        achou = igual = None
        i = j
        while i < len(pos):
            if pos[i] is s:
                achou = i
                break
            if pos[i] == s:
                if igual is None:
                    igual = i
            elif igual is not None:
                break  # passou da fileira de quadros com a mesma posição
            i += 1
        if achou is None:
            achou = igual
        if achou is None:
            raise ValueError(f"corte {s.frame_num} fora dos quadros lidos")
        cortes.append(achou)
        j = achou + 1
    return cortes


def _cenas_v2(scenes, sinais, fps: float, ratio: float, piso: float, v3: bool = False):
    """As cenas do AdaptiveDetector passadas pelo corte v2
    (corte_v2.refinar_cortes) ou, com ``v3``, pelo corte v3
    (corte_v3.refinar_v3)."""
    import numpy as np

    if not scenes:
        return scenes
    if not sinais:
        raise ValueError("sem os sinais dos quadros")
    pos = [x[0] for x in sinais]
    if pos[0] != scenes[0][0]:
        raise ValueError("a 1a cena nao comeca no 1o quadro lido")
    cortes = _indices_dos_cortes(pos, [s for s, _e in scenes[1:]])
    nota = np.array([x[1] for x in sinais], dtype=np.float64)
    luz = np.array([x[2] for x in sinais], dtype=np.float64)
    hist = np.stack([x[3] for x in sinais])
    if v3:
        if any(len(x) < 6 for x in sinais):
            raise ValueError("sem o hs e a mini dos quadros")
        final = refinar_v3(nota, luz, hist, np.stack([x[4] for x in sinais]),
                           np.stack([x[5] for x in sinais]), cortes, fps,
                           razao=ratio, piso=piso)
    else:
        final = refinar_cortes(nota, luz, hist, cortes, fps, razao=ratio, piso=piso)
    inicios = [scenes[0][0]] + [pos[c] for c in final]
    return list(zip(inicios, inicios[1:] + [scenes[-1][1]]))


# ---------------------------------------------------------------------------
# A detecção em pedaços paralelos, com o MESMO resultado (do motor do Dangai).
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


def _ler_pedaco(video_path, de: int, ate: int | None, ratio: float, piso: float, contador: list, parar,
                sinais: int = 0):
    """[(posicao, nota)] dos quadros [de, ate) (ate None = ate o fim) e a
    posicao final do video (so no ultimo pedaco), como o SceneManager le.
    Com ``sinais`` 2: [(posicao, nota, luz, hist)], o corte v2 no mesmo
    passe; 3: [(posicao, nota, luz, hist, hs, mini)], o corte v3."""
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
        nota = det._calculate_frame_score(pos, quadro)
        saida.append((pos, nota, *_sinais_do_quadro(quadro, sinais)) if sinais else (pos, nota))
        contador[0] += 1
    if ate is not None:
        return saida, None
    # O fim do video como o leitor deste pedaco ve: a posicao, o frame_number do
    # OpenCV e o PTS (no fim do arquivo o PTS e 0 e a posicao sai do frame_number).
    return saida, (v.position, v.frame_number, getattr(getattr(v, "timecode", None), "pts", 0))


def _fim_como_na_sequencial(video, fim, num_fim: int, pts_fim, lidos: int):
    """A posicao final que a deteccao SEQUENCIAL teria.

    No fim do arquivo o OpenCV devolve PTS 0, e a posicao sai do frame_number
    (``frame_number - 1``). Lendo do comeco, o frame_number conta os quadros
    decodificados; depois do seek do ultimo pedaco, ele parte do numero que o
    tempo do seek da e so entao conta. Com salto de PTS antes do seek os dois
    diferem pelo numero de saltos (Black Clover S02E03: 34287 contra 34286), e o
    fim da ultima cena sairia 1 quadro depois. Aqui a posicao e refeita com o
    total de quadros lidos, do mesmo jeito que o leitor faria.
    """
    if (pts_fim or 0) > 0 or num_fim <= 0 or num_fim == lidos:
        return fim
    try:
        from fractions import Fraction

        from scenedetect.common import FrameTimecode, Timecode

        fps = video.frame_rate
        tc = Timecode(pts=(lidos - 1) * fps.denominator, time_base=Fraction(1, fps.numerator))
        return FrameTimecode(timecode=tc, fps=fps)
    except Exception as e:  # noqa: BLE001 -- sem como refazer: a sequencial de sempre
        raise _NaoDaEmParalelo(f"fim do video: {type(e).__name__}: {e}") from e


class _NotaPronta(AdaptiveDetector):
    """O AdaptiveDetector de sempre, com a nota de cada quadro ja calculada."""

    def __init__(self, notas: list[float], **kw) -> None:
        super().__init__(**kw)
        self._notas = iter(notas)

    def _calculate_frame_score(self, timecode, frame_img) -> float:
        return next(self._notas)


def _cenas_em_paralelo(video_path, video, ratio: float, piso: float, pedacos: int, on_progress,
                       sinais: list | None = None, minimo: int = 15, nivel: int = 2):
    """As cenas do AdaptiveDetector lidas em ``pedacos`` paralelos. Com
    ``sinais`` (uma lista), ela recebe (posicao, nota, luz, hist) de cada quadro,
    na ordem, para o corte v2 (``nivel`` 3: mais o hs e a mini, para o v3);
    ``minimo`` = o min_scene_len do detector."""
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
            futuros.append(pool.submit(
                _ler_pedaco, video_path, de, ate, ratio, piso, contadores[i], parar,
                max(nivel, 2) if sinais is not None else 0,
            ))
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
        # A sobra (os quadros antes da borda) tem que ser EXATAMENTE o fim
        # do que o vizinho leu, na mesma ordem: mesmo quadro, mesmo tempo e (fora
        # o 1o, que nao tem anterior no pedaco) a mesma nota. Nao se exige mais o
        # frame_num seguido: video com salto de PTS (um quadro a menos na conta do
        # tempo, como o Black Clover S02E03 em 8640->8642 e 25906->25908) tem
        # buraco no frame_num, e antes caia inteiro na sequencial (150-184 s em vez
        # de ~55 s). Nada se perde porque o 1o quadro novo do pedaco e o que vem,
        # no MESMO decodificador, logo depois da sobra conferida.
        k = 0
        while k < len(lidos) and lidos[k][0].frame_num < bordas[i]:
            k += 1
        sobra, novos = lidos[:k], lidos[k:]
        if len(sobra) < SOBRA_DO_PEDACO // 2 or len(sobra) > len(juntos):
            raise _NaoDaEmParalelo(f"o pedaco {i} comecou fora do lugar")
        for j, (meu, viz) in enumerate(zip(sobra, juntos[-len(sobra):])):
            if meu[0] != viz[0] or (j > 0 and meu[1] != viz[1]) or meu[2:3] != viz[2:3]:
                raise _NaoDaEmParalelo(f"a sobra do pedaco {i} nao bate no quadro {meu[0].frame_num}")
        # A ordem e conferida pela posicao exata (o PTS), nao pelo
        # frame_num, e quadro com a MESMA posicao do anterior passa: dois
        # quadros podem ter o mesmo frame_num (o tempo arredondado; Cyberpunk
        # Edgerunners S02E01 tem dois 8098) e a sequencial le os dois do mesmo
        # jeito. Os dois caem sempre no mesmo pedaco (a borda e por frame_num).
        if not novos or not juntos[-1][0] < novos[0][0]:
            raise _NaoDaEmParalelo(f"buraco entre os pedacos {i - 1} e {i}")
        juntos.extend(novos)
    for a, b in zip(juntos, juntos[1:]):
        if b[0] < a[0]:
            raise _NaoDaEmParalelo(f"quadro fora de ordem perto de {a[0].frame_num}")
    if resultados[-1][1] is None:
        raise _NaoDaEmParalelo("sem a posicao final")
    fim = _fim_como_na_sequencial(video, *resultados[-1][1], len(juntos))

    # A decisao: o AdaptiveDetector e o SceneManager de verdade, com as notas prontas.
    sm.add_detector(_NotaPronta([x[1] for x in juntos], adaptive_threshold=ratio, min_content_val=piso,
                                min_scene_len=minimo))
    sm._base_timecode = video.base_timecode
    sm._start_pos = juntos[0][0]
    vazio = np.zeros((1, 1, 3), dtype=np.uint8)
    for x in juntos:
        sm._process_frame(x[0], vazio)
    sm._last_pos = fim
    sm._post_process(fim)
    if on_progress is not None:
        on_progress(1.0)
    if sinais is not None:
        sinais.extend(juntos)
    return sm.get_scene_list()
