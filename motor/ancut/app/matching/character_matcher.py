from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class CharacterEntry:
    id: int
    name: str
    centroid: np.ndarray   # shape (d,) — média global; vai pro DB e pras sugestões
    threshold: float
    # Multi-protótipo (P, d): um vetor por "modo visual" das refs (cabelo
    # solto vs preso, uniforme vs armadura...). None → matcher usa o centroide.
    prototypes: np.ndarray | None = None
    #: Quantos ROSTOS de verdade foram detectados nas fotos de referência.
    #: Não é o mesmo que quantidade de fotos: um retrato de corpo inteiro em
    #: que o YOLO não achou rosto vira recorte central da imagem, e um
    #: protótipo feito só disso compara pose e fundo, não rosto. É o número
    #: que diz se dá pra confiar nas refs deste personagem.
    ref_faces: int = 0


def build_centroid(reference_embeddings: np.ndarray) -> np.ndarray | None:
    """Mean of reference vectors, re-normalized."""
    if reference_embeddings.size == 0:
        return None
    c = reference_embeddings.mean(axis=0)
    n = np.linalg.norm(c)
    if n < 1e-8:
        return None
    return (c / n).astype(np.float32)


def build_prototypes(
    reference_embeddings: np.ndarray,
    *,
    merge_threshold: float = 0.80,
    max_prototypes: int = 5,
) -> np.ndarray | None:
    """Agrupa as refs por modo visual e devolve um protótipo por grupo.

    Average-linkage (mesma escolha do clustering da Descoberta — resiste ao
    encadeamento A~B~C que um greedy por centroide sofre): funde enquanto o
    par mais próximo passa de `merge_threshold`, e continua fundindo além do
    threshold se ainda houver grupos demais (cap adaptativo pela quantidade
    de refs — poucas refs não sustentam muitos protótipos).

    Com 8+ refs, grupos de UMA ref só são descartados quando há pelo menos
    dois grupos "de verdade" — uma ref sozinha destoando de todas as outras
    é mais provavelmente ruído de galeria (fanart com outro personagem,
    thumbnail errada) do que um modo visual legítimo.
    """
    n = len(reference_embeddings)
    if n == 0:
        return None
    embs = np.asarray(reference_embeddings, dtype=np.float32)
    if n <= 3:
        return embs.copy()

    cap = 3 if n <= 8 else 4 if n <= 20 else max_prototypes
    sims = embs @ embs.T
    clusters: list[list[int]] = [[i] for i in range(n)]
    while len(clusters) > 1:
        best_pair, best_s = None, -2.0
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                s = float(np.mean(sims[np.ix_(clusters[i], clusters[j])]))
                if s > best_s:
                    best_s, best_pair = s, (i, j)
        if best_s >= merge_threshold or len(clusters) > cap:
            i, j = best_pair
            clusters[i] = clusters[i] + clusters[j]
            del clusters[j]
        else:
            break

    if n >= 8:
        non_single = [c for c in clusters if len(c) >= 2]
        if len(non_single) >= 2:
            clusters = non_single

    protos: list[tuple[int, np.ndarray]] = []
    for c in clusters:
        m = embs[c].mean(axis=0)
        norm = float(np.linalg.norm(m))
        if norm >= 1e-8:
            protos.append((len(c), m / norm))
    if not protos:
        return None
    protos.sort(key=lambda t: -t[0])
    return np.stack([p for _, p in protos], axis=0).astype(np.float32)


def entry_matrix(entry: CharacterEntry) -> np.ndarray:
    """Vetores de comparação de um personagem: protótipos quando existem,
    senão o centroide como matriz (1, d)."""
    if entry.prototypes is not None and entry.prototypes.size > 0:
        return entry.prototypes
    return entry.centroid[None, :]


class CharacterMatcher:
    """Matches query embeddings against each character's prototypes.

    A similaridade de um rosto com um personagem é o MELHOR protótipo dele
    (max), não a média — um personagem "de cabelo preso" na cena não deve
    ser penalizado pelas refs de cabelo solto. Um shot pode carregar vários
    personagens.
    """

    def __init__(self, entries: list[CharacterEntry]) -> None:
        self.entries = [e for e in entries if e.centroid is not None and e.centroid.size > 0]
        if self.entries:
            mats = [entry_matrix(e) for e in self.entries]
            # Linhas contíguas por personagem; reduceat corta nos starts.
            self._starts = np.cumsum([0] + [m.shape[0] for m in mats[:-1]])
            self.matrix = np.concatenate(mats, axis=0)
        else:
            self._starts = np.zeros(0, dtype=np.int64)
            self.matrix = np.zeros((0, 0), dtype=np.float32)

    def _char_sims(self, query_embeddings: np.ndarray) -> np.ndarray:
        """(Q, C): melhor cosseno de cada query contra cada personagem
        (máximo sobre os protótipos dele)."""
        sims = query_embeddings @ self.matrix.T          # (Q, R)
        return np.maximum.reduceat(sims, self._starts, axis=1)

    def score(self, query_embeddings: np.ndarray) -> dict[int, float]:
        """Given N query vectors (e.g. keyframes + face crops for one shot),
        return best cosine per character id.
        """
        if self.matrix.size == 0 or query_embeddings.size == 0:
            return {}
        best = self._char_sims(query_embeddings).max(axis=0)  # (C,)
        return {self.entries[i].id: float(best[i]) for i in range(len(self.entries))}

    def assign(self, query_embeddings: np.ndarray) -> list[tuple[int, float]]:
        """Return (character_id, confidence) for each character passing threshold."""
        scores = self.score(query_embeddings)
        out: list[tuple[int, float]] = []
        for e in self.entries:
            s = scores.get(e.id, 0.0)
            if s >= e.threshold:
                out.append((e.id, s))
        out.sort(key=lambda x: x[1], reverse=True)
        return out

    def best_overall(
        self, query_embeddings: np.ndarray
    ) -> tuple[CharacterEntry, float] | None:
        """Best (entry, similarity) across ALL queries, ignoring thresholds.
        Used to grade how close an unassigned shot came — the ambiguity band
        that decides whether the AI reviewer gets a look at it."""
        if self.matrix.size == 0 or query_embeddings.size == 0:
            return None
        sims = self._char_sims(query_embeddings)
        q, c = np.unravel_index(int(np.argmax(sims)), sims.shape)
        return self.entries[int(c)], float(sims[q, c])

    def assign_best_per_query(
        self, query_embeddings: np.ndarray, margin: float = 0.0
    ) -> list[tuple[int, float]]:
        """For each query vector, pick the single best character above its
        threshold. If `margin > 0`, the best character must beat the 2nd
        best by at least `margin` or the vote is discarded (kills ambiguous
        matches, common for characters absent from the episode).
        """
        if self.matrix.size == 0 or query_embeddings.size == 0:
            return []
        sims = self._char_sims(query_embeddings)  # (Q, C)
        best: dict[int, float] = {}
        for q in range(sims.shape[0]):
            row = sims[q]
            order = np.argsort(-row)
            c_idx = int(order[0])
            conf = float(row[c_idx])
            entry = self.entries[c_idx]
            if conf < entry.threshold:
                continue
            if margin > 0.0 and row.shape[0] > 1:
                second = float(row[int(order[1])])
                if conf - second < margin:
                    continue
            prev = best.get(entry.id, 0.0)
            if conf > prev:
                best[entry.id] = conf
        return sorted(best.items(), key=lambda x: x[1], reverse=True)
