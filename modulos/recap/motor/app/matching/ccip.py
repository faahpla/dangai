"""CCIP: a segunda opinião sobre "esses dois desenhos são a mesma pessoa?".

O CLIP que o app usa pra reconhecer não foi treinado pra essa pergunta. Ele
aprendeu a casar imagem com TEXTO, e é usado aqui de lado: compara-se o
recorte do rosto com os recortes das fotos de referência. Funciona, mas
decide raspando — a margem média entre o primeiro e o segundo colocado é de
0,077, o que significa que muita decisão é quase empate.

O CCIP (deepghs) foi treinado exatamente pra isto: dadas duas imagens de
personagem de anime, elas são a MESMA pessoa? Ele publica a própria régua
junto com o modelo (`metrics.json`): F1 0,917 com corte em 0,1784. E é uma
DIFERENÇA, não uma similaridade — quanto menor, mais parecido.

Roda na CPU, offline, sem chave de API e sem custo por chamada. O preço é
espaço: ~150 MB de modelo, baixado uma vez.

**Não substitui o CLIP.** O CLIP decide; o CCIP é chamado só onde a decisão
do CLIP é apertada — que é onde ele erra. Trocar um pelo outro custaria o
que o CLIP faz bem (achar o candidato entre 80 personagens de uma vez) pra
ganhar o que ele faz mal (bater o martelo num quase-empate).
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

REPO = "deepghs/ccip_onnx"
MODELO = "ccip-caformer-24-randaug-pruned"

#: Corte publicado pelo próprio modelo (metrics.json: F1 0,917).
#: DIFERENÇA — abaixo disso é a mesma pessoa.
LIMIAR = 0.1784

_TAMANHO = 384
_MEDIA = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_DESVIO = np.array([0.229, 0.224, 0.225], dtype=np.float32)


class CcipEngine:
    """Carrega os dois ONNX sob demanda e responde por lotes."""

    def __init__(self, threads: int = 0) -> None:
        self._feat = None
        self._metrics = None
        self._threads = threads
        self._falhou = False

    # --- carga ---

    def _sessions(self):
        if self._feat is not None or self._falhou:
            return self._feat, self._metrics
        try:
            import onnxruntime as ort
            from huggingface_hub import hf_hub_download

            opts = ort.SessionOptions()
            if self._threads > 0:
                opts.intra_op_num_threads = self._threads
            caminhos = {
                nome: hf_hub_download(REPO, f"{MODELO}/{nome}")
                for nome in ("model_feat.onnx", "model_metrics.onnx")
            }
            self._feat = ort.InferenceSession(
                caminhos["model_feat.onnx"], opts,
                providers=["CPUExecutionProvider"],
            )
            self._metrics = ort.InferenceSession(
                caminhos["model_metrics.onnx"], opts,
                providers=["CPUExecutionProvider"],
            )
        except Exception as e:  # noqa: BLE001 — segunda opinião é opcional
            # Sem onnxruntime, sem rede na primeira vez, sem espaço: a análise
            # segue com o CLIP sozinho, que é como sempre funcionou.
            print(f"[CCIP] indisponível ({type(e).__name__}: {e}) — "
                  "seguindo só com o CLIP", flush=True)
            self._falhou = True
        return self._feat, self._metrics

    @property
    def disponivel(self) -> bool:
        feat, _ = self._sessions()
        return feat is not None

    # --- uso ---

    @staticmethod
    def _preparar(imagens: list[np.ndarray]) -> np.ndarray:
        """BGR do OpenCV → o tensor que o modelo espera (N,3,384,384)."""
        lote = np.empty((len(imagens), 3, _TAMANHO, _TAMANHO), dtype=np.float32)
        for i, img in enumerate(imagens):
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            rgb = cv2.resize(rgb, (_TAMANHO, _TAMANHO), interpolation=cv2.INTER_LINEAR)
            x = rgb.astype(np.float32) / 255.0
            x = (x - _MEDIA) / _DESVIO
            lote[i] = x.transpose(2, 0, 1)
        return lote

    def embed(self, imagens: list[np.ndarray], batch: int = 8) -> np.ndarray:
        """Vetores de identidade (N, 768). Lista vazia devolve (0, 768)."""
        feat, _ = self._sessions()
        if feat is None or not imagens:
            return np.zeros((0, 768), dtype=np.float32)
        partes = []
        for i in range(0, len(imagens), batch):
            fatia = imagens[i:i + batch]
            saida = feat.run(None, {"input": self._preparar(fatia)})[0]
            partes.append(np.asarray(saida, dtype=np.float32))
        return np.concatenate(partes, axis=0)

    def diferencas(self, a: np.ndarray, b: np.ndarray) -> np.ndarray:
        """Matriz (len(a), len(b)) de DIFERENÇAS. Menor = mais parecido.

        O modelo de métrica recebe um lote só e devolve todos contra todos;
        aqui os dois grupos são empilhados e o bloco que interessa é
        recortado. É assim que o próprio deepghs mede — a diferença não é um
        cosseno, é uma função aprendida junto com os vetores.
        """
        _, metrics = self._sessions()
        if metrics is None or a.size == 0 or b.size == 0:
            return np.zeros((len(a), len(b)), dtype=np.float32)
        junto = np.concatenate([a, b], axis=0).astype(np.float32)
        m = np.asarray(metrics.run(None, {"input": junto})[0], dtype=np.float32)
        return m[: len(a), len(a):]

    def mesma_pessoa(
        self, a: np.ndarray, b: np.ndarray, limiar: float = LIMIAR
    ) -> tuple[bool, float]:
        """(veredito, menor diferença) entre dois conjuntos de imagens.

        O MENOR: basta um par convincente. Um personagem tem refs em ângulos
        e trajes diferentes, e exigir que a cena pareça com a média delas
        seria pedir o que nem duas fotos do mesmo personagem cumprem.
        """
        d = self.diferencas(a, b)
        if d.size == 0:
            return False, 1.0
        menor = float(d.min())
        return menor <= limiar, menor


class CcipJuiz:
    """O CCIP aplicado à pergunta do app: "esta cena é mesmo do Fulano?".

    Guarda, por personagem, os vetores CCIP dos ROSTOS das fotos de
    referência — rosto contra rosto, o mesmo recorte dos dois lados. Comparar
    um recorte de rosto com um retrato de corpo inteiro colocaria enquadramento
    na conta, e enquadramento não é identidade.
    """

    def __init__(self, engine: CcipEngine, limiar: float = LIMIAR) -> None:
        self.engine = engine
        self.limiar = limiar
        self._por_personagem: dict[int, np.ndarray] = {}
        self.consultas = 0
        self.vetos = 0

    def registrar(self, character_id: int, rostos: list[np.ndarray]) -> None:
        """Guarda os rostos de referência de um personagem (BGR)."""
        if not rostos:
            return
        vetores = self.engine.embed(rostos)
        if vetores.size:
            self._por_personagem[character_id] = vetores

    def conhece(self, character_id: int) -> bool:
        return character_id in self._por_personagem

    def aprova(self, rostos_da_cena: np.ndarray, character_id: int) -> tuple[bool, float]:
        """Devolve (aprovado, menor diferença).

        Sem referência conhecida pro personagem, APROVA. O CCIP é veto, não
        juiz único: quando ele não tem o que comparar, quem decide continua
        sendo o CLIP — negar por falta de informação transformaria a ausência
        de dados em condenação.
        """
        refs = self._por_personagem.get(character_id)
        if refs is None or refs.size == 0 or rostos_da_cena.size == 0:
            return True, 0.0
        self.consultas += 1
        ok, dif = self.engine.mesma_pessoa(rostos_da_cena, refs, self.limiar)
        if not ok:
            self.vetos += 1
        return ok, dif


def ler_imagens(caminhos: list[Path], maximo: int = 0) -> list[np.ndarray]:
    """Carrega imagens de disco, pulando as que não abrem."""
    saida: list[np.ndarray] = []
    for p in caminhos:
        if maximo and len(saida) >= maximo:
            break
        img = cv2.imread(str(p))
        if img is not None:
            saida.append(img)
    return saida
