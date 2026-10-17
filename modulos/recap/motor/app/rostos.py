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
     "identificar": true}

    `personagens`: quem a frase cita, em ordem de preferencia.
    `candidatos`: quem o INDICE reconhece no plano. Identificar e escolher
    ENTRE eles (conjunto fechado, 2-3 pessoas), nao entre o elenco inteiro --
    medido no S4-37: contra o elenco inteiro o CLIP trocava o Gen pelo Gozan e
    marcava figurante de fundo como Chrome com sim maior que o proprio Chrome.
    Vazio = nao identifica (o host so manda quando um citado esta no plano).

Eventos (stdout, um JSON por linha):
    {"type": "pronto", "ms": .., "gpu": bool, "cabeca": bool, "elenco": "<pasta>"|null, "semElenco": ..}
    {"type": "rostos", "chave": "...", "largura": 1920, "altura": 1080,
     "quadros": [{"t": 1.2, "ok": true, "rostos": [
         {"x": .., "y": .., "w": .., "h": .., "conf": .., "tipo": "rosto"|"cabeca",
          "personagem": "Yuzuriha"|null, "sim": 0.95|null, "quem": "Ogawa, Yuzuriha"|null}]}]}
    {"type": "fim", "ms": .., "itens": N, "identificados": n, "clipMs": ..}
    erro: {"type": "failed", "message": "..."} (o main() do headless)

So LEITURA: o elenco (anime_db, ref_features.npz) e os mp4 sao so lidos --
nada de FeatureCache.save(), Config.save() nem ensure_dirs(). A pasta de dados
e a do Studio (ANIRECAP_MOTOR_DADOS), e as bibliotecas do AnCut/Corte Cenas
podem ser a origem dos mp4.

Identificar so roda quando vale a pena: o item tem candidatos, e o quadro tem
2+ rostos. O CLIP (ViT-L/14, ~1 GB) sobe numa thread JA no comeco quando algum
item tem candidatos, em paralelo com o YOLO e a leitura dos quadros.
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
#: destes 2-3 rostos e ele", nao "quem esta na cena")...
LIMIAR_ID = 0.70
#: ...com folga sobre o 2o candidato para o MESMO rosto...
MARGEM_ID = 0.02
#: ...e sobre o 2o rosto para o MESMO candidato (dois rostos quase iguais = nao sei).
MARGEM_ENTRE_ROSTOS = 0.02


def _ms(desde: float) -> int:
    return int(round((time.perf_counter() - desde) * 1000))


# ------------------------------------------------------------------ modelos

def _modelo_local(repo: str, arquivo: str) -> Path:
    """O peso do HuggingFace: cache local primeiro (sem rede), depois a rede.

    A rede do Levi as vezes nao responde; com o cache cheio (o motor ja baixou
    na 1a analise) nao ha por que perguntar nada ao Hub."""
    from huggingface_hub import hf_hub_download

    try:
        return Path(hf_hub_download(repo_id=repo, filename=arquivo, local_files_only=True))
    except Exception:
        return Path(hf_hub_download(repo_id=repo, filename=arquivo))


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

    def detectar(self, imgs: list[np.ndarray]) -> list[list[dict]]:
        """Por imagem: [{x,y,w,h,conf,tipo}], rosto primeiro; cabeca so onde
        nao achou rosto (a cascata do motor)."""
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
        faltam = [i for i, r in enumerate(saida) if not r]
        if faltam and self.cabeca is not None:
            for i, caixas in zip(faltam, self._prever(self.cabeca, [imgs[i] for i in faltam])):
                saida[i] = filtrar(imgs[i], caixas, "cabeca")
        return saida


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
        """Marca em cada rosto `quem` (o candidato do indice que ele e), `sim`
        e `personagem` (o nome CITADO, como veio no pedido, que e essa pessoa).

        Conjunto FECHADO: so os candidatos (quem o indice reconhece no plano).
        Cada candidato fica com no maximo um rosto por quadro (o mais parecido),
        e so quando ganha com folga do 2o candidato e do 2o rosto."""
        from .matching.face_detector import crops_from_boxes

        pessoas: list[tuple[frozenset[str], np.ndarray]] = []
        for nome in candidatos:
            k = self._pessoa(nome)
            if k is None or any(k == p for p, _ in pessoas):
                continue
            m = self._matriz(detector, k)
            if m is not None:
                pessoas.append((k, m))
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
            s1 = float(sims[i, j])
            s2 = float(np.max(np.delete(sims[i], j))) if sims.shape[1] > 1 else -1.0
            outro_rosto = float(np.max(np.delete(sims[:, j], i))) if sims.shape[0] > 1 else -1.0
            r["quem"] = grupos[pessoas[j][0]]["nome"]
            r["sim"] = round(s1, 3)
            if s1 < LIMIAR_ID or s1 - s2 < MARGEM_ID or s1 - outro_rosto < MARGEM_ENTRE_ROSTOS:
                continue
            for nome, f in citadas:
                if _mesma(f, pessoas[j][0]):
                    r["personagem"] = nome
                    break


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
        achados = iter(detector.detectar(imgs))
        for item, instantes, quadros in lidos:
            largura = altura = 0
            saida = []
            citados = [str(c) for c in (item.get("personagens") or []) if str(c).strip()]
            candidatos = [str(c) for c in (item.get("candidatos") or []) if str(c).strip()]
            for t, img in zip(instantes, quadros):
                if img is None:
                    saida.append({"t": t, "ok": False, "rostos": []})
                    continue
                altura, largura = int(img.shape[0]), int(img.shape[1])
                rostos = next(achados)
                for r in rostos:
                    r.setdefault("personagem", None)
                    r.setdefault("sim", None)
                    r.setdefault("quem", None)
                if elenco is not None and elenco.pasta is not None and candidatos and citados and len(rostos) >= 2:
                    try:
                        elenco.identificar(detector, img, rostos, candidatos, citados)
                        identificados += sum(1 for r in rostos if r["personagem"])
                    except Exception as e:  # noqa: BLE001 -- identificar e melhoria
                        print(f"[rostos] identificar falhou: {e}")
                saida.append({"t": t, "ok": True, "rostos": rostos})
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
