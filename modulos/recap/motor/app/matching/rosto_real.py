"""Reconhecimento de rosto HUMANO — o backend de live action.

O motor nasceu pra anime, e as duas peças que decidem identidade são as duas
que não atravessam: o detector é um YOLO treinado em rosto de desenho, e a
identidade sai do CLIP comparando recortes — que funciona, mas decide
raspando (a margem média entre 1º e 2º é 0,077; ver `ccip.py`).

Em pessoa real o problema é o contrário: é o caso FÁCIL. Aqui entram os dois
modelos do `buffalo_l` (insightface, repacotados pelo Immich em ONNX):

- **SCRFD** detecta e ainda devolve 5 pontos do rosto (olhos, nariz, cantos
  da boca).
- **ArcFace** foi treinado exatamente pra "estas duas fotos são a mesma
  pessoa?", e devolve 512 números cuja distância É a resposta.

## Sem dependência nova

Rodam pelo `onnxruntime`, que já vai no pacote por causa do CCIP. Nada de
`insightface` via pip — o pacote arrasta scikit-image, albumentations e um
compilador, e cada um deles é uma chance nova de o PyInstaller quebrar.

Os pesos (191 MB) são **baixados na primeira vez**, como o CLIP e o CCIP já
são. Empacotá-los estouraria o limite de 2 GiB de anexo do GitHub, do qual o
instalador já usa 1,975.

## Alinhar antes de reconhecer

O ArcFace espera o rosto ENQUADRADO: olhos numa altura conhecida, boca em
outra. Os 5 pontos do SCRFD servem exatamente pra isso — uma transformação de
semelhança leva o rosto pro gabarito de 112x112 que ele foi treinado a ver.
Jogar o recorte cru nele custa acerto de graça, e é o erro clássico de quem
monta esse par pela primeira vez.

Por isso `crop_faces_batch` devolve o rosto JÁ ALINHADO: é ele que vira
embedding. A caixa original continua saindo junto, e é dela que a tela tira o
recorte que a pessoa vê.
"""

from __future__ import annotations

import cv2
import numpy as np

REPO = "immich-app/buffalo_l"
ARQ_DETECTOR = "detection/model.onnx"
ARQ_IDENTIDADE = "recognition/model.onnx"

#: Assinatura do backend. Entra na chave do cache de features — embedding de
#: ArcFace e de CLIP não podem se misturar no mesmo `.npz`.
ASSINATURA = "buffalo_l/scrfd10g+arcface-r50"

#: Corte do agrupamento do Modo Descoberta, para ESTE backend.
#:
#: O 0,86 do anime não vale aqui: ele foi calibrado pro CLIP, e no ArcFace a
#: mesma pessoa fica entre 0,48 e 0,82 — nada nunca fundiria. Medido no LFW
#: (8 pessoas x 3 fotos): de 0,25 a 0,40 o agrupamento acerta em cheio (8
#: grupos, 8 puros, 24/24 rostos); de 0,45 pra cima começa a deixar rosto de
#: fora; em 0,86 dá ZERO grupo.
#:
#: Fica na ponta rígida da faixa boa de propósito: juntar duas pessoas num
#: grupo só é pior que partir uma em dois — o segundo caso a tela de batismo
#: conserta dando o mesmo nome aos dois.
CORTE_AGRUPAMENTO = 0.40

#: Lado da entrada do detector. 640 é o que casa com as saídas do modelo
#: (12800 = 80x80x2 âncoras no stride 8).
_ENTRADA = 640
_STRIDES = (8, 16, 32)
_ANCORAS = 2

#: Onde os 5 pontos têm que cair num recorte 112x112. É o gabarito do
#: ArcFace — não é escolha nossa, é o que ele viu no treino.
_GABARITO = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float32,
)


