"""[Studio] Modo ``rostos`` do headless: onde estao os rostos nos blocos do Studio.

Arquivo NOVO do AniRecap Studio (nao existe no ancut-hub-engine). Serve ao
enquadramento 9:16 da "Edicao rapida": o Studio pede, para cada pedaco de
plano que virou bloco, alguns instantes, e recebe os rostos de cada quadro.
Quem decide o foco (suavizar, preferir o personagem citado) e o TypeScript
(electron/services/montar/rostos-motor.ts); aqui so se detecta e identifica.

Por que no motor e nao no detector do Dangai (lbpcascade): o YOLO de rosto de
anime do motor (o MESMO do AnCut, face_detector.py) acha muito mais rosto, e
a cabeca de reserva pega perfil e personagem de longe. E em LOTE, um processo
para todos os pedacos: importar o torch e subir a GPU custa segundos.

Uso:
    python -m app.headless rostos      (pedido JSON na 1a linha do stdin)

Pedido:
    {"itens": [{"chave": "...", "arquivo": "...mp4", "instantes": [1.2, 1.8, 2.4],
                "personagens": ["Yuzuriha", "Taiju"],
                "candidatos": ["Ogawa, Yuzuriha", "Ooki, Taiju"]}],
     "anime": "Dr. Stone" | null, "temporada": 4 | null,
     "identificar": true, "aspecto": 0.489 | null}

    `aspecto`: a largura VISIVEL do recorte sobre a altura do quadro (0,489 no
    short 9:16 com a folga do Ken Burns). Com ele, o item cujo 1o citado nao
    tem rosto achado ganha as `janelas` (ver _Elenco.janelas).

    `personagens`: quem a frase cita, em ordem de preferencia.
    `candidatos`: o conjunto FECHADO em que cada rosto e procurado. Desde
    19/10 o host manda os citados, quem o INDICE reconhece no plano e o
    elenco principal do episodio (as pessoas que mais aparecem, ate 8) --
    nunca o elenco inteiro do anime: medido no S4-37, contra o elenco inteiro o
    CLIP trocava o Gen pelo Gozan e marcava figurante de fundo como Chrome. Com
    so o citado no conjunto (o de antes), todo rosto de anime parece com ele
    (~0,8 no CLIP) e nada se decide: no MRM E02 a Misa grande ficou no lugar do
    Lent pequeno no meio. Vazio = nao identifica.

Eventos (stdout, um JSON por linha):
    {"type": "pronto", "ms": .., "gpu": bool, "cabeca": bool, "elenco": "<pasta>"|null, "semElenco": ..}
    {"type": "rostos", "chave": "...", "largura": 1920, "altura": 1080,
     "quadros": [{"t": 1.2, "ok": true, "rostos": [
         {"x": .., "y": .., "w": .., "h": .., "conf": .., "tipo": "rosto"|"cabeca",
          "personagem": "Yuzuriha"|null, "pessoa": "Ogawa, Yuzuriha"|null,
          "sim": 0.95|null, "quem": "Ogawa, Yuzuriha"|null}]}]}
    {"type": "fim", "ms": .., "itens": N, "identificados": n, "clipMs": ..}
    erro: {"type": "failed", "message": "..."} (o main() do headless)

    O quadro pode trazer `janelas`: [{"x": .., "w": .., "quem": .., "sim": ..,
    "personagem": "MP"|null}] (19/10), as posicoes do recorte da esquerda para
    a direita e quem cada uma mostra.

    `pessoa`: QUEM e o rosto (a pasta do elenco), so quando a identificacao
    passou nas margens -- citado ou nao. `personagem`: o nome CITADO (como veio
    no pedido) que e essa pessoa. `quem`/`sim`: o mais parecido, sempre.

So LEITURA: o elenco (anime_db, ref_features.npz) e os mp4 sao so lidos --
nada de FeatureCache.save(), Config.save() nem ensure_dirs(). A pasta de dados
e a do Studio (ANIRECAP_MOTOR_DADOS), e as bibliotecas do AnCut/Corte Cenas
podem ser a origem dos mp4.

Identificar roda quando o item tem candidatos e o quadro tem rosto. O CLIP
(ViT-L/14, ~1 GB) sobe numa thread JA no comeco quando algum item tem
candidatos, em paralelo com o YOLO e a leitura dos quadros. Item com citados
tambem procura CABECA nos quadros que ja tem rosto (19/10): o perfil da
fadinha em close (MRM E02, "Ela ativou...") o modelo de rosto nao ve.
"""
from __future__ import annotations

