"""Resgate por GRUPO: a Descoberta embutida na análise verde.

O insight (validado em produção): rostos do MESMO episódio se parecem muito
entre si (mesmo traço, luz, roupa, compressão) — mais do que qualquer um
deles se parece com referências externas. A segunda passada já explora isso,
mas só resgata NA DIREÇÃO de personagens que tiveram acerto confiante na
primeira: um personagem cujos crops pontuam todos 0.75 contra as refs
externas fica invisível pra sempre.

Aqui a pergunta muda de ordem: primeiro "quais rostos sem dono são a mesma
pessoa?" (clustering, evidência interna), depois "que personagem oficial é
esse grupo?" — decidido pela MEDIANA dos melhores matches de representantes
DIVERSOS do grupo. Evidência agregada e consistente permite uma régua mais
baixa que a de um crop isolado sem virar chute: exige margem sobre o 2º
candidato e concordância entre os representantes.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .character_matcher import CharacterEntry, entry_matrix


def diverse_representatives(embs: np.ndarray, k: int) -> list[int]:
    """Até `k` índices representativos e DIVERSOS (farthest-point sampling a
    partir do medoid). Pegar só os mais próximos do centroide devolve k
    frames quase idênticos — diversidade é o que dá força estatística à
    mediana (frontal + perfil + luz diferente contam como evidências
    independentes)."""
    n = len(embs)
    if n == 0:
        return []
    if n <= k:
        return list(range(n))
    centroid = embs.mean(axis=0)
    centroid /= max(float(np.linalg.norm(centroid)), 1e-8)
    first = int(np.argmax(embs @ centroid))             # medoid
    picked = [first]
    # menor similaridade ao conjunto já escolhido = mais "novo"; quem já
    # foi escolhido sai da disputa (sim sentinela acima do máximo possível)
    min_sim = embs @ embs[first]
    min_sim[first] = 2.0
    while len(picked) < k:
        cand = int(np.argmin(min_sim))
        picked.append(cand)
        min_sim = np.minimum(min_sim, embs @ embs[cand])
        min_sim[picked] = 2.0   # np.minimum apaga a sentinela — reaplica em todos
    return picked


@dataclass
class GroupScore:
    entry: CharacterEntry
    median: float      # mediana dos melhores matches dos representantes
    agreement: float   # fração dos representantes cujo argmax é este personagem


def rank_characters(
    rep_embs: np.ndarray, entries: list[CharacterEntry]
) -> list[GroupScore]:
    """Ordena os personagens pelo score de grupo contra os protótipos.

    Mediana (não média): um crop ruim no meio dos representantes não pode
    derrubar — nem inflar — a decisão do grupo inteiro.
    """
    if rep_embs.size == 0 or not entries:
        return []
    mats = [entry_matrix(e) for e in entries]
    # (n_reps, n_chars): melhor protótipo de cada personagem por representante
    sims = np.stack(
        [np.max(rep_embs @ m.T, axis=1) for m in mats], axis=1
    )
    argmax = np.argmax(sims, axis=1)                    # voto de cada rep
    out: list[GroupScore] = []
    for ci, e in enumerate(entries):
        out.append(GroupScore(
            entry=e,
            median=float(np.median(sims[:, ci])),
            agreement=float(np.mean(argmax == ci)),
        ))
    out.sort(key=lambda g: -g.median)
    return out


def decide(
    ranking: list[GroupScore],
    *,
    min_sim: float,
    margin: float,
    min_agreement: float,
) -> CharacterEntry | None:
    """Aceita o topo do ranking só com as três provas juntas: mediana acima
    da régua, margem folgada sobre o 2º candidato e a maioria dos
    representantes votando nele."""
    if not ranking:
        return None
    top = ranking[0]
    if top.median < min_sim or top.agreement < min_agreement:
        return None
    if len(ranking) > 1 and top.median - ranking[1].median < margin:
        return None
    return top.entry
