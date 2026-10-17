"""Agrupamento não-supervisionado de rostos — o motor do Modo Descoberta.

Quando não há banco de referências (anime novo demais, sem fotos nas APIs,
ou nem catalogado), os rostos do episódio são agrupados ENTRE SI por
similaridade de cosseno: cada grupo vira um "personagem sem nome" que o
usuário batiza depois. É a mesma família de técnica do álbum "Pessoas" do
Google Fotos, aplicada a anime com os embeddings CLIP que o pipeline já
extrai de qualquer forma.

Algoritmo: greedy online (cada rosto entra no cluster de centroide mais
próximo, ou abre um novo) + passadas de fusão de clusters até estabilizar.
O(N·K) com N ≈ 300-900 crops/episódio — milissegundos em numpy.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class FaceObservation:
    """Um rosto detectado num keyframe, pronto pra agrupar."""
    shot_pos: int          # índice do shot em per_shot_names/cut_results
    shot_id: int           # id do shot no DB
    shot_idx: int          # número do shot (0001, 0002...)
    embedding: np.ndarray  # L2-normalizado, shape (d,)
    crop_jpg: bytes        # crop já comprimido (pra UI de batismo e refs)


@dataclass
class FaceCluster:
    members: list[int] = field(default_factory=list)  # índices em observations
    centroid: np.ndarray | None = None

    def shot_positions(self, obs: list[FaceObservation]) -> set[int]:
        return {obs[i].shot_pos for i in self.members}


def _renormalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v if n < 1e-8 else v / n


def cluster_faces(
    observations: list[FaceObservation],
    cut: float = 0.86,
    min_size: int = 5,
) -> list[FaceCluster]:
    """Agrupa observações por identidade via AVERAGE-LINKAGE aglomerativo:
    a cada passo funde o par de clusters com maior similaridade MÉDIA entre
    todos os seus membros, parando quando nenhum par atinge `cut`.

    Por que average-linkage: um greedy por centroide encadeia — no teste com
    episódio real (1151 rostos), um blob engoliu 90% de tudo, porque o
    estilo do anime deixa personagens diferentes com sim 0.82+ no CLIP e o
    centroide vai derivando. A média-entre-membros resiste: validado
    visualmente com cut=0.86 (clusters puros; o erro residual é o MESMO
    personagem dividido em 2 grupos, que a tela de batismo resolve pelo
    nome igual).

    Implementação Lance-Williams vetorizada: a linha de similaridades do
    cluster fundido é a média ponderada das linhas dos dois pais. O(N²) de
    memória, ~2s para 1200 rostos.

    Retorna clusters com >= min_size rostos, maiores primeiro.
    """
    if not observations:
        return []

    embs = np.stack([o.embedding for o in observations]).astype(np.float32)
    n = len(observations)
    sim = embs @ embs.T                       # média par-a-par (Lance-Williams)
    np.fill_diagonal(sim, -np.inf)
    sizes = np.ones(n, dtype=np.float64)
    members: list[list[int] | None] = [[i] for i in range(n)]

    while True:
        flat = int(np.argmax(sim))
        a, b = divmod(flat, n)
        if sim[a, b] < cut:
            break
        if b < a:
            a, b = b, a
        # média ponderada das linhas: avg(A∪B, C) = (|A|·avg(A,C) + |B|·avg(B,C)) / (|A|+|B|)
        new_row = (sizes[a] * sim[a] + sizes[b] * sim[b]) / (sizes[a] + sizes[b])
        sim[a, :] = new_row
        sim[:, a] = new_row
        sim[a, a] = -np.inf
        sim[b, :] = -np.inf
        sim[:, b] = -np.inf
        sizes[a] += sizes[b]
        members[a].extend(members[b])  # type: ignore[union-attr]
        members[b] = None

    clusters: list[FaceCluster] = []
    for m in members:
        if m is None or len(m) < min_size:
            continue
        centroid = _renormalize(embs[m].mean(axis=0))
        clusters.append(FaceCluster(members=sorted(m), centroid=centroid))
    clusters.sort(key=lambda c: -len(c.members))
    return clusters


#: Frases pro CLIP decidir se um recorte é ROSTO. A pergunta é feita a cada
#: recorte antes de agrupar ("é mais parecido com qual destas legendas?").
#:
#: Existe porque o detector de rosto (e o de cabeça, que entra quando o de
#: rosto não acha nada) devolve nuca, pescoço, cabelo de costas, lanterna,
#: enfeite — e cada um virava um grupo pro usuário apagar na tela de batismo.
#: Medido no Apothecary Diaries S01E02 e S01E05 (2552 recortes): abaixo do
#: piso sobram ~5% dos recortes, e são quase todos nuca e objeto.
#:
#: As frases negativas foram escolhidas olhando o que caía. "close-up of an
#: anime character's mouth" derrubava personagem GRITANDO no escuro (o Lihaku
#: ia a 0,04); "lips and chin with no eyes visible" pega o recorte de pescoço
#: e boca sem levar o grito junto.
PROMPTS_ROSTO = (
    "an anime character's face",
    "a portrait of an anime character's face",
    "an anime character's face in profile",
    "an anime character with eyes closed",
)
PROMPTS_NAO_ROSTO = (
    "the back of an anime character's head",
    "anime hair seen from behind",
    "a close-up of lips and chin with no eyes visible",
    "a close-up of a neck and collarbone",
    "an anime character's ear",
    "a dark silhouette",
    "an object",
    "a blurry background",
)
#: Abaixo disto o recorte não entra no agrupamento.
PISO_ROSTO = 0.2


def probabilidade_de_rosto(embs: np.ndarray, textos: np.ndarray) -> np.ndarray:
    """Chance de cada recorte ser um rosto, de 0 a 1.

    `textos` são as frases embedadas, positivas primeiro (na ordem de
    PROMPTS_ROSTO + PROMPTS_NAO_ROSTO). A conta é a do CLIP zero-shot:
    softmax sobre as legendas com a temperatura de treino (100), e a chance de
    "rosto" é a soma das positivas.
    """
    if embs.size == 0:
        return np.zeros(0, dtype=np.float32)
    logits = 100.0 * embs.astype(np.float32) @ textos.T
    logits -= logits.max(axis=1, keepdims=True)
    p = np.exp(logits)
    p /= p.sum(axis=1, keepdims=True)
    return p[:, : len(PROMPTS_ROSTO)].sum(axis=1)


def reconhece(sims: list[tuple[float, str]]) -> str:
    """O nome, se o grupo é COM CERTEZA alguém já batizado; senão vazio.

    `sims` é a similaridade do centroide do grupo contra cada personagem já
    conhecido, da maior pra menor. Duas faixas, medidas cruzando episódios
    (grupos do S01E02 contra os personagens batizados no S01E05):

    - 0,955 com 0,02 de folga pro segundo: os personagens certos ficaram de
      0,955 a 0,997. O grupo misturado (várias damas da corte) bateu 0,950
      contra 0,949 — a folga é o que o separa.
    - 0,94 com 0,04 de folga: a Maomao de olhos fechados, a chibi, de perfil
      — mesmo personagem, centroide mais longe, mas sem ninguém disputando.

    Abaixo disso o nome NÃO vem preenchido: o CLIP põe personagens diferentes
    do mesmo anime a 0,93 um do outro, e nome errado pré-preenchido é pior
    que campo vazio — a pessoa confia e salva.
    """
    if not sims:
        return ""
    s1, nome = sims[0]
    s2 = sims[1][0] if len(sims) > 1 else 0.0
    if (s1 >= 0.955 and s1 - s2 >= 0.02) or (s1 >= 0.94 and s1 - s2 >= 0.04):
        return nome
    return ""


def juntar_por_nome(
    clusters: list[FaceCluster],
    observations: list[FaceObservation],
    nomes: list[str],
) -> tuple[list[FaceCluster], list[str]]:
    """Funde os grupos reconhecidos como o mesmo personagem.

    O agrupamento parte o mesmo personagem em vários (de frente, de perfil,
    chorando, chibi) — no S01E05 a Maomao veio em SETE grupos. Quando o nome
    já é conhecido, perguntar sete vezes é trabalho jogado fora. Grupo sem
    nome fica como está.
    """
    por_nome: dict[str, list[int]] = {}
    saida_c: list[FaceCluster] = []
    saida_n: list[str] = []
    for cl, nome in zip(clusters, nomes):
        if not nome:
            saida_c.append(cl)
            saida_n.append("")
            continue
        por_nome.setdefault(nome, []).extend(cl.members)
    embs = None
    for nome, membros in por_nome.items():
        if embs is None:
            embs = np.stack([o.embedding for o in observations]).astype(np.float32)
        m = sorted(membros)
        saida_c.append(FaceCluster(members=m, centroid=_renormalize(embs[m].mean(axis=0))))
        saida_n.append(nome)
    return saida_c, saida_n


def pick_representatives(
    cluster: FaceCluster,
    observations: list[FaceObservation],
    k: int = 6,
) -> list[int]:
    """Escolhe até k rostos representativos: os mais próximos do centroide,
    espalhados por shots diferentes (diversidade de pose/cena) — servem de
    thumbnail na tela de batismo e de referência pros próximos episódios."""
    scored = sorted(
        cluster.members,
        key=lambda i: -float(observations[i].embedding @ cluster.centroid),
    )
    picked: list[int] = []
    seen_shots: set[int] = set()
    for i in scored:                       # 1º: shots distintos
        if observations[i].shot_idx in seen_shots:
            continue
        picked.append(i)
        seen_shots.add(observations[i].shot_idx)
        if len(picked) >= k:
            return picked
    for i in scored:                       # 2º: completa com o que sobrar
        if i not in picked:
            picked.append(i)
            if len(picked) >= k:
                break
    return picked