import os
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable

import numpy as np

Emit = Callable[[dict], None]

#: Itens por ida a GPU. 16 itens x 3 instantes = 48 quadros 1080p (~300 MB).
ITENS_POR_LOTE = 16
#: Confianca do YOLO: a mesma do AnimeFaceDetector (conf=0.4).
CONF = 0.4
#: Rosto menor que isto (px, num quadro de 1080 linhas) e ruido de cenario,
#: a mesma regra do _size_filter (min_size=32). Escala com a altura.
MINIMO_PX_1080 = 32
#: Um rosto e do candidato quando parece com ele pelo menos isto (abaixo do
#: default_threshold 0.80 do reconhecimento: aqui a pergunta e fechada, "qual
#: destes rostos e ele", nao "quem esta na cena")...
LIMIAR_ID = 0.70
#: ...com folga sobre o 2o candidato para o MESMO rosto...
MARGEM_ID = 0.02
#: ...e sobre o 2o rosto para o MESMO candidato (dois rostos quase iguais = nao sei).
MARGEM_ENTRE_ROSTOS = 0.02
#: Com UMA pessoa so no conjunto nao ha 2o candidato para comparar: so vale
#: quem parece muito (no MRM E02 os rostos de outra pessoa davam 0,79-0,83 e o
#: proprio, 0,91-0,93).
LIMIAR_SOZINHO = 0.88
#: Cabeca que cobre um rosto ja achado e a mesma pessoa: fica so o rosto.
SOBREPOE_ROSTO = 0.3
#: As janelas do recorte (fracao da folga), quando o citado nao tem rosto achado.
POSICOES_DA_JANELA = (0.0, 0.25, 0.5, 0.75, 1.0)
#: A janela e do citado quando ele e o mais parecido dela, acima disto...
LIMIAR_JANELA = 0.80
#: ...com esta folga do 2o.
MARGEM_JANELA = 0.02


def _ms(desde: float) -> int:
    return int(round((time.perf_counter() - desde) * 1000))


# ------------------------------------------------------------------ modelos

def _modelo_local(repo: str, arquivo: str) -> Path:
    """O peso do HuggingFace: cache local primeiro (sem rede), depois a rede.

    A rede do Levi as vezes nao responde; com o cache cheio (o motor ja baixou
    na 1a analise) nao ha por que perguntar nada ao Hub."""
    from app.hub_local import baixar

    return Path(baixar(repo, arquivo))