def _distancia_para_caixa(centros: np.ndarray, dist: np.ndarray) -> np.ndarray:
    """SCRFD prevê DISTÂNCIAS do centro da âncora até os quatro lados."""
    x1 = centros[:, 0] - dist[:, 0]
    y1 = centros[:, 1] - dist[:, 1]
    x2 = centros[:, 0] + dist[:, 2]
    y2 = centros[:, 1] + dist[:, 3]
    return np.stack([x1, y1, x2, y2], axis=-1)


def _distancia_para_pontos(centros: np.ndarray, dist: np.ndarray) -> np.ndarray:
    saida = []
    for i in range(0, dist.shape[1], 2):
        saida.append(centros[:, 0] + dist[:, i])
        saida.append(centros[:, 1] + dist[:, i + 1])
    return np.stack(saida, axis=-1)


def _nms(caixas: np.ndarray, scores: np.ndarray, limiar: float = 0.4) -> list[int]:
    """Supressão de não-máximos, à mão.

    `cv2.dnn.NMSBoxes` faria o mesmo, mas ele muda de assinatura entre versões
    do OpenCV (às vezes devolve (N,1), às vezes (N,)) e isso já quebrou build
    empacotado antes. Vinte linhas de numpy não têm versão.
    """
    x1, y1, x2, y2 = caixas[:, 0], caixas[:, 1], caixas[:, 2], caixas[:, 3]
    areas = (x2 - x1 + 1) * (y2 - y1 + 1)
    ordem = scores.argsort()[::-1]
    fica: list[int] = []
    while ordem.size > 0:
        i = ordem[0]
        fica.append(int(i))
        xx1 = np.maximum(x1[i], x1[ordem[1:]])
        yy1 = np.maximum(y1[i], y1[ordem[1:]])
        xx2 = np.minimum(x2[i], x2[ordem[1:]])
        yy2 = np.minimum(y2[i], y2[ordem[1:]])
        inter = np.maximum(0.0, xx2 - xx1 + 1) * np.maximum(0.0, yy2 - yy1 + 1)
        iou = inter / (areas[i] + areas[ordem[1:]] - inter)
        ordem = ordem[1:][iou <= limiar]
    return fica


def alinhar(imagem: np.ndarray, pontos: np.ndarray) -> np.ndarray:
    """Leva o rosto pro gabarito 112x112 do ArcFace."""
    M, _ = cv2.estimateAffinePartial2D(
        pontos.reshape(5, 2).astype(np.float32), _GABARITO, method=cv2.LMEDS
    )
    if M is None:
        # Sem transformação possível (pontos degenerados): resta o recorte
        # cru redimensionado. Reconhece pior, mas não perde o rosto.
        return cv2.resize(imagem, (112, 112))
    return cv2.warpAffine(imagem, M, (112, 112), borderValue=0.0)


