"""[recap] Modo ``cenas`` do headless: o que o passo 4 precisa VER das cenas.

Arquivo NOVO do modulo recap do Dangai (nao existe no ancut-hub-engine). Lote 2
das ideias do Levi (PLANO.md, C1/C2/C7):

- C2, busca pela imagem: o embedding CLIP de cada keyframe (o MESMO ViT-L/14
  "openai" do reconhecimento, cfg.clip_model, ja no cache de modelos) e o de
  cada `visualEn` (a intencao visual em ingles que o roteiro pede). O host faz
  o cosseno.
- C7, o melhor quadro (a ideia do PerfectFrameAI): a nota de BELEZA de cada
  keyframe pelo LAION aesthetic predictor v1 (uma camada linear 768 -> 1 sobre
  o embedding CLIP ViT-L/14 normalizado, MIT, pesos em
  assets/laion_estetica_l14.json) e a NITIDEZ pela variancia do Laplaciano
  (OpenCV). Por que o LAION e nao o NIMA do PerfectFrameAI: o NIMA e uma
  InceptionResNetV2 inteira (~200 MB, mais uma rede na GPU) para a mesma
  pergunta; o LAION reaproveita o embedding que o C2 ja calculou e custa um
  produto escalar por quadro.
- C1, busca por sentido: embeddings multilingues (multilingual-e5-small,
  MIT, ONNX quantizado ~118 MB, revisao fixa) da frase em PT e das falas da
  legenda (quase sempre EN). onnxruntime (CPU, ja no runtime) + tokenizers.

Uso:
    python -m app.headless cenas      (pedido JSON na 1a linha do stdin)

Pedido:
    {"saida": "<pasta>",
     "imagens": [{"id": "0026_1", "arquivo": "...jpg", "prioridade": 0|1}],
     "clipTextos": [{"id": "f01", "texto": "girl lying in bed"}],
     "sentido": [{"id": "c0001", "texto": "..."}],
     "soCpuPrioridade0": true}

    Sem GPU, `soCpuPrioridade0` pula as imagens de prioridade 1 (o keyframe do
    meio e o 0; os das pontas sao 1): o ViT-L/14 na CPU leva ~0,5 s por imagem.

Saida (na pasta `saida`; matrizes float32 little-endian, linha a linha):
    imagens.f32 (N x 768), imagens.json {"ids": [...], "estetica": [...], "nitidez": [...]}
    clip-textos.f32 (M x 768), clip-textos.json {"ids": [...]}
    sentido.f32 (K x 384), sentido.json {"ids": [...]}

Eventos (stdout, um JSON por linha):
    {"type": "pronto", "gpu": bool, "ms": ..}
    {"type": "progresso", "etapa": "imagens"|"textos"|"sentido", "feitas": n, "total": n}
    {"type": "fim", "ms": .., "imagens": n, "clipTextos": n, "sentido": n, "puladas": n, "tempos": {...}}
    erro: {"type": "failed", "message": "..."} (o main() do headless)

So LEITURA fora da pasta `saida`: os keyframes podem estar na biblioteca do
AnCut/Corte Cenas. Nada de Config.save() nem ensure_dirs().
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Callable

import numpy as np

#: O modelo de sentido: repo, revisao FIXA (o runtime nao muda por baixo) e arquivos.
SENTIDO_REPO = "Xenova/multilingual-e5-small"
SENTIDO_REVISAO = "761b726dd34fb83930e26aab4e9ac3899aa1fa78"
SENTIDO_MODELO = "onnx/model_quantized.onnx"
SENTIDO_TOKENIZER = "tokenizer.json"
#: Teto de tokens por texto (fala de legenda e frase do roteiro cabem folgadas).
SENTIDO_MAX_TOKENS = 128
#: Lado em que o quadro e reduzido antes do Laplaciano: a nitidez compara quadros do MESMO episodio.
NITIDEZ_LARGURA = 640
LOTE_CLIP = 32
LOTE_SENTIDO = 32


def _gravar_matriz(pasta: Path, nome: str, ids: list[str], m: np.ndarray, extra: dict[str, Any] | None = None) -> None:
    m = np.ascontiguousarray(m, dtype="<f4")
    (pasta / f"{nome}.f32").write_bytes(m.tobytes())
    meta = {"ids": ids, "dim": int(m.shape[1]) if m.ndim == 2 and m.shape[0] else 0}
    if extra:
        meta.update(extra)
    (pasta / f"{nome}.json").write_text(json.dumps(meta), encoding="utf-8")


def _estetica() -> tuple[np.ndarray, float]:
    cru = json.loads((Path(__file__).parent / "assets" / "laion_estetica_l14.json").read_text(encoding="utf-8"))
    return np.asarray(cru["peso"], dtype=np.float32), float(cru["vies"])


def _nitidez(arquivo: str) -> float | None:
    """Variancia do Laplaciano do quadro reduzido (log depois, no host). None = nao abriu."""
    try:
        import cv2

        img = cv2.imread(arquivo, cv2.IMREAD_GRAYSCALE)
        if img is None:
            return None
        h, w = img.shape[:2]
        if w > NITIDEZ_LARGURA:
            img = cv2.resize(img, (NITIDEZ_LARGURA, max(1, round(h * NITIDEZ_LARGURA / w))), interpolation=cv2.INTER_AREA)
        return float(cv2.Laplacian(img, cv2.CV_64F).var())
    except Exception:  # noqa: BLE001 -- quadro torto nao derruba o lote
        return None


class _Sentido:
    """multilingual-e5-small em ONNX: "query: " + texto, media pelos tokens, L2."""

    def __init__(self) -> None:
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download
        from tokenizers import Tokenizer

        modelo = hf_hub_download(SENTIDO_REPO, SENTIDO_MODELO, revision=SENTIDO_REVISAO)
        tok = hf_hub_download(SENTIDO_REPO, SENTIDO_TOKENIZER, revision=SENTIDO_REVISAO)
        self.tok = Tokenizer.from_file(tok)
        self.tok.enable_truncation(SENTIDO_MAX_TOKENS)
        self.tok.enable_padding(pad_id=self.tok.token_to_id("<pad>") or 1, pad_token="<pad>")
        self.sessao = ort.InferenceSession(modelo, providers=["CPUExecutionProvider"])
        self.entradas = {i.name for i in self.sessao.get_inputs()}

    def __call__(self, textos: list[str]) -> np.ndarray:
        enc = self.tok.encode_batch([f"query: {t}" for t in textos])
        ids = np.asarray([e.ids for e in enc], dtype=np.int64)
        mask = np.asarray([e.attention_mask for e in enc], dtype=np.int64)
        feed: dict[str, np.ndarray] = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in self.entradas:
            feed["token_type_ids"] = np.zeros_like(ids)
        h = self.sessao.run(None, feed)[0]
        m = mask[..., None].astype(np.float32)
        v = (h * m).sum(axis=1) / np.clip(m.sum(axis=1), 1e-6, None)
        return (v / np.clip(np.linalg.norm(v, axis=1, keepdims=True), 1e-8, None)).astype(np.float32)


def rodar(req: dict[str, Any], emitir: Callable[[dict[str, Any]], None], cancelado: Callable[[], bool]) -> int:
    t0 = time.time()
    saida = Path(str(req["saida"]))
    saida.mkdir(parents=True, exist_ok=True)
    imagens = [i for i in req.get("imagens") or [] if isinstance(i, dict) and i.get("id") and i.get("arquivo")]
    clip_textos = [t for t in req.get("clipTextos") or [] if isinstance(t, dict) and t.get("id") and str(t.get("texto", "")).strip()]
    sentido = [t for t in req.get("sentido") or [] if isinstance(t, dict) and t.get("id") and str(t.get("texto", "")).strip()]
    tempos: dict[str, int] = {}

    gpu = False
    engine = None
    if imagens or clip_textos:
        import torch

        from .config import Config
        from .matching.embedding_engine import EmbeddingEngine

        cfg = Config.load()
        engine = EmbeddingEngine(
            model_name=cfg.clip_model,
            pretrained=cfg.clip_pretrained,
            use_cuda=bool(getattr(cfg, "use_cuda", True)) and torch.cuda.is_available(),
        )
        gpu = engine.device.type == "cuda"
    emitir({"type": "pronto", "gpu": gpu, "ms": int((time.time() - t0) * 1000)})

    puladas = 0
    if imagens and engine is not None:
        t = time.time()
        if not gpu and req.get("soCpuPrioridade0"):
            antes = len(imagens)
            imagens = [i for i in imagens if int(i.get("prioridade", 0)) == 0]
            puladas = antes - len(imagens)
        peso, vies = _estetica()
        ids: list[str] = []
        vetores: list[np.ndarray] = []
        estetica: list[float] = []
        nitidez: list[float | None] = []
        for k in range(0, len(imagens), LOTE_CLIP):
            if cancelado():
                return 1
            lote = imagens[k : k + LOTE_CLIP]
            # embed_images pula o que nao abre: um por um no lote, para nao perder o alinhamento dos ids.
            from PIL import Image

            abertos: list[tuple[dict[str, Any], Any]] = []
            for item in lote:
                try:
                    abertos.append((item, Image.open(str(item["arquivo"])).convert("RGB")))
                except Exception:  # noqa: BLE001 -- keyframe sumido fica de fora
                    puladas += 1
            if abertos:
                m = engine.embed_images([img for _, img in abertos])
                for (item, _), v in zip(abertos, m):
                    ids.append(str(item["id"]))
                    vetores.append(v)
                    estetica.append(round(float(v @ peso + vies), 4))
                    nitidez.append(_nitidez(str(item["arquivo"])))
            emitir({"type": "progresso", "etapa": "imagens", "feitas": min(k + LOTE_CLIP, len(imagens)), "total": len(imagens)})
        dim = int(vetores[0].shape[0]) if vetores else 768
        _gravar_matriz(
            saida,
            "imagens",
            ids,
            np.stack(vetores) if vetores else np.zeros((0, dim), np.float32),
            {"estetica": estetica, "nitidez": [None if n is None else round(n, 2) for n in nitidez]},
        )
        tempos["imagens"] = int((time.time() - t) * 1000)

    if clip_textos and engine is not None:
        t = time.time()
        vs = [engine.embed_texts([str(x["texto"])[:300] for x in clip_textos[k : k + LOTE_CLIP]]) for k in range(0, len(clip_textos), LOTE_CLIP)]
        _gravar_matriz(saida, "clip-textos", [str(x["id"]) for x in clip_textos], np.concatenate(vs))
        emitir({"type": "progresso", "etapa": "textos", "feitas": len(clip_textos), "total": len(clip_textos)})
        tempos["clipTextos"] = int((time.time() - t) * 1000)

    if sentido:
        t = time.time()
        modelo = _Sentido()
        tempos["sentidoCarregar"] = int((time.time() - t) * 1000)
        vs = []
        for k in range(0, len(sentido), LOTE_SENTIDO):
            if cancelado():
                return 1
            vs.append(modelo([str(x["texto"]) for x in sentido[k : k + LOTE_SENTIDO]]))
            emitir({"type": "progresso", "etapa": "sentido", "feitas": min(k + LOTE_SENTIDO, len(sentido)), "total": len(sentido)})
        _gravar_matriz(saida, "sentido", [str(x["id"]) for x in sentido], np.concatenate(vs), {"modelo": f"{SENTIDO_REPO}@{SENTIDO_REVISAO[:8]}"})
        tempos["sentido"] = int((time.time() - t) * 1000)

    emitir(
        {
            "type": "fim",
            "ms": int((time.time() - t0) * 1000),
            "imagens": len(imagens) - (puladas if imagens else 0),
            "clipTextos": len(clip_textos),
            "sentido": len(sentido),
            "puladas": puladas,
            "gpu": gpu,
            "tempos": tempos,
        }
    )
    return 0