class _Detector:
    """O YOLO de rosto de anime do motor + a cabeca de reserva, como no
    AnimeFaceDetector.detect_batch, mas devolvendo confianca e tipo."""

    def __init__(self, use_cuda: bool) -> None:
        import torch
        from ultralytics import YOLO

        from .matching.face_detector import _HEAD_FILE, _HEAD_REPO, _YOLO_FILE, _YOLO_REPO

        self.device = "cuda" if (use_cuda and torch.cuda.is_available()) else "cpu"
        self.rosto = YOLO(str(_modelo_local(_YOLO_REPO, _YOLO_FILE)))
        self.cabeca = None
        try:
            self.cabeca = YOLO(str(_modelo_local(_HEAD_REPO, _HEAD_FILE)))
        except Exception as e:  # noqa: BLE001 -- a cabeca e melhor esforco, como no motor
            print(f"[rostos] cabeca indisponivel ({e}); so rosto.")

    def _prever(self, modelo: Any, imgs: list[np.ndarray]) -> list[list[tuple[float, float, float, float, float]]]:
        try:
            res = modelo.predict(imgs, conf=CONF, verbose=False, device=self.device)
        except Exception:
            self.device = "cpu"
            res = modelo.predict(imgs, conf=CONF, verbose=False, device="cpu")
        saida: list[list[tuple[float, float, float, float, float]]] = []
        for r in res:
            caixas = getattr(r, "boxes", None)
            if caixas is None or len(caixas) == 0:
                saida.append([])
                continue
            xyxy = caixas.xyxy.cpu().numpy()
            confs = caixas.conf.cpu().numpy()
            saida.append(
                [
                    (float(x1), float(y1), float(x2 - x1), float(y2 - y1), float(c))
                    for (x1, y1, x2, y2), c in zip(xyxy, confs)
                ]
            )
        return saida

    def detectar(self, imgs: list[np.ndarray], cabecas: list[bool] | None = None) -> list[list[dict]]:
        """Por imagem: [{x,y,w,h,conf,tipo}], rosto primeiro; cabeca onde nao
        achou rosto (a cascata do motor) e, em `cabecas[i]`, tambem ao lado dos
        rostos -- so as que nao cobrem um rosto ja achado (perfil, nuca, close
        cortado na borda)."""
        saida: list[list[dict]] = [[] for _ in imgs]
        if not imgs:
            return saida

        def filtrar(img: np.ndarray, caixas: list, tipo: str) -> list[dict]:
            minimo = max(16.0, MINIMO_PX_1080 * img.shape[0] / 1080.0)
            return [
                {"x": round(x, 1), "y": round(y, 1), "w": round(w, 1), "h": round(h, 1),
                 "conf": round(c, 3), "tipo": tipo}
                for (x, y, w, h, c) in caixas
                if h >= minimo and w > 0
            ]

        for i, caixas in enumerate(self._prever(self.rosto, imgs)):
            saida[i] = filtrar(imgs[i], caixas, "rosto")
        faltam = [i for i, r in enumerate(saida) if not r or (cabecas is not None and cabecas[i])]
        if faltam and self.cabeca is not None:
            for i, caixas in zip(faltam, self._prever(self.cabeca, [imgs[i] for i in faltam])):
                rostos = saida[i]
                novas = [c for c in filtrar(imgs[i], caixas, "cabeca") if not any(_cobre(c, r) for r in rostos)]
                saida[i] = rostos + novas
        return saida


def atribuir(sims: np.ndarray) -> list[int | None]:
    """[19/10] QUEM e cada rosto: sims[i, j] = o rosto i contra a pessoa j.

    1. cada rosto quer a pessoa que mais parece com ele, acima de LIMIAR_ID e
       com MARGEM_ID do 2o candidato (com uma pessoa so no conjunto, acima de
       LIMIAR_SOZINHO: nao ha 2o para comparar);
    2. dois rostos querendo a mesma pessoa: fica o mais parecido, com
       MARGEM_ENTRE_ROSTOS do outro; quase empate, nenhum.
    Rosto que quer OUTRA pessoa nao disputa: antes ele contava, e a Misa grande
    (Misa 0,87, Lent 0,83) tirava o Lent do rosto pequeno dele (Lent 0,83)."""
    if sims.size == 0:
        return [None for _ in range(sims.shape[0])]
    sozinho = sims.shape[1] == 1
    quer: list[int | None] = []
    for i in range(sims.shape[0]):
        j = int(np.argmax(sims[i]))
        s1 = float(sims[i, j])
        s2 = float(np.max(np.delete(sims[i], j))) if sims.shape[1] > 1 else -1.0
        ok = s1 >= (LIMIAR_SOZINHO if sozinho else LIMIAR_ID) and s1 - s2 >= MARGEM_ID
        quer.append(j if ok else None)
    saida: list[int | None] = []
    for i, j in enumerate(quer):
        if j is None:
            saida.append(None)
            continue
        rivais = [float(sims[o, j]) for o in range(sims.shape[0]) if o != i and quer[o] == j]
        saida.append(None if rivais and float(sims[i, j]) - max(rivais) < MARGEM_ENTRE_ROSTOS else j)
    return saida


def quem_na_janela(sims: np.ndarray) -> list[int | None]:
    """[19/10] A pessoa que cada janela do recorte mostra (sims[i, j]: a janela i
    contra a pessoa j): a mais parecida, acima de LIMIAR_JANELA e com
    MARGEM_JANELA da 2a; senao ninguem."""
    saida: list[int | None] = []
    for i in range(sims.shape[0]):
        if sims.shape[1] < 2:
            saida.append(None)
            continue
        j = int(np.argmax(sims[i]))
        s1 = float(sims[i, j])
        s2 = float(np.max(np.delete(sims[i], j)))
        saida.append(j if s1 >= LIMIAR_JANELA and s1 - s2 >= MARGEM_JANELA else None)
    return saida