class DetectorRostoReal:
    """SCRFD com a MESMA cara do `AnimeFaceDetector`.

    Os nomes e as assinaturas são de propósito idênticos: o pipeline chama
    `crop_faces_batch` e `detect_batch` sem saber qual dos dois está do outro
    lado. Trocar o backend não podia significar mexer no pipeline.
    """

    def __init__(self, conf: float = 0.5, use_cuda: bool = False) -> None:
        self.conf = conf
        self._use_cuda = use_cuda
        self._sessao = None
        self._falhou = False
        #: Pontos da última detecção, por imagem. `crop_faces_batch` os
        #: consome logo em seguida — é o que permite alinhar sem mudar a
        #: assinatura que o pipeline conhece.
        self._pontos: list[np.ndarray] = []

    def _sessions(self):
        if self._sessao is not None or self._falhou:
            return self._sessao
        try:
            import onnxruntime as ort
            from huggingface_hub import hf_hub_download

            caminho = hf_hub_download(REPO, ARQ_DETECTOR)
            self._sessao = ort.InferenceSession(
                caminho, providers=_provedores(self._use_cuda)
            )
        except Exception as e:  # noqa: BLE001
            print(f"[RostoReal] detector indisponível ({type(e).__name__}: {e})",
                  flush=True)
            self._falhou = True
        return self._sessao

    # --- detecção ---

    def _uma(self, img: np.ndarray) -> tuple[list[tuple[int, int, int, int]], np.ndarray]:
        s = self._sessions()
        if s is None or img is None or img.size == 0:
            return [], np.zeros((0, 5, 2), dtype=np.float32)

        alt, larg = img.shape[:2]
        escala = _ENTRADA / max(alt, larg)
        red = cv2.resize(img, (int(round(larg * escala)), int(round(alt * escala))))
        tela = np.zeros((_ENTRADA, _ENTRADA, 3), dtype=np.uint8)
        tela[: red.shape[0], : red.shape[1]] = red

        blob = cv2.dnn.blobFromImage(
            tela, 1.0 / 128, (_ENTRADA, _ENTRADA), (127.5, 127.5, 127.5), swapRB=True
        )
        saidas = s.run(None, {s.get_inputs()[0].name: blob})

        caixas, scores, pontos = [], [], []
        for i, stride in enumerate(_STRIDES):
            sc = saidas[i].reshape(-1)
            bb = saidas[i + 3].reshape(-1, 4) * stride
            kp = saidas[i + 6].reshape(-1, 10) * stride
            lado = _ENTRADA // stride
            centros = np.stack(np.mgrid[:lado, :lado][::-1], axis=-1).astype(np.float32)
            centros = (centros * stride).reshape(-1, 2)
            if _ANCORAS > 1:
                centros = np.stack([centros] * _ANCORAS, axis=1).reshape(-1, 2)
            aceitos = np.where(sc >= self.conf)[0]
            if aceitos.size == 0:
                continue
            caixas.append(_distancia_para_caixa(centros[aceitos], bb[aceitos]))
            pontos.append(_distancia_para_pontos(centros[aceitos], kp[aceitos]))
            scores.append(sc[aceitos])

        if not caixas:
            return [], np.zeros((0, 5, 2), dtype=np.float32)

        caixas = np.concatenate(caixas) / escala
        pontos = np.concatenate(pontos).reshape(-1, 5, 2) / escala
        scores = np.concatenate(scores)
        fica = _nms(caixas, scores)

        saida_caixas: list[tuple[int, int, int, int]] = []
        for i in fica:
            x1, y1, x2, y2 = caixas[i]
            x1 = max(0, int(round(x1)))
            y1 = max(0, int(round(y1)))
            x2 = min(larg, int(round(x2)))
            y2 = min(alt, int(round(y2)))
            if x2 > x1 and y2 > y1:
                saida_caixas.append((x1, y1, x2 - x1, y2 - y1))
        return saida_caixas, pontos[fica]

    def detect(
        self, image_bgr: np.ndarray, min_size: int = 32, max_ratio: float = 0.75
    ) -> list[tuple[int, int, int, int]]:
        return self.detect_batch([image_bgr], min_size=min_size, max_ratio=max_ratio)[0]

    def detect_batch(
        self, images: list[np.ndarray], min_size: int = 32, max_ratio: float = 0.75
    ) -> list[list[tuple[int, int, int, int]]]:
        """Uma imagem por vez: o ONNX do SCRFD tem lote fixo em 1.

        Não é o gargalo — ele leva ~40 ms por quadro na CPU, contra os
        segundos que o corte e o CLIP custam.
        """
        saida: list[list[tuple[int, int, int, int]]] = []
        self._pontos = []
        for img in images:
            caixas, pts = self._uma(img)
            # `min_size`/`max_ratio` existem no detector de anime pra jogar
            # fora ruído; aqui o SCRFD já pontua, e o filtro fica só no
            # tamanho — rosto minúsculo não tem pixel pra reconhecer.
            filtradas, mantidos = [], []
            for j, (x, y, w, h) in enumerate(caixas):
                if min(w, h) >= min_size:
                    filtradas.append((x, y, w, h))
                    mantidos.append(j)
            saida.append(filtradas)
            self._pontos.append(pts[mantidos] if len(pts) else pts)
        return saida

    # --- recortes ---

    def crop_faces(self, image_bgr: np.ndarray, pad: float = 0.25) -> list[np.ndarray]:
        return self.crop_faces_batch([image_bgr], pad)[0][0]

    def crop_faces_batch(
        self, images: list[np.ndarray], pad: float = 0.25
    ) -> list[tuple[list[np.ndarray], list[tuple[int, int, int, int]]]]:
        """Por imagem: (rostos ALINHADOS 112x112, caixas originais).

        O `pad` do detector de anime não vale aqui: o alinhamento define o
        enquadramento sozinho, e é justamente isso que o ArcFace espera.
        """
        todas = self.detect_batch(images)
        saida = []
        for img, caixas, pts in zip(images, todas, self._pontos):
            if img is None or img.size == 0 or not caixas:
                saida.append(([], []))
                continue
            recortes = [alinhar(img, pts[i]) for i in range(len(caixas))]
            saida.append((recortes, caixas))
        return saida


