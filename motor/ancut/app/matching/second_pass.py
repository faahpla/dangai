"""Segunda passada: resgate por semelhança dentro do próprio episódio.

O problema que isso resolve: a primeira passada compara cada cena com as
referências VINDAS DE FORA (arte oficial, wikis) — estilo e ângulo diferentes
do episódio. Resultado: o mesmo rosto, no mesmo ângulo, identificado numa cena
e pulado na vizinha porque a similaridade com a ref externa oscilou um pouco.

A solução: as cenas que a primeira passada identificou COM confiança viram
referências temporárias ("banco do episódio") — mesmo traço, mesma luz, mesmo
ângulo. As cenas que ficaram sem dono são recomparadas contra esse banco.
Rosto igual no mesmo estilo = similaridade altíssima → resgatada.

Threshold padrão 0.86: o mesmo corte usado pelo clustering do Modo Descoberta
pra decidir "mesma identidade" entre rostos do mesmo episódio — calibrado nos
mesmos embeddings (CLIP em crops de rosto).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .character_matcher import CharacterEntry, entry_matrix


@dataclass
class ShotFaces:
    """Rostos de um shot: embeddings L2-normalizados (N, D), ou vazio."""
    pos: int                     # posição na lista per_shot_names
    embs: np.ndarray | None      # None ou (N, D)
    assigned: list[tuple[int, float]]  # (char_id, conf) da primeira passada
    # Proveniência de cada linha de embs: (keyframe, índice do box no cache).
    # É o que permite rematerializar o CROP de um rosto depois — contact
    # sheet da IA por grupo e thumbnails do batismo — sem guardar JPEG.
    face_refs: list[tuple] | None = None


def build_episode_banks(
    entries: list[CharacterEntry],
    shots: list[ShotFaces],
    *,
    min_sources: int = 2,
    max_bank: int = 40,
) -> dict[int, np.ndarray]:
    """Monta o banco de referências do episódio por personagem.

    Em cada shot-fonte, cada rosto alimenta só o banco do personagem (entre os
    atribuídos ao shot) com que ele mais parece — um rosto nunca entra
    em dois bancos, senão personagens que dividem muitas cenas contaminariam
    o banco um do outro. Exige `min_sources` shots-fonte pra não construir
    banco em cima de um único acerto possivelmente errado.
    """
    by_id = {e.id: e for e in entries}
    picked: dict[int, list[tuple[float, np.ndarray]]] = {}
    for sf in shots:
        if sf.embs is None or sf.embs.size == 0 or not sf.assigned:
            continue
        chars = [by_id[cid] for cid, _ in sf.assigned if cid in by_id]
        if not chars:
            continue
        # (n_faces, n_chars): melhor sim de cada rosto contra os protótipos
        # de cada personagem atribuído (max sobre os modos visuais dele)
        sims = np.stack(
            [np.max(sf.embs @ entry_matrix(c).T, axis=1) for c in chars], axis=1
        )
        # melhor rosto POR personagem, mas cada rosto só conta pro personagem
        # que é o argmax dele (voto único)
        face_owner = np.argmax(sims, axis=1)  # (n_faces,)
        for ci, ch in enumerate(chars):
            owned = np.where(face_owner == ci)[0]
            if owned.size == 0:
                continue
            j = int(owned[np.argmax(sims[owned, ci])])
            picked.setdefault(ch.id, []).append((float(sims[j, ci]), sf.embs[j]))
    banks: dict[int, np.ndarray] = {}
    for cid, items in picked.items():
        if len(items) < min_sources:
            continue
        items.sort(key=lambda t: -t[0])
        banks[cid] = np.stack([v for _, v in items[:max_bank]], axis=0)
    return banks


def rescue_unassigned(
    banks: dict[int, np.ndarray],
    shots: list[ShotFaces],
    *,
    threshold: float = 0.86,
    max_per_shot: int = 2,
) -> dict[int, list[tuple[int, float]]]:
    """Recompara os shots SEM personagem contra o banco do episódio.

    Cada ROSTO vota em no máximo UM personagem — o dono do banco que mais se
    parece com ele. Sem isso, um close do personagem A também "batia" no banco
    de B quando A e B dividem muitas cenas (o mesmo rosto contava pros dois e
    B pegava carona). Com o voto único, resgate duplo exige dois rostos
    diferentes de verdade na cena.

    Retorna {pos: [(char_id, sim), ...]} só pros shots resgatados. `sim` é
    similaridade rosto-a-rosto (escala mais alta que a rosto-vs-centroide da
    primeira passada — 0.86+ aqui é praticamente "mesmo rosto").
    """
    out: dict[int, list[tuple[int, float]]] = {}
    if not banks:
        return out
    cids = list(banks.keys())
    for sf in shots:
        if sf.assigned or sf.embs is None or sf.embs.size == 0:
            continue
        # (n_faces, n_chars): melhor sim de cada rosto contra cada banco
        sims = np.stack(
            [np.max(sf.embs @ banks[cid].T, axis=1) for cid in cids], axis=1
        )
        votes: dict[int, float] = {}
        for f in range(sims.shape[0]):
            c = int(np.argmax(sims[f]))
            s = float(sims[f, c])
            if s >= threshold:
                cid = cids[c]
                votes[cid] = max(votes.get(cid, 0.0), s)
        if votes:
            hits = sorted(votes.items(), key=lambda t: -t[1])
            out[sf.pos] = hits[:max_per_shot]
    return out