def _cobre(cabeca: dict, rosto: dict) -> bool:
    """A cabeca e a do rosto: a intersecao passa de SOBREPOE_ROSTO da area do rosto."""
    x0 = max(cabeca["x"], rosto["x"])
    y0 = max(cabeca["y"], rosto["y"])
    x1 = min(cabeca["x"] + cabeca["w"], rosto["x"] + rosto["w"])
    y1 = min(cabeca["y"] + cabeca["h"], rosto["y"] + rosto["h"])
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    return inter > SOBREPOE_ROSTO * max(1.0, rosto["w"] * rosto["h"])


# ------------------------------------------------------------------ quadros

def _quadro_ffmpeg(arquivo: str, t: float) -> np.ndarray | None:
    """Reserva do cv2 (caminho com acento no Windows, codec que ele nao abre)."""
    import cv2

    from .ffmpeg_locate import ffmpeg_binary

    try:
        p = subprocess.run(
            [ffmpeg_binary(), "-v", "error", "-ss", f"{max(t, 0):.3f}", "-i", arquivo,
             "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
            capture_output=True, timeout=30,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception:
        return None
    if not p.stdout:
        return None
    img = cv2.imdecode(np.frombuffer(p.stdout, dtype=np.uint8), cv2.IMREAD_COLOR)
    return img if img is not None and img.size else None


def _ler_quadros(arquivo: str, instantes: list[float]) -> list[np.ndarray | None]:
    """Um quadro por instante (segundos DENTRO do arquivo). Imagem parada: a
    mesma imagem em todos."""
    import cv2

    ext = os.path.splitext(arquivo)[1].lower()
    if ext in (".jpg", ".jpeg", ".png", ".webp", ".bmp"):
        img = cv2.imdecode(np.fromfile(arquivo, dtype=np.uint8), cv2.IMREAD_COLOR)
        return [img for _ in instantes]

    quadros: list[np.ndarray | None] = []
    cap = cv2.VideoCapture(arquivo)
    try:
        abriu = cap.isOpened()
        # Bloco mais longo que o plano segura o ULTIMO quadro (encaixe.ts): o
        # instante depois do fim vira esse ultimo quadro, nao um buraco.
        fps = cap.get(cv2.CAP_PROP_FPS) if abriu else 0.0
        n = cap.get(cv2.CAP_PROP_FRAME_COUNT) if abriu else 0.0
        fim = (n - 1) / fps if fps > 0 and n > 1 else None
        for t in instantes:
            if fim is not None:
                t = min(t, fim)
            img = None
            if abriu:
                cap.set(cv2.CAP_PROP_POS_MSEC, max(t, 0.0) * 1000.0)
                ok, f = cap.read()
                img = f if ok and f is not None and f.size else None
            if img is None:
                img = _quadro_ffmpeg(arquivo, t)
            quadros.append(img)
    finally:
        cap.release()
    return quadros


# ------------------------------------------------------------------ elenco

def _sem_vogal_longa(p: str) -> str:
    # A vogal longa do romaji que cada fonte escreve de um jeito: "Senkuu" do
    # MyAnimeList e "Senku" do roteiro (shared/nomes.ts, semVogalLonga).
    return p.replace("ou", "o").replace("uu", "u").replace("oo", "o")


def _fichas(nome: str) -> frozenset[str]:
    import unicodedata

    s = unicodedata.normalize("NFD", nome)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return frozenset(_sem_vogal_longa(f) for f in re.split(r"[^a-z0-9]+", s) if f)


def _mesma(a: frozenset[str], b: frozenset[str]) -> bool:
    """Mesmas palavras, ou um nome contido no outro ("Senku" em "Ishigami,
    Senkuu"): a regra do naming.find_token_match, com a vogal longa."""
    return bool(a) and bool(b) and (a == b or a < b or b < a)


class _Elenco:
    """O elenco do anime no cache do motor do Studio, SO LIDO.

    Os embeddings das fotos vem do ref_features.npz que a analise com
    reconhecimento deixou (FeatureCache, a mesma meta do pipeline). Foto sem
    embedding no cache e calculada na hora e NAO e gravada."""

    def __init__(self, cfg: Any, anime: str | None, temporada: int | None) -> None:
        self.cfg = cfg
        self.pasta: Path | None = None
        self.motivo = ""
        self._grupos: dict[frozenset[str], dict] | None = None
        self._cache: Any = None
        self._engine: Any = None
        self._carregando: threading.Thread | None = None
        self._erro_clip: str | None = None
        self.clip_ms = 0
        if not anime:
            self.motivo = "sem anime no pedido"
            return
        try:
            from .references.reference_store import resolve_anime_dir
            from .storage.anime_folders import AnimeFolderStore

            cache = cfg.cache_path
            franquia = AnimeFolderStore(cache).franchise_for_name(anime, int(temporada or 1), cache)
            if not franquia:
                self.motivo = f"franquia de '{anime}' desconhecida no cache do motor"
                return
            pasta = resolve_anime_dir(cache, franquia)
            if not (pasta / "characters").is_dir():
                self.motivo = f"sem fotos do elenco em {pasta.name}"
                return
            self.pasta = pasta
        except Exception as e:  # noqa: BLE001
            self.motivo = f"elenco ilegivel: {e}"

    # --- CLIP -----------------------------------------------------------

    def _carregar_clip(self) -> None:
        t0 = time.perf_counter()
        try:
            from .matching.embedding_engine import EmbeddingEngine

            self._engine = EmbeddingEngine(
                model_name=self.cfg.clip_model,
                pretrained=self.cfg.clip_pretrained,
                use_cuda=self.cfg.use_cuda,
            )
        except Exception as e:  # noqa: BLE001 -- sem CLIP, so nao identifica
            self._erro_clip = str(e)
            print(f"[rostos] CLIP indisponivel ({e}); sem identificar.")
        self.clip_ms += _ms(t0)

    def aquecer(self) -> None:
        """Sobe o CLIP numa thread (em paralelo com o YOLO e os quadros)."""
        if self.pasta is not None and self._engine is None and self._carregando is None:
            self._carregando = threading.Thread(target=self._carregar_clip, daemon=True)
            self._carregando.start()

    def engine(self) -> Any:
        if self._carregando is not None:
            self._carregando.join()
            self._carregando = None
        elif self._engine is None and self._erro_clip is None:
            self._carregar_clip()
        return self._engine

    # --- fotos e embeddings -------------------------------------------

    def _meta(self) -> dict:
        # A MESMA meta do Pipeline._feature_meta (anime): outra meta = cache vazio.
        from .matching.face_detector import MODEL_SIGNATURE

        c = self.cfg
        return {
            "clip": f"{c.clip_model}/{c.clip_pretrained}",
            "detector": MODEL_SIGNATURE,
            "pad": c.face_crop_padding,
            "credit_thr": c.credit_edge_threshold,
        }

    def _grupos_do_disco(self) -> dict[frozenset[str], dict]:
        """As pastas de personagem por pessoa: as grafias da mesma pessoa
        ("Ukyo Saionji" e "Saionji, Ukyou") ficam juntas."""
        if self._grupos is None:
            self._grupos = {}
            exts = {".jpg", ".jpeg", ".png", ".webp"}
            for d in sorted((self.pasta / "characters").iterdir()):
                if not d.is_dir():
                    continue
                fotos = [p for p in sorted(d.iterdir()) if p.suffix.lower() in exts]
                if fotos:
                    g = self._grupos.setdefault(_fichas(d.name), {"nome": d.name, "fotos": [], "matriz": None})
                    g["fotos"].extend(fotos)
        return self._grupos

    def _pessoa(self, nome: str) -> frozenset[str] | None:
        """A pessoa do elenco com este nome: mesmas palavras, ou UMA so que contem
        (ou esta contida) -- duas = ambiguo, ninguem."""
        f = _fichas(nome)
        grupos = self._grupos_do_disco()
        if f in grupos:
            return f
        achadas = [k for k in grupos if _mesma(f, k)]
        return achadas[0] if len(achadas) == 1 else None

    def _matriz(self, detector: _Detector, chave: frozenset[str]) -> np.ndarray | None:
        """Os prototipos da pessoa, como o pipeline monta o CharacterEntry."""
        from .matching.character_matcher import build_centroid, build_prototypes
        from .matching.feature_cache import FeatureCache

        g = self._grupos_do_disco()[chave]
        if g["matriz"] is not None:
            return g["matriz"] if g["matriz"].size else None
        g["matriz"] = np.zeros((0, 1), dtype=np.float32)
        # O minimo de fotos do reconhecimento (min_references_per_character).
        if len(g["fotos"]) < int(getattr(self.cfg, "min_references_per_character", 2)):
            return None
        if self._cache is None:
            self._cache = FeatureCache(self.pasta / "ref_features.npz", self._meta())
        embs: list[np.ndarray] = []
        faltam: list[Path] = []
        for p in g["fotos"]:
            e = self._cache.get(p, "embs")
            if e is None:
                faltam.append(p)
            elif e.size:
                embs.append(e.astype(np.float32))
        if faltam:
            embs.extend(self._embeddar(detector, faltam))
        if not embs:
            return None
        tudo = np.concatenate(embs, axis=0)
        centro = build_centroid(tudo)
        if centro is None:
            return None
        protos = None
        if getattr(self.cfg, "multi_prototype", True):
            protos = build_prototypes(
                tudo,
                merge_threshold=self.cfg.prototype_merge_threshold,
                max_prototypes=self.cfg.max_prototypes_per_character,
            )
        g["matriz"] = (protos if protos is not None and protos.size else centro[None, :]).astype(np.float32)
        return g["matriz"]

    def _embeddar(self, detector: _Detector, fotos: list[Path]) -> list[np.ndarray]:
        """Como o Pipeline._ref_features: rosto da foto (ou o retrato central) -> CLIP. Sem gravar."""
        import cv2

        from .matching.face_detector import crops_from_boxes, smart_portrait_crop

        engine = self.engine()
        if engine is None:
            return []
        imgs = [cv2.imdecode(np.fromfile(str(p), dtype=np.uint8), cv2.IMREAD_COLOR) for p in fotos]
        imgs = [im for im in imgs if im is not None and im.size]
        if not imgs:
            return []
        crops: list[np.ndarray] = []
        for im, achados in zip(imgs, detector.detectar(imgs)):
            caixas = [(r["x"], r["y"], r["w"], r["h"]) for r in achados if r["tipo"] == "rosto"]
            c, _ = crops_from_boxes(im, caixas, self.cfg.face_crop_padding)
            crops.extend(c or [smart_portrait_crop(im)])
        t0 = time.perf_counter()
        e = engine.embed_images(crops)
        self.clip_ms += _ms(t0)
        return [e.astype(np.float32)] if e.size else []

    # --- identificar ------------------------------------------------------

    def identificar(
        self,
        detector: _Detector,
        img: np.ndarray,
        rostos: list[dict],
        candidatos: list[str],
        citados: list[str],
    ) -> None:
        """Marca em cada rosto `quem` (o candidato mais parecido), `sim`,
        `pessoa` (a pasta do elenco, quando a identificacao passou) e
        `personagem` (o nome CITADO, como veio no pedido, que e essa pessoa).

        Conjunto FECHADO: so os candidatos. Cada rosto fica com a pessoa que
        mais parece com ele, com folga do 2o candidato; dois rostos querendo a
        mesma pessoa: fica o mais parecido, com folga do outro (19/10: antes o
        2o rosto contava mesmo sendo, com folga, de OUTRA pessoa -- a Misa
        grande "tirava" o Lent do rosto pequeno dele). Com uma pessoa so no
        conjunto, so acima de LIMIAR_SOZINHO."""
        from .matching.face_detector import crops_from_boxes

        pessoas = self.pessoas(detector, candidatos)
        if not pessoas:
            return
        engine = self.engine()
        if engine is None:
            return
        caixas = [(r["x"], r["y"], r["w"], r["h"]) for r in rostos]
        crops, _ = crops_from_boxes(img, caixas, self.cfg.face_crop_padding)
        if len(crops) != len(rostos):
            return  # caixa fora do quadro: sem o pareamento 1:1 nao da para marcar
        t0 = time.perf_counter()
        embs = engine.embed_images(crops)
        self.clip_ms += _ms(t0)
        if len(embs) != len(rostos):
            return
        # sims[i, j] = o melhor prototipo da pessoa j para o rosto i (o max do CharacterMatcher).
        sims = np.stack([(embs @ m.T).max(axis=1) for _, m in pessoas], axis=1)
        grupos = self._grupos_do_disco()
        citadas = [(c, _fichas(c)) for c in citados]
        for i, r in enumerate(rostos):
            j = int(np.argmax(sims[i]))
            r["quem"] = grupos[pessoas[j][0]]["nome"]
            r["sim"] = round(float(sims[i, j]), 3)
            if os.environ.get("ANIRECAP_ROSTOS_SIMS") == "1":
                r["sims"] = {grupos[k]["nome"]: round(float(sims[i, jj]), 3) for jj, (k, _) in enumerate(pessoas)}
        for i, j in enumerate(atribuir(sims)):
            if j is None:
                continue
            r = rostos[i]
            r["pessoa"] = grupos[pessoas[j][0]]["nome"]
            for nome, f in citadas:
                if _mesma(f, pessoas[j][0]):
                    r["personagem"] = nome
                    break

    def pessoas(self, detector: _Detector, candidatos: list[str]) -> list[tuple[frozenset[str], np.ndarray]]:
        """Os candidatos com foto no elenco (uma vez cada pessoa) e os prototipos dela."""
        saida: list[tuple[frozenset[str], np.ndarray]] = []
        for nome in candidatos:
            k = self._pessoa(nome)
            if k is None or any(k == p for p, _ in saida):
                continue
            m = self._matriz(detector, k)
            if m is not None:
                saida.append((k, m))
        return saida

    def janelas(
        self,
        detector: _Detector,
        img: np.ndarray,
        candidatos: list[str],
        citados: list[str],
        aspecto: float,
    ) -> list[dict]:
        """[19/10] O citado que nenhum detector ve (a fadinha de costas, em close,
        no MRM E02: so a orelha, o cabelo e o sorriso): o CLIP de JANELAS do
        tamanho do recorte 9:16, da esquerda para a direita, contra os
        candidatos. Por janela: {x, w, quem, sim, personagem}; `personagem` so
        quando o citado e o mais parecido da janela, acima de LIMIAR_JANELA e
        com MARGEM_JANELA do 2o. Medido no MRM E02: a janela da fadinha deu
        0,85 contra 0,80 da 2a pessoa; sem ela no quadro, nenhuma janela passa."""
        pessoas = self.pessoas(detector, candidatos)
        engine = self.engine()
        if len(pessoas) < 2 or engine is None:
            return []
        h, w = img.shape[:2]
        # A largura VISIVEL do recorte no quadro (a mesma conta do janelaDoFormato do host).
        jw = int(round(max(0.05, aspecto) * h))
        if jw >= w:
            return []
        xs = [int(round(f * (w - jw))) for f in POSICOES_DA_JANELA]
        t0 = time.perf_counter()
        embs = engine.embed_images([img[:, x:x + jw] for x in xs])
        self.clip_ms += _ms(t0)
        if len(embs) != len(xs):
            return []
        sims = np.stack([(embs @ m.T).max(axis=1) for _, m in pessoas], axis=1)
        grupos = self._grupos_do_disco()
        citadas = [(c, _fichas(c)) for c in citados]
        saida: list[dict] = []
        for i, (x, j) in enumerate(zip(xs, quem_na_janela(sims))):
            k = int(np.argmax(sims[i]))
            janela = {"x": x, "w": jw, "quem": grupos[pessoas[k][0]]["nome"], "sim": round(float(sims[i, k]), 3), "personagem": None}
            if j is not None:
                for nome, f in citadas:
                    if _mesma(f, pessoas[j][0]):
                        janela["personagem"] = nome
                        break
            saida.append(janela)
        return saida


# ------------------------------------------------------------------ o modo

def rodar(pedido: dict, emit: Emit, cancelado: Callable[[], bool]) -> int:
    from .config import Config

    t0 = time.perf_counter()
    cfg = Config.load()  # so leitura: nada de ensure_dirs()/save()
    itens = [i for i in (pedido.get("itens") or []) if isinstance(i, dict)]
    identificar = bool(pedido.get("identificar", True)) and any(i.get("candidatos") for i in itens)

    elenco = _Elenco(cfg, pedido.get("anime"), pedido.get("temporada")) if identificar else None
    if elenco is not None:
        elenco.aquecer()
    detector = _Detector(use_cuda=bool(getattr(cfg, "use_cuda", True)))
    # Aquece a GPU com um quadro preto: o 1o predict paga a subida do CUDA, e
    # o "pronto" mede isso junto (o host ve onde foi o tempo).
    detector.detectar([np.zeros((64, 64, 3), dtype=np.uint8)])
    emit(
        {
            "type": "pronto",
            "ms": _ms(t0),
            "gpu": detector.device == "cuda",
            "cabeca": detector.cabeca is not None,
            "elenco": str(elenco.pasta) if elenco and elenco.pasta else None,
            "semElenco": (elenco.motivo or None) if elenco else "nada a identificar",
        }
    )

    identificados = 0
    for inicio in range(0, len(itens), ITENS_POR_LOTE):
        if cancelado():
            emit({"type": "cancelled"})
            return 0
        bloco = itens[inicio:inicio + ITENS_POR_LOTE]
        lidos: list[tuple[dict, list[float], list[np.ndarray | None]]] = []
        for item in bloco:
            instantes = [float(t) for t in (item.get("instantes") or [])][:12]
            try:
                quadros = _ler_quadros(str(item.get("arquivo", "")), instantes)
            except Exception as e:  # noqa: BLE001 -- um arquivo ruim nao derruba o lote
                print(f"[rostos] {item.get('arquivo')}: {e}")
                quadros = [None for _ in instantes]
            lidos.append((item, instantes, quadros))

        imgs = [q for _, _, qs in lidos for q in qs if q is not None]
        # Cabeca tambem ao lado dos rostos so em item que cita alguem (o perfil do citado).
        cabecas = [bool(item.get("personagens")) for item, _, qs in lidos for q in qs if q is not None]
        achados = iter(detector.detectar(imgs, cabecas))
        for item, instantes, quadros in lidos:
            largura = altura = 0
            saida = []
            citados = [str(c) for c in (item.get("personagens") or []) if str(c).strip()]
            candidatos = [str(c) for c in (item.get("candidatos") or []) if str(c).strip()]
            pode = elenco is not None and elenco.pasta is not None and bool(candidatos)
            for t, img in zip(instantes, quadros):
                if img is None:
                    saida.append({"t": t, "ok": False, "rostos": []})
                    continue
                altura, largura = int(img.shape[0]), int(img.shape[1])
                rostos = next(achados)
                for r in rostos:
                    r.setdefault("personagem", None)
                    r.setdefault("pessoa", None)
                    r.setdefault("sim", None)
                    r.setdefault("quem", None)
                if pode and rostos:
                    try:
                        elenco.identificar(detector, img, rostos, candidatos, citados)
                        identificados += sum(1 for r in rostos if r["pessoa"])
                    except Exception as e:  # noqa: BLE001 -- identificar e melhoria
                        print(f"[rostos] identificar falhou: {e}")
                saida.append({"t": t, "ok": True, "rostos": rostos})
            # [19/10] O 1o citado sem rosto achado nos instantes: as janelas do recorte
            # (o host decide se a janela dele ganha do rosto de um citado depois dele).
            achou = any(r.get("personagem") == citados[0] for q in saida for r in q["rostos"]) if citados else True
            aspecto = item.get("aspecto") or pedido.get("aspecto")
            if pode and citados and not achou and isinstance(aspecto, (int, float)) and aspecto > 0:
                for q, img in zip(saida, [x for x in quadros]):
                    if not q["ok"] or img is None:
                        continue
                    try:
                        q["janelas"] = elenco.janelas(detector, img, candidatos, citados, float(aspecto))
                    except Exception as e:  # noqa: BLE001 -- janela e melhoria
                        print(f"[rostos] janelas falharam: {e}")
            emit(
                {
                    "type": "rostos",
                    "chave": item.get("chave"),
                    "largura": largura,
                    "altura": altura,
                    "quadros": saida,
                }
            )

    emit(
        {
            "type": "fim",
            "ms": _ms(t0),
            "itens": len(itens),
            "identificados": identificados,
            "clipMs": elenco.clip_ms if elenco else 0,
        }
    )
    return 0