class IdentidadeRostoReal:
    """ArcFace com a mesma cara do `EmbeddingEngine`."""

    def __init__(self, use_cuda: bool = False) -> None:
        self._use_cuda = use_cuda
        self._sessao = None
        self._falhou = False
        self.on_device_fallback = ""

    def _sessions(self):
        if self._sessao is not None or self._falhou:
            return self._sessao
        try:
            import onnxruntime as ort
            from huggingface_hub import hf_hub_download

            caminho = hf_hub_download(REPO, ARQ_IDENTIDADE)
            self._sessao = ort.InferenceSession(
                caminho, providers=_provedores(self._use_cuda)
            )
        except Exception as e:  # noqa: BLE001
            print(f"[RostoReal] identidade indisponível ({type(e).__name__}: {e})",
                  flush=True)
            self._falhou = True
        return self._sessao

    def embed_images(self, images: list) -> np.ndarray:
        s = self._sessions()
        if s is None or not images:
            return np.zeros((0, 512), dtype=np.float32)

        lote = []
        for img in images:
            arr = _para_bgr(img)
            if arr is None:
                continue
            if arr.shape[:2] != (112, 112):
                arr = cv2.resize(arr, (112, 112))
            lote.append(arr)
        if not lote:
            return np.zeros((0, 512), dtype=np.float32)

        blob = cv2.dnn.blobFromImages(
            np.array(lote), 1.0 / 127.5, (112, 112), (127.5, 127.5, 127.5), swapRB=True
        )
        vet = s.run(None, {s.get_inputs()[0].name: blob})[0].astype(np.float32)
        # L2 — o resto do app compara por produto escalar e assume norma 1.
        normas = np.linalg.norm(vet, axis=1, keepdims=True)
        return vet / np.clip(normas, 1e-8, None)


def _provedores(use_cuda: bool) -> list[str]:
    """CUDA quando houver, CPU sempre como rede.

    O `onnxruntime` do pacote é o de CPU; se um dia entrar o de GPU, isto já
    o usa sem mudar nada. Pedir um provedor que não existe é erro fatal, daí
    a checagem em vez da lista fixa.
    """
    if not use_cuda:
        return ["CPUExecutionProvider"]
    try:
        import onnxruntime as ort

        if "CUDAExecutionProvider" in ort.get_available_providers():
            return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    except Exception:  # noqa: BLE001
        pass
    return ["CPUExecutionProvider"]


def _para_bgr(img) -> np.ndarray | None:
    """Aceita o mesmo que o `EmbeddingEngine`: array, caminho ou PIL."""
    if isinstance(img, np.ndarray):
        return img if img.ndim == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    try:
        from pathlib import Path

        if isinstance(img, (str, Path)):
            return cv2.imread(str(img))
        # PIL: vira RGB; o blob é montado com swapRB, então volta pra BGR.
        return cv2.cvtColor(np.array(img.convert("RGB")), cv2.COLOR_RGB2BGR)
    except Exception:  # noqa: BLE001
        return None
